import {
  InvitationDeliveryStatus,
  OhlqReportDataSource,
  OhlqReportRunStatus,
  OrganizationAuditAction,
  OrganizationOnboardingStatus,
  OrganizationProductStatus,
  Prisma,
  ProvisioningRunStatus,
  ProvisioningStepKind,
  ProvisioningStepStatus,
  UserRole,
} from '@prisma/client';
import { refreshAgencyIntelligence } from './agencyIntelligenceService';
import { hasFeature, writeOrganizationAudit } from './organizations';
import { captureWholesaleSalesEvents, evaluateOpportunityIntelligence } from './opportunityEngine';
import { prisma } from './prisma';
import { createUserInvitationToken, getUserInvitationUrl, sendUserInvitationEmail } from './userInvitations';
import { discoverOrganizationProducts } from './organizationProductDiscovery';

export const PROVISIONING_STEP_ORDER: ProvisioningStepKind[] = [
  ProvisioningStepKind.VALIDATE_CONFIGURATION,
  ProvisioningStepKind.DISCOVER_PRODUCTS,
  ProvisioningStepKind.CONFIRM_PRODUCTS,
  ProvisioningStepKind.APPLY_ENTITLEMENTS,
  ProvisioningStepKind.CREATE_INITIAL_ADMIN,
  ProvisioningStepKind.SEND_INITIAL_INVITATION,
  ProvisioningStepKind.BACKFILL_SALES,
  ProvisioningStepKind.BACKFILL_AGENCY_INTELLIGENCE,
  ProvisioningStepKind.BACKFILL_OPPORTUNITIES,
  ProvisioningStepKind.FINALIZE,
];

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function createProvisioningRun({
  actorUserId,
  configuration,
  organizationId,
}: {
  actorUserId: string;
  configuration?: Record<string, unknown>;
  organizationId: string;
}) {
  return prisma.organizationProvisioningRun.create({
    data: {
      configuration: json(configuration ?? {}),
      organizationId,
      requestedByUserId: actorUserId,
      steps: {
        create: PROVISIONING_STEP_ORDER.map((kind, sequence) => ({ kind, sequence })),
      },
    },
    include: { steps: { orderBy: { sequence: 'asc' } } },
  });
}

async function setStep(
  stepId: string,
  status: ProvisioningStepStatus,
  options: { error?: string | null; output?: unknown } = {},
) {
  const terminal = status === ProvisioningStepStatus.COMPLETE || status === ProvisioningStepStatus.FAILED || status === ProvisioningStepStatus.SKIPPED || status === ProvisioningStepStatus.WAITING_FOR_INPUT;
  await prisma.organizationProvisioningStep.update({
    where: { id: stepId },
    data: {
      ...(status === ProvisioningStepStatus.RUNNING ? { attemptCount: { increment: 1 }, startedAt: new Date() } : {}),
      ...(terminal ? { completedAt: new Date() } : {}),
      lastError: options.error ?? null,
      output: options.output === undefined ? undefined : json(options.output),
      status,
    },
  });
}

async function latestCompletedReportDate(source: OhlqReportDataSource) {
  return (await prisma.ohlqReportImportStatus.findFirst({
    where: { dataSource: source, status: OhlqReportRunStatus.COMPLETED },
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  }))?.reportDate ?? null;
}

async function executeStep(organizationId: string, kind: ProvisioningStepKind) {
  if (kind === ProvisioningStepKind.VALIDATE_CONFIGURATION) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { features: true, vendorIdentifiers: { where: { active: true } } },
    });
    if (!organization) throw new Error('Organization no longer exists.');
    if (!organization.name || !organization.displayName || !organization.slug || !organization.timezone) throw new Error('Organization identity is incomplete.');
    if (!organization.contactEmail) throw new Error('A customer contact email is required.');
    if (!organization.features.length) throw new Error('At least one entitlement must be configured.');
    if (!organization.vendorIdentifiers.length) return { waiting: true, message: 'Add at least one active Vendor ID.' };
    return { organizationId, vendorIds: organization.vendorIdentifiers.length };
  }

  if (kind === ProvisioningStepKind.DISCOVER_PRODUCTS) {
    return discoverOrganizationProducts({ organizationId });
  }

  if (kind === ProvisioningStepKind.CONFIRM_PRODUCTS) {
    await discoverOrganizationProducts({ organizationId });
    const [pending, decided] = await Promise.all([
      prisma.organizationProduct.count({ where: { organizationId, active: true, status: OrganizationProductStatus.PENDING_REVIEW } }),
      prisma.organizationProduct.count({ where: { organizationId, active: true, status: { in: [OrganizationProductStatus.OWNED, OrganizationProductStatus.REPRESENTED, OrganizationProductStatus.EXCLUDED] } } }),
    ]);
    if (pending || !decided) return { waiting: true, message: pending ? `Review ${pending} discovered product(s).` : 'Confirm at least one product decision.' };
    return { decided };
  }

  if (kind === ProvisioningStepKind.APPLY_ENTITLEMENTS) {
    const enabled = await prisma.organizationFeature.count({ where: { organizationId, enabled: true } });
    if (!enabled) throw new Error('At least one entitlement must be enabled.');
    return { enabled };
  }

  if (kind === ProvisioningStepKind.CREATE_INITIAL_ADMIN) {
    const admin = await prisma.user.findFirst({ where: { organizationId, role: UserRole.ADMIN }, select: { id: true } });
    if (!admin) throw new Error('Create an organization administrator before provisioning.');
    return { userId: admin.id };
  }

  if (kind === ProvisioningStepKind.SEND_INITIAL_INVITATION) {
    const admin = await prisma.user.findFirst({ where: { organizationId, role: UserRole.ADMIN }, include: { invitations: { where: { acceptedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!admin) throw new Error('Initial administrator is missing.');
    if (admin.isActive && admin.passwordHash) return { skipped: true, message: 'Administrator is already active.' };
    const invitation = admin.invitations[0];
    if (!invitation) return { waiting: true, message: 'Generate and deliver the initial administrator invitation.' };
    if (invitation.deliveryStatus === InvitationDeliveryStatus.FAILED) return { waiting: true, message: invitation.lastError || 'Invitation delivery failed; retry it.' };
    return { deliveryStatus: invitation.deliveryStatus, invitationId: invitation.id };
  }

  if (kind === ProvisioningStepKind.BACKFILL_SALES) {
    const reportDate = await latestCompletedReportDate(OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE);
    if (!reportDate) return { skipped: true, message: 'No completed wholesale sales import is available yet.' };
    return captureWholesaleSalesEvents({ organizationId, reportDate });
  }

  if (kind === ProvisioningStepKind.BACKFILL_AGENCY_INTELLIGENCE) {
    if (!(await hasFeature(organizationId, 'AGENCY_INTELLIGENCE'))) return { skipped: true, message: 'Agency Intelligence is not enabled.' };
    const [inventoryReportDate, salesReportDate] = await Promise.all([
      latestCompletedReportDate(OhlqReportDataSource.AGENCY_INVENTORY_REPORT),
      latestCompletedReportDate(OhlqReportDataSource.ANNUAL_SALES_SUMMARY),
    ]);
    if (!inventoryReportDate || !salesReportDate) return { skipped: true, message: 'Required shared OHLQ imports are not available yet.' };
    return refreshAgencyIntelligence({ inventoryReportDate, organizationId, salesReportDate });
  }

  if (kind === ProvisioningStepKind.BACKFILL_OPPORTUNITIES) {
    if (!(await hasFeature(organizationId, 'WHOLESALE_OPPORTUNITIES'))) return { skipped: true, message: 'Wholesale Opportunities is not enabled.' };
    const reportDate = await latestCompletedReportDate(OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE);
    if (!reportDate) return { skipped: true, message: 'No completed wholesale sales import is available yet.' };
    return evaluateOpportunityIntelligence({ asOfDate: reportDate, organizationId });
  }

  if (kind === ProvisioningStepKind.FINALIZE) {
    await prisma.organization.update({ where: { id: organizationId }, data: { onboardingStatus: OrganizationOnboardingStatus.READY } });
    return { ready: true };
  }

  throw new Error(`Unsupported provisioning step: ${kind}`);
}

export async function runProvisioning(runId: string) {
  const run = await prisma.organizationProvisioningRun.findUnique({ where: { id: runId }, include: { steps: { orderBy: { sequence: 'asc' } } } });
  if (!run) throw new Error('Provisioning run was not found.');
  await prisma.organizationProvisioningRun.update({ where: { id: runId }, data: { attemptCount: { increment: 1 }, lastError: null, startedAt: run.startedAt ?? new Date(), status: ProvisioningRunStatus.RUNNING } });

  for (const step of run.steps) {
    if (step.status === ProvisioningStepStatus.COMPLETE || step.status === ProvisioningStepStatus.SKIPPED) continue;
    await prisma.organizationProvisioningRun.update({ where: { id: runId }, data: { currentStep: step.kind } });
    await setStep(step.id, ProvisioningStepStatus.RUNNING);
    try {
      const result = await executeStep(run.organizationId, step.kind);
      if ('waiting' in result && result.waiting) {
        await setStep(step.id, ProvisioningStepStatus.WAITING_FOR_INPUT, { output: result });
        await prisma.organizationProvisioningRun.update({ where: { id: runId }, data: { status: ProvisioningRunStatus.WAITING_FOR_INPUT } });
        return { status: ProvisioningRunStatus.WAITING_FOR_INPUT, step: step.kind };
      }
      await setStep(step.id, 'skipped' in result && result.skipped ? ProvisioningStepStatus.SKIPPED : ProvisioningStepStatus.COMPLETE, { output: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStep(step.id, ProvisioningStepStatus.FAILED, { error: message });
      await prisma.organizationProvisioningRun.update({ where: { id: runId }, data: { lastError: message, status: ProvisioningRunStatus.FAILED } });
      return { error: message, status: ProvisioningRunStatus.FAILED, step: step.kind };
    }
  }

  await prisma.organizationProvisioningRun.update({ where: { id: runId }, data: { completedAt: new Date(), currentStep: null, status: ProvisioningRunStatus.COMPLETE } });
  return { status: ProvisioningRunStatus.COMPLETE };
}

export async function issueInitialAdminInvitation({ actorUserId, organizationId }: { actorUserId: string; organizationId: string }) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { displayName: true } });
  const user = await prisma.user.findFirst({ where: { organizationId, role: UserRole.ADMIN, isActive: false }, orderBy: { createdAt: 'asc' } });
  if (!organization || !user) throw new Error('An inactive initial organization administrator is required.');
  const token = createUserInvitationToken();
  const invitation = await prisma.userInvitation.create({ data: { userId: user.id, tokenHash: token.tokenHash, expiresAt: token.expiresAt, deliveryStatus: InvitationDeliveryStatus.PENDING } });
  let manualUrl: string | null = null;
  try {
    const delivery = await sendUserInvitationEmail({ invitationId: invitation.id, organizationName: organization.displayName, recipientEmail: user.email, recipientName: user.name || user.email, token: token.token });
    manualUrl = delivery.suppressed ? getUserInvitationUrl(token.token) : null;
    await prisma.$transaction([
      prisma.userInvitation.update({ where: { id: invitation.id }, data: { attemptCount: 1, deliveredTo: delivery.deliveredTo, deliveryStatus: delivery.suppressed ? InvitationDeliveryStatus.SUPPRESSED : InvitationDeliveryStatus.SENT, lastAttemptAt: new Date(), providerMessageId: delivery.providerMessageId } }),
      prisma.userInvitation.deleteMany({ where: { userId: user.id, id: { not: invitation.id }, acceptedAt: null } }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.userInvitation.update({ where: { id: invitation.id }, data: { attemptCount: 1, deliveryStatus: InvitationDeliveryStatus.FAILED, lastAttemptAt: new Date(), lastError: message } });
    throw error;
  }
  await writeOrganizationAudit(actorUserId, organizationId, OrganizationAuditAction.INITIAL_ADMIN_CREATED, { invitationId: invitation.id, invitationIssued: true });
  return { invitationId: invitation.id, manualUrl };
}

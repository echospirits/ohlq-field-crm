import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { formatDateInputValue } from './dateTime';
import { ohioSourceConfiguration } from './productionForecasting/sourceConfiguration';
import {
  BailmentReportingParseError,
  parseBailmentReportingCsv,
  type BailmentReportingParseErrorCode,
} from './ohlqBailmentReportingParser';

export const BAILMENT_REPORTING_REPORT_ID = 'bdf38254-b332-4d12-b689-1113a2644a40';
export const BAILMENT_REPORTING_WRITE_BATCH = 500;

export type BailmentReportingInput = {
  organizationId: string;
  requestId: string;
  csvBuffer: Buffer;
  requestedAt: Date;
  acquiredAt: Date;
  requestedFrom: string;
  requestedTo: string;
  timezone: string;
  reportIdentity: string;
  parameterScope: { parameter: 'Vendor' | 'Brand'; values: 'all' };
  exportCompleted: true;
  expectedSizeBytes?: number;
};

export type BailmentReportingErrorCode = BailmentReportingParseErrorCode
  | 'invalid-provenance' | 'organization-unavailable' | 'request-conflict'
  | 'incomplete-export' | 'persistence';

/** Safe for aggregate job receipts; never expose source cells or database errors. */
export class BailmentReportingError extends Error {
  constructor(readonly code: BailmentReportingErrorCode) {
    super(`Bailment reporting could not be published (${code}).`);
    this.name = 'BailmentReportingError';
  }
}

export type BailmentReportingResult = {
  snapshotId: string;
  rowCount: number;
  contentHash: string;
  published: boolean;
  replay: boolean;
  unchanged: boolean;
  superseded: boolean;
};

function reject(code: BailmentReportingErrorCode): never { throw new BailmentReportingError(code); }
const validDate = (value: Date) => value instanceof Date && Number.isFinite(value.getTime());
const validDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return validDate(date) && date.toISOString().slice(0, 10) === value;
};
const day = (value: Date) => value.toISOString().slice(0, 10);

function validateProvenance(input: BailmentReportingInput) {
  if (!input.organizationId || input.organizationId.length > 200 || /[\x00-\x1f]/.test(input.organizationId)
    || !input.requestId || input.requestId.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(input.requestId)
    || !Buffer.isBuffer(input.csvBuffer) || input.exportCompleted !== true
    || input.reportIdentity !== BAILMENT_REPORTING_REPORT_ID
    || !input.parameterScope || !['Vendor', 'Brand'].includes(input.parameterScope.parameter)
    || input.parameterScope.values !== 'all'
    || !validDate(input.requestedAt) || !validDate(input.acquiredAt)
    || input.requestedAt > input.acquiredAt
    || !validDay(input.requestedFrom) || !validDay(input.requestedTo)
    || input.requestedFrom > input.requestedTo
    || (input.expectedSizeBytes !== undefined && (!Number.isSafeInteger(input.expectedSizeBytes)
      || input.expectedSizeBytes <= 0 || input.expectedSizeBytes !== input.csvBuffer.length))) {
    reject('invalid-provenance');
  }
  try {
    if (formatDateInputValue(input.requestedAt, input.timezone) !== input.requestedTo) reject('invalid-provenance');
  } catch { reject('invalid-provenance'); }
}

function historicalContinuityLost(
  previous: { requestedFrom: Date; requestedTo: Date; rowCount: number; invoiceMonthCounts: Prisma.JsonValue },
  incoming: ReturnType<typeof parseBailmentReportingCsv>,
  input: BailmentReportingInput,
) {
  if (day(previous.requestedFrom) !== input.requestedFrom || day(previous.requestedTo) > input.requestedTo
    || previous.rowCount < 10 || incoming.rowCount >= previous.rowCount / 2) return false;
  const counts = previous.invoiceMonthCounts;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return false;
  const months = Object.keys(counts).filter(month => /^\d{4}-\d{2}$/.test(month)).sort();
  if (months.length < 2) return false;
  const missing = months.filter(month => !(incoming.invoiceMonthCounts[month] > 0));
  return missing.includes(months[0]) || missing.length >= months.length / 2;
}

/**
 * The trusted job establishes authority to request this organization's report.
 * This service rechecks its current organization/configuration and publishes only
 * one complete native report. It does not touch the retired CSV archive or UI.
 */
export async function publishBailmentReportingSnapshot(
  input: BailmentReportingInput,
  db: PrismaClient = prisma,
): Promise<BailmentReportingResult> {
  try {
    validateProvenance(input);
    const parsed = parseBailmentReportingCsv(input.csvBuffer);
    const parameterScope = { parameter: input.parameterScope.parameter, values: input.parameterScope.values };
    const fingerprint = createHash('sha256').update(JSON.stringify({
      organizationId: input.organizationId,
      requestId: input.requestId,
      requestedAt: input.requestedAt.toISOString(),
      acquiredAt: input.acquiredAt.toISOString(),
      requestedFrom: input.requestedFrom,
      requestedTo: input.requestedTo,
      timezone: input.timezone,
      reportIdentity: input.reportIdentity,
      parameterScope,
      contentHash: parsed.contentHash,
      schemaVersion: parsed.schemaVersion,
    })).digest('hex');

    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bailment-reporting:${input.organizationId}`}))`;
      const organization = await tx.organization.findFirst({
        where: {
          id: input.organizationId, active: true,
          accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, enabledStates: { has: 'OH' },
        },
        select: { id: true, settings: true, timezone: true },
      });
      if (!organization) reject('organization-unavailable');
      const config = ohioSourceConfiguration(organization.settings);
      if (organization.timezone !== input.timezone || config.historyStart !== input.requestedFrom) {
        reject('invalid-provenance');
      }

      const snapshots = tx.ohlqBailmentReportingSnapshot;
      const current = await snapshots.findFirst({
        where: { organizationId: input.organizationId },
        orderBy: [{ requestedAt: 'desc' }, { requestId: 'desc' }],
      });
      const priorRequest = await snapshots.findUnique({
        where: { organizationId_requestId: { organizationId: input.organizationId, requestId: input.requestId } },
      });
      if (priorRequest) {
        if (priorRequest.requestFingerprint !== fingerprint) reject('request-conflict');
        return {
          snapshotId: priorRequest.id, rowCount: priorRequest.rowCount, contentHash: priorRequest.contentHash,
          published: false, replay: true,
          unchanged: current?.id === priorRequest.id,
          superseded: current?.id !== priorRequest.id,
        };
      }
      if (current && (input.requestedAt < current.requestedAt
        || (input.requestedAt.getTime() === current.requestedAt.getTime() && input.requestId < current.requestId))) {
        return {
          snapshotId: current.id, rowCount: current.rowCount, contentHash: current.contentHash,
          published: false, replay: false, unchanged: parsed.contentHash === current.contentHash, superseded: true,
        };
      }
      if (current && historicalContinuityLost(current, parsed, input)) reject('incomplete-export');

      const existingContent = await snapshots.findUnique({
        where: { organizationId_contentHash_schemaVersion: {
          organizationId: input.organizationId, contentHash: parsed.contentHash, schemaVersion: parsed.schemaVersion,
        } },
      });
      const data = {
        organizationId: input.organizationId,
        requestId: input.requestId,
        requestFingerprint: fingerprint,
        requestedAt: input.requestedAt,
        acquiredAt: input.acquiredAt,
        requestedFrom: new Date(`${input.requestedFrom}T00:00:00.000Z`),
        requestedTo: new Date(`${input.requestedTo}T00:00:00.000Z`),
        timezone: input.timezone,
        reportIdentity: input.reportIdentity,
        parameterScope,
        contentHash: parsed.contentHash,
        schemaVersion: parsed.schemaVersion,
        rowCount: parsed.rowCount,
        invoiceMonthCounts: parsed.invoiceMonthCounts,
      };
      const saved = existingContent
        ? await snapshots.update({ where: { organizationId_id: { organizationId: input.organizationId, id: existingContent.id } }, data })
        : await snapshots.create({ data });

      if (!existingContent) {
        for (let offset = 0; offset < parsed.lines.length; offset += BAILMENT_REPORTING_WRITE_BATCH) {
          const rows = parsed.lines.slice(offset, offset + BAILMENT_REPORTING_WRITE_BATCH).map(line => ({
            ...line, organizationId: input.organizationId, snapshotId: saved.id,
          }));
          const result = await tx.ohlqBailmentReportingLine.createMany({ data: rows });
          if (result.count !== rows.length) reject('persistence');
        }
      } else {
        // Detect incomplete existing content rather than silently refreshing its clock.
        const count = await tx.ohlqBailmentReportingLine.count({ where: {
          organizationId: input.organizationId, snapshotId: saved.id,
        } });
        if (count !== parsed.rowCount) reject('persistence');
      }

      // At most current + one prior distinct full report; unchanged downloads
      // reuse their content and cannot evict the previous distinct report.
      const retained = await snapshots.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ requestedAt: 'desc' }, { requestId: 'desc' }],
        select: { id: true, contentHash: true },
      });
      const previousDistinct = retained.find(item => item.id !== saved.id && item.contentHash !== saved.contentHash);
      await snapshots.deleteMany({ where: {
        organizationId: input.organizationId,
        id: { notIn: [saved.id, ...(previousDistinct ? [previousDistinct.id] : [])] },
      } });

      return {
        snapshotId: saved.id, rowCount: saved.rowCount, contentHash: saved.contentHash,
        published: true, replay: false,
        unchanged: current?.contentHash === parsed.contentHash && current?.schemaVersion === parsed.schemaVersion,
        superseded: false,
      };
    }, { timeout: 60000 });
  } catch (error) {
    if (error instanceof BailmentReportingError) throw error;
    if (error instanceof BailmentReportingParseError) throw new BailmentReportingError(error.code);
    throw new BailmentReportingError('persistence');
  }
}

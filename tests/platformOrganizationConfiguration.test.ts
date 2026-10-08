import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { OrganizationAuditAction, OrganizationStatus } from '@prisma/client';

const lockedFields = ['appName', 'digestName', 'productLabel', 'productPluralLabel', 'brandPrimaryColor', 'brandAccentColor', 'contactName', 'contactEmail', 'contactPhone', 'supportEmail', 'locale', 'weekStartsOn'];

// Execute the actual inline server actions with fake dependencies and no database or provider access.
function loadAction(path: string, name: string, nextFunction: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8');
  const action = source.slice(source.indexOf(`async function ${name}(`), source.indexOf(nextFunction));
  const helpers = `const clean = (value: unknown) => String(value ?? '').trim();
    const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);`;
  const compiled = ts.transpileModule(`${helpers}\n${action}\nglobalThis.action = ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context: Record<string, unknown> = { ...dependencies };
  runInNewContext(compiled, context);
  return context.action as (data: FormData) => Promise<void>;
}

function submittedData() {
  const form = new FormData();
  for (const field of lockedFields) form.set(field, 'unwanted-override');
  form.set('settings', '{"locale":"unwanted-override","weekStartsOn":1}');
  for (const [field, value] of Object.entries({ organizationId: 'org-1', name: 'Company', displayName: 'Display', accountStatus: 'TRIAL', active: 'on', timezone: 'America/New_York', website: 'https://example.com', adminFirstName: 'First', adminLastName: 'Admin', adminEmail: 'ADMIN@EXAMPLE.COM' })) form.set(field, value);
  return form;
}

test('platform edits ignore forged customer-facing fields and preserve existing settings', async () => {
  let saved: Record<string, unknown> = {};
  const original: Record<string, unknown> = Object.fromEntries(lockedFields.map(field => [field, `existing-${field}`]));
  original.settings = { locale: 'en-US', weekStartsOn: 0, otherSetting: true };
  const action = loadAction('app/platform/organizations/[id]/page.tsx', 'updateOrganization', 'async function saveFeatures(', {
    requirePlatformAdmin: async () => ({ id: 'platform-admin' }), OrganizationStatus, OrganizationAuditAction,
    redirect: () => { throw new Error('unexpected redirect'); },
    prisma: { organization: { update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { assert.equal(where.id, 'org-1'); saved = data; } } },
    writeOrganizationAudit: async () => {}, revalidatePath: () => {},
  });
  await action(submittedData());
  for (const field of [...lockedFields, 'settings']) assert.equal(Object.hasOwn(saved, field), false, field);
  assert.equal(saved.name, 'Company');
  assert.equal(saved.active, true);
  const updated = { ...original, ...saved };
  for (const field of [...lockedFields, 'settings']) assert.deepEqual(updated[field], original[field], field);
});

test('provisioning ignores forged configuration and derives contacts from the initial admin', async () => {
  let created: Record<string, unknown> = {};
  const noOp = async () => {};
  const tx = {
    organization: { create: async ({ data }: { data: Record<string, unknown> }) => { created = data; return { id: 'org-1' }; }, update: noOp },
    organizationVendorIdentifier: { createMany: noOp }, organizationA3aStoreIdentifier: { createMany: noOp }, organizationFeature: { createMany: noOp }, organizationProduct: { createMany: noOp },
    user: { create: async () => ({ id: 'admin-1' }) }, organizationAuditEvent: { createMany: noOp },
  };
  const action = loadAction('app/platform/organizations/new/page.tsx', 'provisionOrganization', 'export default async function NewOrganizationPage(', {
    requirePlatformAdmin: async () => ({ id: 'platform-admin' }), OrganizationAuditAction, UserRole: { ADMIN: 'ADMIN' },
    normalizeOrganizationIdentifierList: () => [], isValidA3aStoreId: () => true,
    getPackageFeatureKeys: () => [], getEnvironmentFeatureKeys: (keys: unknown) => keys, assertFeatureDependencies: (keys: unknown) => keys,
    prisma: { user: { findUnique: async () => null }, $transaction: async (callback: (db: typeof tx) => unknown) => callback(tx) },
    createProvisioningRun: async () => ({ id: 'run-1' }), runProvisioning: noOp,
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  });
  await assert.rejects(action(submittedData()), /redirect:\/platform\/organizations\/org-1\?status=configuration-created/);
  for (const field of lockedFields.filter(field => !['contactName', 'contactEmail', 'supportEmail'].includes(field))) assert.equal(Object.hasOwn(created, field), false, field);
  assert.equal(created.contactName, 'First Admin');
  assert.equal(created.contactEmail, 'admin@example.com');
  assert.equal(created.supportEmail, 'admin@example.com');
  assert.equal(JSON.stringify(created.settings), JSON.stringify({ locale: 'en-US', weekStartsOn: 0 }));
});

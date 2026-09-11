import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAccountContactWhere, getAccountLocation, getCommunicationHref, getCommunicationTitle } from '../lib/accountMemory';

const read = (path: string) => readFileSync(path, 'utf8');

describe('tenant account notes and contacts', () => {
  it('stores both account types in the existing organization overlay', () => {
    const schema = read('prisma/schema.prisma');
    const actions = read('app/account-memory/actions.ts');
    assert.match(schema, /model OrganizationAccountOverlay[\s\S]*notes\s+String\?[\s\S]*@@unique\(\[organizationId, accountType, externalAccountId\]\)/);
    assert.match(actions, /organizationId_accountType_externalAccountId: \{ organizationId, accountType: location\.accountType, externalAccountId: accountId \}/);
    assert.deepEqual(getAccountLocation('AGENCY', 'agency-1'), { accountType: 'AGENCY', agencyId: 'agency-1' });
    assert.deepEqual(getAccountLocation('WHOLESALE', 'account-1'), { accountType: 'WHOLESALE', wholesaleAccountId: 'account-1' });
  });

  it('scopes contact reads and writes to the current organization and account', () => {
    assert.deepEqual(getAccountContactWhere('org-a', { accountType: 'AGENCY', agencyId: 'agency-1' }), { organizationId: 'org-a', agencyId: 'agency-1' });
    assert.deepEqual(getAccountContactWhere('org-b', { accountType: 'WHOLESALE', wholesaleAccountId: 'account-1' }), { organizationId: 'org-b', wholesaleAccountId: 'account-1' });
    const actions = read('app/account-memory/actions.ts');
    assert.match(actions, /findFirst\(\{ where: \{ id, \.\.\.getAccountContactWhere\(organizationId, location\) \}/);
    assert.match(actions, /updateMany\(\{ where: getAccountContactWhere\(organizationId, location\)/);
    assert.doesNotMatch(actions, /locationContact\.delete/);
  });

  it('keeps stable contact identities and future source identifiers', () => {
    const schema = read('prisma/schema.prisma');
    assert.match(schema, /model LocationContact[\s\S]*id\s+String\s+@id @default\(cuid\(\)\)[\s\S]*organizationId\s+String/);
    assert.match(schema, /isPrimary\s+Boolean\s+@default\(false\)/);
    assert.match(schema, /active\s+Boolean\s+@default\(true\)/);
    assert.match(schema, /source\s+String\?/);
    assert.match(schema, /externalSourceId\s+String\?/);
  });
});

describe('visit contact relationships', () => {
  it('persists multiple actual contact IDs and backfills old visits', () => {
    const actions = read('app/visits/actions.ts');
    const migration = read('prisma/migrations/20260910190000_account_notes_contacts/migration.sql');
    assert.match(actions, /formData\.getAll\('contactId'\)/);
    assert.match(actions, /loggedVisitContact\.createMany/);
    assert.match(migration, /INSERT INTO "LoggedVisitContact"[\s\S]*FROM "LoggedVisit"[\s\S]*WHERE "contactId" IS NOT NULL/);
  });

  it('excludes inactive contacts from normal visit selection but preserves selected history', () => {
    const newPage = read('app/visits/new/page.tsx');
    const form = read('app/visits/LogVisitForm.tsx');
    assert.match(newPage, /where: \{ organizationId, active: true \}/);
    assert.match(form, /contact\.active \|\| contactIds\.includes\(contact\.id\)/);
  });

  it('adds a contact in-place and automatically selects the returned stable ID', () => {
    const form = read('app/visits/LogVisitForm.tsx');
    const route = read('app/api/contacts/route.ts');
    assert.match(form, /fetch\('\/api\/contacts'/);
    assert.match(form, /setContactIds\(\(current\) => \[\.\.\.current\.filter\(\(id\) => id !== created\.id\), created\.id\]\)/);
    assert.match(route, /organizationId, name/);
  });

  it('renders linked names while leaving old visits without links uncluttered', () => {
    const timeline = read('app/visits/VisitActivityTable.tsx');
    assert.match(timeline, /visit\.contacts\?\.map/);
    assert.match(timeline, /Met with \{contactNames\.join\(' and '\)\}/);
    assert.match(timeline, /contactNames\.length \?/);
  });
});

describe('native communication activity', () => {
  it('builds the correct mail and phone targets', () => {
    assert.equal(getCommunicationHref('email', ' sarah@example.com '), 'mailto:sarah@example.com');
    assert.equal(getCommunicationHref('phone', '(614) 555-0123'), 'tel:6145550123');
  });

  it('uses initiated language and organization-scoped activity writes', () => {
    assert.equal(getCommunicationTitle('EMAIL_INITIATED', 'Sarah Smith'), 'Email initiated to Sarah Smith');
    assert.equal(getCommunicationTitle('CALL_INITIATED', 'Sarah Smith'), 'Call initiated to Sarah Smith');
    const route = read('app/api/contact-activities/route.ts');
    const link = read('app/account-memory/CommunicationLink.tsx');
    assert.match(route, /getAccountContactWhere\(organizationId, location\)/);
    assert.match(route, /organizationId, activityType: kind, contactId: contact\.id, createdByUserId: user\.id/);
    assert.match(link, /keepalive: true/);
    assert.match(link, /href=\{href\}/);
    assert.doesNotMatch(route, /Email sent|Call completed/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAccountContactWhere, getAccountLocation, getCommunicationHref, getCommunicationTitle } from '../lib/accountMemory';
import { buildVCard, getVCardFilename, parseVCard } from '../lib/vCard';
import {
  buildIPhoneShortcutLaunchUrl,
  CONTACT_IMPORT_SOURCE,
  getContactImportExpiry,
  hashContactImportToken,
  validateContactImportSession,
} from '../lib/contactImport';
import { isShortcutUpdateRequired, parseContactImportPayload } from '../lib/contactImportPayload';

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

describe('phone contact transfer', () => {
  it('imports common phone vCards and prefers the selected mobile details', () => {
    const imported = parseVCard([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Smith;Sarah;;;',
      'FN:Sarah Smith',
      'TITLE:Buyer',
      'TEL;TYPE=WORK:614-555-0100',
      'item1.TEL;TYPE=CELL,PREF:+1 (614) 555-0123',
      'EMAIL;TYPE=INTERNET,PREF:sarah@example.com',
      'NOTE:Prefers text\\nAvailable afternoons',
      'UID:phone-contact-123',
      'END:VCARD',
    ].join('\r\n'));
    assert.deepEqual(imported, {
      name: 'Sarah Smith', role: 'Buyer', phone: '+1 (614) 555-0123', email: 'sarah@example.com',
      notes: 'Prefers text\nAvailable afternoons', externalSourceId: 'phone-contact-123',
    });
  });

  it('decodes folded quoted-printable names from older phone exports', () => {
    const imported = parseVCard([
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9=20=',
      'Corbin',
      'TEL;CELL:4196355440',
      'END:VCARD',
    ].join('\r\n'));
    assert.equal(imported.name, 'José Corbin');
    assert.equal(imported.phone, '4196355440');
  });

  it('exports a phone-ready vCard with account and contact details', () => {
    const card = buildVCard({
      accountName: 'Ethyl & Tank',
      contact: { id: 'contact-1', name: 'Corbin Smith', role: 'Buyer', phone: '14196355440', email: 'corbin@example.com', notes: 'Text first', updatedAt: new Date('2026-09-11T12:00:00Z') },
    });
    assert.match(card, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
    assert.match(card, /FN:Corbin Smith\r\nN:Smith;Corbin;;;/);
    assert.match(card, /ORG:Ethyl & Tank/);
    assert.match(card, /TEL;TYPE=VOICE:14196355440/);
    assert.match(card, /UID:neat-contact-contact-1/);
    assert.equal(getVCardFilename('Corbin Smith'), 'corbin-smith.vcf');
  });

  it('keeps downloads tenant-scoped and import controls mobile-accessible', () => {
    const route = read('app/api/contacts/[id]/vcard/route.ts');
    const panel = read('app/account-memory/AccountMemoryPanel.tsx');
    const importer = read('app/account-memory/ContactImportForm.tsx');
    assert.match(route, /where: \{ id, organizationId \}/);
    assert.match(route, /Content-Disposition.*attachment/);
    assert.match(route, /Content-Type.*text\/vcard/);
    assert.match(panel, />Save to phone<\/a>/);
    assert.match(importer, /Import from iPhone/);
    assert.match(importer, /accept="\.vcf,text\/vcard,text\/x-vcard"/);
  });
});

describe('iPhone Shortcut contact import', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const validSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    source: CONTACT_IMPORT_SOURCE,
    accountType: 'AGENCY',
    accountId: 'agency-1',
    expiresAt: new Date('2026-09-11T12:10:00Z'),
    consumedAt: null,
  };
  const context = {
    userId: 'user-1',
    organizationId: 'org-1',
    location: { accountType: 'AGENCY' as const, agencyId: 'agency-1' },
    now,
  };

  it('accepts only a valid, current session for the initiating user, tenant, and account', () => {
    assert.equal(validateContactImportSession(validSession, context), 'valid');
    assert.equal(validateContactImportSession({ ...validSession, expiresAt: now }, context), 'expired');
    assert.equal(validateContactImportSession({ ...validSession, consumedAt: now }, context), 'replayed');
    assert.equal(validateContactImportSession({ ...validSession, userId: 'user-2' }, context), 'wrong-user');
    assert.equal(validateContactImportSession({ ...validSession, organizationId: 'org-2' }, context), 'wrong-organization');
    assert.equal(validateContactImportSession({ ...validSession, accountId: 'agency-2' }, context), 'wrong-account');
    assert.equal(validateContactImportSession({ ...validSession, source: 'OTHER' }, context), 'wrong-source');
  });

  it('creates short-lived opaque state and passes only import configuration to the Shortcut', () => {
    assert.equal(getContactImportExpiry(now).toISOString(), '2026-09-11T12:10:00.000Z');
    assert.equal(hashContactImportToken('state'), hashContactImportToken('state'));
    assert.notEqual(hashContactImportToken('state'), hashContactImportToken('other'));
    const launchUrl = buildIPhoneShortcutLaunchUrl({ state: 'opaque-state', reviewUrl: 'https://neat.test/contact-import/review?state=opaque-state', requiredShortcutVersion: '1' });
    assert.match(launchUrl, /^shortcuts:\/\/run-shortcut\?name=Send%20to%20Neat/);
    const input = JSON.parse(new URLSearchParams(launchUrl.split('?')[1]).get('text') ?? '{}');
    assert.deepEqual(input, {
      schema: 'neat-contact-import', state: 'opaque-state',
      reviewUrl: 'https://neat.test/contact-import/review?state=opaque-state', requiredShortcutVersion: '1',
    });
    assert.equal('organizationId' in input, false);
    assert.equal('accountId' in input, false);
  });

  it('safely normalizes returned contact data and preserves alternatives for review', () => {
    const payload = parseContactImportPayload({
      schemaVersion: 1,
      shortcutVersion: '1',
      name: ' Sarah Smith\u0000 ',
      phones: ['614-555-0100', '614-555-0100', '+1 614-555-0199'],
      emails: ['buyer@example.com', 'personal@example.com'],
      jobTitle: 'Buyer',
    });
    assert.deepEqual(payload, {
      schemaVersion: 1, shortcutVersion: '1', name: 'Sarah Smith',
      phones: ['614-555-0100', '+1 614-555-0199'],
      emails: ['buyer@example.com', 'personal@example.com'], jobTitle: 'Buyer',
    });
    assert.equal(parseContactImportPayload({ schemaVersion: 1, shortcutVersion: '1', phones: [] }), null);
    assert.equal(parseContactImportPayload('malformed'), null);
  });

  it('detects obsolete Shortcut versions and renders the imported values into the review form', () => {
    assert.equal(isShortcutUpdateRequired('1', '1'), false);
    assert.equal(isShortcutUpdateRequired('1', '2'), true);
    const review = read('app/contact-import/review/ContactImportReviewForm.tsx');
    assert.match(review, /setPhone\(parsed\.phones\[0\]/);
    assert.match(review, /setEmail\(parsed\.emails\[0\]/);
    assert.match(review, />Update Shortcut<\/a>/);
    assert.match(review, /action=\{createAccountContact\}/);
  });

  it('does not create a Contact before explicit save and consumes the session atomically with normal creation', () => {
    const reviewPage = read('app/contact-import/review/page.tsx');
    const startRoute = read('app/api/contact-import/iphone/start/route.ts');
    const actions = read('app/account-memory/actions.ts');
    assert.doesNotMatch(reviewPage, /locationContact\.create/);
    assert.doesNotMatch(startRoute, /locationContact\.create/);
    assert.match(startRoute, /accountExists\(prisma, location\)/);
    assert.match(startRoute, /organizationId/);
    assert.match(actions, /contactImportSession\.updateMany/);
    assert.match(actions, /consumedAt: null, expiresAt: \{ gt: new Date\(\) \}/);
    assert.match(actions, /locationContact\.create/);
    assert.match(actions, /getAccountContactWhere\(organizationId, location\)/);
  });

  it('keeps manual Contact creation available without an import session', () => {
    const actions = read('app/account-memory/actions.ts');
    const importer = read('app/account-memory/ContactImportForm.tsx');
    assert.match(actions, /if \(importSessionToken\)/);
    assert.match(importer, /name="source" type="hidden" value=\{source\}/);
    assert.match(importer, />Upload \.vcf<\/button>/);
    assert.match(importer, /<summary>Enter or review contact<\/summary>/);
  });
});

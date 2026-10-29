import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { FEATURE_KEYS, getEnvironmentFeatureKeys, validateFeatureSelection } from '../lib/featureRegistry';
import { getMoreNavigationItems, getNavigationItems } from '../app/components/navigationConfig';
import { getCommunicationHref } from '../lib/accountMemory';

const source = (path: string) => readFileSync(path, 'utf8');
function load(path: string, mocks: Record<string, unknown>) {
  const filename = resolve(path), nativeRequire = createRequire(filename), exports: Record<string, any> = {};
  const code = ts.transpileModule(source(path), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { exports, process, require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name) });
  return exports;
}

test('Communications cannot return through old entitlements or mobile and desktop navigation', async () => {
  for (const env of ['test', 'production', 'development']) {
    const organizations = load('lib/organizations.ts', {
      './prisma': { prisma: { organizationFeature: {
        findMany: async () => [{ featureKey: 'CORE_CRM' }, { featureKey: 'COMMUNICATIONS' }],
        findFirst: async () => assert.fail('retired features must stop before entitlement lookup'),
      } } },
      './featureRegistry': { FEATURE_KEYS, getEnvironmentFeatureKeys, validateFeatureSelection },
    });
    const prior = process.env.APP_ENV;
    try {
      process.env.APP_ENV = env;
      const features = await organizations.getOrganizationFeatures('org_echo_spirits');
      assert.equal(features.has('COMMUNICATIONS'), false);
      assert.equal(features.has('CORE_CRM'), true);
      assert.equal(await organizations.hasFeature('org_echo_spirits', 'COMMUNICATIONS'), false);
    } finally {
      if (prior === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = prior;
    }
  }
  assert.deepEqual(validateFeatureSelection(['CORE_CRM', 'COMMUNICATIONS']).enabled, ['CORE_CRM']);
  for (const admin of [false, true]) for (const platform of [false, true]) {
    const features = [...FEATURE_KEYS, 'COMMUNICATIONS'];
    const items = [...getNavigationItems('work', features, platform), ...getMoreNavigationItems(admin, features, platform)];
    assert.ok(items.every(item => item.href !== '/settings/communications'));
    assert.ok(items.some(item => item.href === '/alerts'));
  }
});

test('mailbox, SMS, suggestion, AI and cron entry points are retired', () => {
  for (const path of [
    'app/settings/communications/page.tsx', 'app/settings/communications/sms-actions.ts', 'app/crm/actions.ts',
    'app/api/crm/mail/[provider]/connect/route.ts', 'app/api/crm/mail/[provider]/callback/route.ts',
    'app/api/crm/sms/[id]/route.ts', 'app/api/crm/sms/contact/[id]/route.ts', 'app/api/cron/communications/route.ts',
    'app/account-memory/contact-suggestion-actions.ts', 'app/account-memory/assistant-actions.ts',
    'app/admin/organization/ai-actions.ts', 'lib/crm/mail/oauth.ts', 'lib/crm/mail/sync.ts',
    'lib/crm/sms/service.ts', 'lib/crm/contactSuggestions.ts', 'lib/crm/ai.ts', 'lib/crm/aiEvidence.ts',
  ]) assert.equal(existsSync(path), false, path);
  assert.ok(JSON.parse(source('vercel.json')).crons.every((cron: { path: string }) => cron.path !== '/api/cron/communications'));
  assert.equal(JSON.parse(source('package.json')).dependencies.twilio, undefined);
});

test('CRM actions still resolve the authenticated Echo context without the retired pilot', async () => {
  const user = { id: 'rep', organizationId: 'org_echo_spirits' };
  const auth = load('lib/crm/auth.ts', {
    '../auth': { requireUser: async () => user },
    '../organizations': { requireFeatureForUser: async (actor: unknown, feature: string) => {
      assert.equal(actor, user); assert.equal(feature, 'CORE_CRM');
      return { organizationId: user.organizationId, organization: { timezone: 'America/New_York' } };
    } },
  });
  const result = await auth.requireCrmActor();
  assert.deepEqual({ ...result.actor }, { userId: 'rep', organizationId: 'org_echo_spirits' });
  assert.equal(result.timezone, 'America/New_York');
});

test('account briefing keeps existing evidence and next actions without a communication assistant or settings read', async () => {
  const account = { accountType: 'AGENCY', accountId: 'account' }, actor = { organizationId: 'org_echo_spirits', userId: 'rep' };
  const component = load('app/components/AccountBriefing.tsx', {
    '../../lib/prisma': { prisma: new Proxy({}, { get: () => assert.fail('briefing must not read removed AI settings') }) },
    '../../lib/crm/briefing': { getAccountBriefing: async (_db: unknown, a: unknown, ref: unknown) => {
      assert.equal(a, actor); assert.equal(ref, account);
      return { health: { score: null, reasons: [], missing: [] }, indicators: { reasons: [], nextAction: 'Review overdue Worklist commitments' }, lastContact: null, lastMeaningful: null, lastVisit: null, lastFollowUp: null, tasks: [], pipeline: null };
    } },
  });
  const html = renderToStaticMarkup(await component.AccountBriefing({ account, actor }));
  assert.match(html, /Account briefing|Review overdue Worklist commitments/);
  assert.doesNotMatch(html, /assistant|AI enabled|private communications|Draft a response/);
});

test('ordinary contact actions, manual interactions, Worklist calendar sync and historical records remain', () => {
  assert.equal(getCommunicationHref('email', 'buyer@example.com'), 'mailto:buyer@example.com');
  assert.match(getCommunicationHref('phone', '6145550123'), /^tel:/);
  assert.doesNotMatch(source('app/account-memory/AccountMemoryPanel.tsx'), /AccountCommunications|ContactSuggestions|SmsConversation/);
  assert.match(source('app/account-memory/AccountMemoryPanel.tsx'), /CommunicationLink|ContactImportForm|ContactRelationships/);
  for (const path of ['app/api/contact-activities/route.ts', 'app/visits/actions.ts', 'app/api/cron/calendar-sync/route.ts']) assert.ok(existsSync(path), path);
  for (const model of ['MailboxConnection', 'MailboxOAuthState', 'SmsConnection', 'SmsMessage', 'SmsConsent', 'SmsConsentEvent', 'ContactSuggestionReview', 'AccountActivity', 'LocationContact']) {
    assert.match(source('prisma/schema.prisma'), new RegExp(`model ${model} \\{`));
  }
});

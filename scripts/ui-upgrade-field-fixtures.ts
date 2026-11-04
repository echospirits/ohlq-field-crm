// Synthetic, credential-free render fixtures for the actual field UI sources.
// Services and actions are replaced; this does not test a live database or writes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement as h, type ReactNode } from 'react';
import { z } from 'zod';

const FIXTURE_NOW = Date.parse('2026-11-04T17:00:00Z');
const ORG = 'ui-fixture-organization';
const USER = 'ui-fixture-representative';

class FixtureDate extends Date {
  constructor(value?: string | number | Date) {
    super(value instanceof Date ? value.getTime() : value ?? FIXTURE_NOW);
  }
  static now() { return FIXTURE_NOW; }
}

type ModuleExports = Record<string, any>;
type Mocks = Record<string, unknown>;

/** revision reads committed UI source without changing the checkout. */
function fixtureLoader(revision?: string) {
  if (revision && (!/^[A-Za-z0-9_./-]+$/.test(revision) || revision.startsWith('-'))) throw Error('Invalid fixture revision');
  const read = (path: string) => revision
    ? execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    : readFileSync(resolve(path), 'utf8');
  return (path: string, mocks: Mocks = {}): ModuleExports => {
    const filename = resolve(path), nativeRequire = createRequire(filename), exports: ModuleExports = {};
    const code = ts.transpileModule(read(path), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    runInNewContext(code, {
      exports, process, console, URL, URLSearchParams, Date: FixtureDate, Intl, Set, Map,
      require: (name: string) => Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : nativeRequire(name),
    }, { filename });
    return exports;
  };
}

import ts from 'typescript';

const blockedAction = async () => { throw Error('Synthetic UI fixture must never execute a server action'); };
const link = { default: ({ children, ...props }: any) => h('a', props, children) };
const form = ({ children, className, submitLabel }: any) => h('form', { action: '#fixture', className: className ?? 'crm-form', 'data-fixture-form': true }, children, submitLabel ? h('button', { type: 'button', disabled: true }, submitLabel) : null);
const submit = { SubmitButton: ({ children, pendingLabel: _pending, ...props }: any) => h('button', { ...props, type: 'button' }, children) };
const user = { id: USER, organizationId: ORG, email: 'representative@example.invalid', firstName: 'Fixture', lastName: 'Rep', name: 'Fixture Rep', role: 'ADMIN', isActive: true };
const teammate = { ...user, id: 'ui-fixture-teammate', firstName: 'Fixture', lastName: 'Manager', name: 'Fixture Manager' };
const auth = { requireUser: async () => user, getUserDisplayName: (value: any) => value.name ?? value.email ?? 'Fixture user' };

export async function buildFieldFixtures(revision?: string): Promise<Record<string, ReactNode>> {
  const load = fixtureLoader(revision);
  const current = fixtureLoader();
  const accountConfig = current('lib/crm/accountConfiguration.ts');
  const stages = current('lib/crm/pipelineStages.ts');
  const health = current('lib/crm/health.ts');
  const dates = current('lib/dateTime.ts');
  const activity = current('lib/crm/activity.ts');
  const profileDetails = {
    kind: 'ON_PREMISE', territoryId: '10000000-0000-4000-8000-000000000001', teamId: '10000000-0000-4000-8000-000000000002',
    custom: { '10000000-0000-4000-8000-000000000003': 'Buyer reviews new placements on Thursdays' },
    parent: { accountType: 'WHOLESALE', accountId: 'fixture-parent' }, documents: [{ name: 'Synthetic account plan', url: 'https://example.invalid/account-plan' }],
  };
  const plan = {
    stageKey: 'fixture-trial', objectives: 'Confirm the autumn cocktail placement and agree the first order with the buyer.',
    products: 'Fixture White Rum · Fixture Rye', estimatedRevenue: 2400, estimatedVolume: 96, probability: 65,
    expectedCloseDate: '2026-11-20', competitors: 'Two existing well placements', objections: 'Buyer needs a case-price comparison', placementEvidence: '',
  };
  const crmPreferences = {
    health: {}, pipelineStages: { version: 1, stages: [{ id: 'fixture-trial', name: 'Buyer evaluation', status: 'INTERESTED' }] },
    accountConfiguration: { version: 1, categories: [],
      territories: [{ id: '10000000-0000-4000-8000-000000000001', name: 'Fixture Central Ohio', states: 'OH', counties: '', postalCodes: '', ownerUserId: USER }],
      teams: [{ id: '10000000-0000-4000-8000-000000000002', name: 'Fixture Field Team', memberIds: [USER] }],
      fields: [{ id: '10000000-0000-4000-8000-000000000003', name: 'Buyer preference', type: 'TEXT' }],
    },
  };
  const names = ['Fixture Harbor Room', 'Fixture North Market Kitchen & Cocktail House', 'Fixture Union Provisions', 'Fixture River Bend', 'Fixture Long-Named Neighborhood Hospitality Group', 'Fixture Juniper Table', 'Fixture Oak & Elm', 'Fixture Westgate Lounge', 'Fixture Town Hall', 'Fixture Foundry Kitchen'];
  const statuses = ['INTERESTED', 'WAITING_ON_ORDER', 'ENGAGED', 'TARGET', 'CONTACTED', 'PURCHASING', 'NURTURE', 'INTERESTED', 'ENGAGED', 'WAITING_ON_ORDER'];
  const accounts = names.map((name, index) => ({ id: `fixture-account-${index + 1}`, name, city: index % 3 === 0 ? 'Columbus' : index % 3 === 1 ? 'Grandview Heights' : 'Dublin', state: 'OH', county: 'Franklin', zip: '43215' }));
  const overlays = accounts.map((account, index) => ({
    organizationId: ORG, externalAccountId: account.id, accountType: 'WHOLESALE', assignedUserId: index % 4 === 0 ? null : index % 2 ? USER : teammate.id,
    salesStatus: statuses[index], salesStatusUpdatedAt: new FixtureDate(FIXTURE_NOW - (index * 6 + 3) * 86_400_000),
    isTargeting: index === 0 || index === 3, crmDetails: profileDetails, crmDetailsVersion: 1,
    salesPlan: index % 3 === 0 ? plan : { ...plan, estimatedRevenue: index % 2 ? null : 1800 + index * 100, probability: index % 2 ? null : 50 }, salesPlanVersion: 1,
  }));
  const tasks = accounts.slice(0, 8).map((account, index) => ({
    id: `fixture-task-${index + 1}`, organizationId: ORG, agencyId: null, wholesaleAccountId: account.id,
    title: index % 2 ? 'Confirm tasting date with buyer' : 'Send case-price comparison and confirm next order',
    detail: index === 0 ? 'Bring the agreed two-product comparison. Buyer can meet before service at 2 PM.' : 'Confirm the commitment with the account contact.',
    dueDate: index === 7 ? null : new FixtureDate(index === 0 ? '2026-11-02T00:00:00Z' : `2026-11-${String(5 + index).padStart(2, '0')}T00:00:00Z`),
    dueTimeMinutes: 14 * 60, assignedToUserId: index % 3 ? USER : null, assignedToUser: index % 3 ? user : null, assignedTo: null,
    status: index === 1 ? 'IN_PROGRESS' : 'OPEN', category: 'WHOLESALE', source: 'MANUAL', salesOpportunityId: null, agencyProductIntelligenceId: null,
    agencyProductIntelligence: null, calendarEvents: index === 0 ? [{ syncStatus: 'ERROR', syncError: 'Fixture calendar connection needs attention.' }] : [],
  }));
  tasks.push({ ...tasks[0], id: 'fixture-future-check-in', title: 'Fixture future check-in', dueDate: new FixtureDate('2026-11-10T00:00:00Z'), calendarEvents: [] });
  const db = {
    organization: { findUniqueOrThrow: async () => ({ id: ORG, crmPreferences }) },
    organizationAccountOverlay: { findMany: async () => overlays, findUnique: async () => overlays[0] },
    agency: { findMany: async () => [], findUnique: async () => ({ state: 'OH', county: 'Franklin', zip: '43215', name: 'Fixture Parent Group' }) },
    wholesaleAccount: { findMany: async () => accounts, findUnique: async ({ where }: any) => where.id === 'fixture-parent' ? { ...accounts[0], name: 'Fixture Parent Group' } : accounts[0] },
    user: { findMany: async () => [user, teammate] },
    loggedVisit: { findMany: async () => accounts.filter((_, index) => index % 3 !== 0).map((account, index) => ({ agencyId: null, wholesaleAccountId: account.id, visitAt: new FixtureDate(FIXTURE_NOW - (index * 9 + 2) * 86_400_000) })) },
    worklistItem: { findMany: async () => tasks },
    accountSalesEvent: { findMany: async () => accounts.filter((_, index) => index % 2 === 0).map((account, index) => ({ wholesaleAccountId: account.id, reportDate: new FixtureDate(FIXTURE_NOW - (index * 20 + 4) * 86_400_000) })) },
    accountSalesStatusHistory: { findMany: async () => [{ id: 'fixture-change', accountType: 'WHOLESALE', externalAccountId: accounts[0].id, previousStatus: 'ENGAGED', newStatus: 'INTERESTED', source: 'MANUAL', changedAt: new FixtureDate('2026-11-03T15:00:00Z') }] },
    accountActivity: { findMany: async () => [] }, ohlqAnnualSalesRow: { findMany: async () => [] },
    locationContact: { findMany: async () => [] }, tag: { findMany: async () => [] }, salesPlaybook: { findMany: async () => [] }, playbookRun: { findMany: async () => [] },
  };
  const tenant = { getOrganizationTenantConfig: async () => ({ organizationId: ORG, productLabel: 'Fixture', productPluralLabel: 'Fixture products' }) };
  const salesStatus = current('lib/accountSalesStatus.ts', {
    './crm/health': health, './accountSalesEvents': { captureWholesaleSalesEvents: blockedAction }, './ohlqSalesData': { getTenantSalesWhere: () => ({}) },
    './prisma': { prisma: db }, './echoAccess': { ECHO_ORGANIZATION_ID: ORG }, './tenantConfig': tenant,
  });
  const pipeline = current('lib/crm/pipeline.ts', { '../accountSalesStatus': { ...salesStatus, setAccountSalesStatus: blockedAction }, './pipelineStages': stages, './activity': activity });
  const PageChrome = load('app/components/PageChrome.tsx');
  const recordPicker = load('app/components/RecordPicker.tsx');
  const scope = load('app/pipeline/PipelineScopeFilter.tsx', {
    'next/navigation': { useRouter: () => ({ replace: blockedAction }), useSearchParams: () => new URLSearchParams() }, '../components/RecordPicker': recordPicker,
  });
  const journey = load('app/components/SalesStatusJourney.tsx', { 'next/link': link, '../../lib/accountSalesStatus': salesStatus });
  const page = load('app/pipeline/page.tsx', {
    'next/link': link, '../../lib/crm/pipelineStages': stages, '../../lib/crm/accountConfiguration': accountConfig, './PipelineScopeFilter': scope,
    '../../lib/crm/health': health, '../../lib/crm/pipeline': pipeline, '../../lib/crm/activity': { visibleActivityWhere: () => ({ organizationId: ORG }) },
    '../../lib/auth': auth, '../../lib/accountSalesStatus': salesStatus, '../../lib/dateTime': dates,
    '../../lib/organizations': { requireFeatureForUser: async () => ({ organizationId: ORG }) }, '../../lib/ohlqSalesData': { getTenantSalesWhere: () => ({}) },
    '../../lib/prisma': { prisma: db }, '../../lib/tenantConfig': tenant, '../components/PageChrome': PageChrome, '../components/SalesStatusJourney': journey,
  });
  const profile = load('app/components/AccountProfile.tsx', {
    'next/link': link, './AccountDocuments': load('app/components/AccountDocuments.tsx'), '../../lib/prisma': { prisma: db }, '../../lib/crm/accountConfiguration': accountConfig,
    './CrmForm': { CrmForm: form }, './CrmAccountPicker': { CrmAccountPicker: () => h('p', { className: 'muted' }, 'Fixture parent-account picker') },
    './RecordPicker': recordPicker, '../account-memory/metadata-actions': { saveAccountMetadataAction: blockedAction },
  });
  const accountPlan = load('app/components/AccountSalesPlan.tsx', {
    '../../lib/crm/pipelineStages': stages, './RecordPicker': recordPicker, '../../lib/prisma': { prisma: db },
    '../../lib/crm/auth': { requireCrmActor: async () => ({ actor: { organizationId: ORG, userId: USER } }) }, '../../lib/crm/pipeline': pipeline,
    '../pipeline/actions': { saveSalesPlanAction: blockedAction }, './CrmForm': { CrmForm: form },
  });
  const reactivation = current('lib/ohlqWholesaleReactivation.ts', {
    './ohlqSalesData': {}, './ohlqDataStatus': {}, './ohlqWholesaleMatching': {}, './prisma': { prisma: db },
    './tenantConfig': { getTenantConfig: () => ({ productLabel: 'Fixture' }) }, './organizations': { ECHO_ORGANIZATION_ID: ORG },
  });
  const detail = load('app/alerts/WorklistDetail.tsx', { '../../lib/ohlqWholesaleReactivation': reactivation });
  const actions = load('app/alerts/WorklistActions.tsx', {
    '../components/SubmitButton': submit, '../components/ActionForm': { ActionForm: form }, '../components/useDialogFocus': { useDialogFocus: () => undefined },
    '../visits/LogVisitForm': { LogVisitForm: () => h('p', null, 'Fixture visit form; no records saved') },
  });
  const playbooks = load('app/account-memory/AccountPlaybooks.tsx', {
    '../components/CrmForm': { CrmForm: form }, '../components/RecordPicker': recordPicker,
    './playbook-actions': { startPlaybookAction: blockedAction, cancelPlaybookAction: blockedAction },
  });
  const worklist = load('app/components/AccountWorklist.tsx', {
    '../account-memory/AccountPlaybooks': playbooks, '../../lib/crm/playbooks': { playbookStep: z.object({}) },
    '../../lib/accountWorklist': { getAccountWorklist: async () => tasks.slice(0, 3) }, '../../lib/auth': auth, '../../lib/prisma': { prisma: db },
    '../../lib/dateTime': dates, '../../lib/ohlqWholesaleReactivation': reactivation, '../alerts/WorklistActions': actions, '../alerts/WorklistDetail': detail,
    '../alerts/actions': { updateWorklistItem: blockedAction, updateWorklistStatus: blockedAction }, '../visits/actions': { createVisit: blockedAction },
  });
  const profileNode = await profile.AccountProfile({ organizationId: ORG, accountType: 'WHOLESALE', accountId: accounts[0].id });
  const planNode = await accountPlan.AccountSalesPlan({ account: { accountType: 'WHOLESALE', accountId: accounts[0].id } });
  const worklistNode = await worklist.AccountWorklist({ organizationId: ORG, accountId: accounts[0].id, accountName: accounts[0].name, accountType: 'WHOLESALE', currentUserId: USER, actorName: 'Fixture Rep', enabledFeatures: new Set<string>() });
  return {
    pipeline: await page.default({ searchParams: Promise.resolve({}) }),
    'account-profile': profileNode,
    'account-plan': planNode,
    'account-worklist': worklistNode,
    account: h('div', { className: 'field-account-fixture' }, h('header', { className: 'page-header page-heading' }, h('div', null, h('h1', null, accounts[0].name), h('p', { className: 'muted' }, 'Synthetic restaurant · Columbus'))), worklistNode, planNode, profileNode),
  };
}

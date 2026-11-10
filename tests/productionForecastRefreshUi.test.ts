import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import type { ForecastRefreshState } from '../lib/productionForecasting/refreshState';

type Element = { type: unknown; props: Record<string, any> };
type Result = { ok: boolean; state: ForecastRefreshState; error?: string };
const idle = (): ForecastRefreshState => ({ configured: true, unavailableReason: null, job: null, lastSuccessfulAt: null });
const job = (status: NonNullable<ForecastRefreshState['job']>['status'], id = 'refresh-a'): ForecastRefreshState => ({
  ...idle(), job: { id, status, stage: null, message: status === 'SUCCEEDED' ? 'Source reports downloaded and forecasts saved.' : status === 'PARTIAL' ? 'Refresh incomplete. Review source dates and retry.' : status === 'QUEUED' ? 'Refresh queued. This may take a few minutes.' : status === 'RUNNING' ? 'Downloading source reports and calculating forecasts…' : 'Refresh could not finish. Review source dates and retry.', requestedAt: '2026-11-10T16:00:00Z', startedAt: null, completedAt: null, expiresAt: null },
});
const jsx = (type: unknown, properties: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: { ...properties, children } });
const elements = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
const settled = () => new Promise(setImmediate);

/** Exercise real handlers/effects without starting a provider or background job. */
function harness({ initial = idle(), request = async () => ({ ok: true, state: job('QUEUED') }), status = async () => ({ ok: true, state: job('RUNNING') }) }: { initial?: ForecastRefreshState; request?: (organizationId: string) => Promise<Result>; status?: (organizationId: string) => Promise<Result> } = {}) {
  const slots: any[] = [], effects: Array<() => void> = [], timers = new Map<number, () => Promise<void>>();
  let cursor = 0, nextTimer = 0, refreshes = 0;
  const router = { refresh() { refreshes++; }, push() { throw Error('Refresh must preserve the current route'); }, replace() { throw Error('Refresh must preserve the current route'); } };
  const hooks = {
    useId: () => 'refresh-description',
    useState(value: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect(callback: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  const module = { exports: {} as { ForecastRefreshControl: (props: { organizationId: string; initialState: ForecastRefreshState }) => Element } };
  const source = ts.transpileModule(readFileSync('app/analytics/production/ForecastRefreshControl.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(source, { module, exports: module.exports, React: { createElement: jsx }, URLSearchParams, Intl, Date,
    window: { setTimeout(callback: () => Promise<void>, delay: number) { assert.equal(delay, 5000); const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id: number) { timers.delete(id); } },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'next/navigation') return { useRouter: () => router };
      if (name === 'next/link') return { default: 'a' };
      if (name === './refreshActions') return { requestForecastRefresh: request, getForecastRefreshStatus: status };
      throw Error(`Unexpected refresh UI dependency ${name}`);
    },
  });
  const render = () => { cursor = 0; const tree = module.exports.ForecastRefreshControl({ organizationId: 'org_echo_spirits', initialState: initial }); while (effects.length) effects.shift()!(); return tree; };
  const button = (tree = render()) => elements(tree).find(node => node.type === 'button')!;
  return { render, button, timers, refreshes: () => refreshes,
    async click() { button().props.onClick(); await settled(); },
    async tick() { const next = timers.entries().next().value; assert.ok(next, 'An active job must have a bounded poll'); timers.delete(next[0]); await next[1](); await settled(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('one click requests the explicit organization, prevents duplicates and waits for saved forecasts before refreshing the route', async () => {
  let requests = 0, finish: (value: Result) => void = () => {};
  const states = [job('RUNNING'), job('SUCCEEDED')];
  const h = harness({ request: async organizationId => { assert.equal(organizationId, 'org_echo_spirits'); requests++; return new Promise(resolve => { finish = resolve; }); }, status: async organizationId => { assert.equal(organizationId, 'org_echo_spirits'); return { ok: true, state: states.shift()! }; } });
  h.button().props.onClick(); h.button().props.onClick();
  assert.equal(requests, 1); assert.equal(h.button().props.disabled, true);
  assert.match(text(h.render()), /Requesting refresh/); assert.equal(h.refreshes(), 0);
  finish({ ok: true, state: job('QUEUED') }); await settled();
  assert.match(text(h.render()), /Refresh queued/); assert.equal(h.refreshes(), 0);
  await h.tick(); assert.match(text(h.render()), /Downloading source reports/); assert.equal(h.refreshes(), 0);
  await h.tick(); assert.match(text(h.render()), /Source reports downloaded and forecasts saved/);
  assert.equal(h.refreshes(), 1); assert.equal(h.timers.size, 0); assert.equal(h.button().props.disabled, false);
});

test('an active persisted job resumes polling on return, but an old successful job does not refresh repeatedly', async () => {
  const h = harness({ initial: job('RUNNING'), status: async () => ({ ok: true, state: job('SUCCEEDED') }) });
  assert.equal(h.render().props['aria-busy'], true); assert.equal(h.button().props.disabled, true);
  await h.tick(); h.render(); h.render(); assert.equal(h.refreshes(), 1); assert.equal(h.timers.size, 0);
  const completed = harness({ initial: job('SUCCEEDED') }); completed.render(); assert.equal(completed.refreshes(), 0); assert.equal(completed.timers.size, 0);
});

test('partial, failed and timed-out jobs refresh source warnings without claiming all data is fresh and permit retry', async () => {
  for (const status of ['PARTIAL', 'FAILED', 'TIMED_OUT'] as const) {
    const h = harness({ initial: job('RUNNING'), status: async () => ({ ok: true, state: job(status) }) });
    h.render(); await h.tick(); const tree = h.render();
    assert.equal(h.refreshes(), 1); assert.match(text(h.button(tree)), /Retry refresh/);
    assert.ok(elements(tree).some(node => node.props.role === 'status' && node.props.className === 'pf-refresh-warning'));
    assert.doesNotMatch(text(tree), /all data.*fresh|Source reports downloaded and forecasts saved/);
    assert.match(text(tree), /Each refresh downloads warehouse inventory/);
    assert.match(text(tree), /demand and delivery snapshots may be reused/);
    assert.doesNotMatch(text(tree), /warehouse snapshots may be reused/);
  }
});

test('an uncertain request checks progress before another write and recovers a completed background refresh', async () => {
  let requests = 0, checks = 0;
  const h = harness({ request: async () => { requests++; throw Error('PRIVATE response'); }, status: async () => { checks++; return { ok: true, state: job('SUCCEEDED') }; } });
  await h.click(); const tree = h.render();
  assert.match(text(tree), /Could not confirm the request/); assert.doesNotMatch(text(tree), /PRIVATE/);
  assert.match(text(h.button(tree)), /Check progress/); assert.equal(h.refreshes(), 0);
  await h.click(); h.render(); assert.equal(requests, 1); assert.equal(checks, 1); assert.equal(h.refreshes(), 1);
});

test('a failed status read stops automatic polling and offers a safe manual progress check', async () => {
  let attempts = 0;
  const h = harness({ initial: job('RUNNING'), status: async () => { attempts++; if (attempts === 1) throw Error('PRIVATE token'); return { ok: true, state: job('RUNNING') }; } });
  h.render(); await h.tick(); const tree = h.render();
  assert.match(text(tree), /refresh may still be running/); assert.equal(h.timers.size, 0);
  assert.match(text(h.button(tree)), /Check progress/); assert.equal(h.button(tree).props.disabled, false); assert.equal(h.refreshes(), 0);
  await h.click(); h.render(); assert.equal(h.timers.size, 1); assert.equal(h.button().props.disabled, true);
});

test('configuration-disabled state explains the unavailable action with a scoped settings link and never requests a job', async () => {
  let calls = 0;
  const h = harness({ initial: { ...idle(), configured: false, unavailableReason: 'Source connection needs setup.' }, request: async () => { calls++; return { ok: true, state: job('QUEUED') }; } });
  const tree = h.render(); assert.equal(h.button(tree).props.disabled, true); assert.match(text(tree), /Source connection needs setup/);
  assert.ok(elements(tree).some(node => node.props.href === '/analytics/production/settings?organization=org_echo_spirits'));
  await h.click(); assert.equal(calls, 0); assert.equal(h.timers.size, 0);
});

test('an unmounted control cancels polling and ignores a late response', async () => {
  let finish: (result: Result) => void = () => {};
  const h = harness({ initial: job('RUNNING'), status: async () => new Promise(resolve => { finish = resolve; }) });
  h.render(); const pending = h.tick(); h.unmount(); finish({ ok: true, state: job('SUCCEEDED') }); await pending;
  assert.equal(h.refreshes(), 0); assert.equal(h.timers.size, 0);
});

test('completion time labels do not replace report source dates or expose provider infrastructure', () => {
  const initial = { ...job('SUCCEEDED'), lastSuccessfulAt: '2026-11-10T16:11:00Z' };
  const tree = harness({ initial }).render();
  assert.match(text(tree), /Last completed Nov 10, 11:11 AM EST.*report dates below/);
  assert.ok(elements(tree).some(node => node.type === 'time' && node.props.dateTime === initial.lastSuccessfulAt));
  assert.doesNotMatch(text(tree), /GitHub|workflow|runner|upload/i);
});

test('forecast page puts the refresh control in the header for Admins only, retains filters/horizon, and removes manual upload UI', async () => {
  const control = Symbol('ForecastRefreshControl'), header = Symbol('PageHeader'), table = Symbol('ForecastTable');
  for (const role of ['ADMIN', 'PLATFORM_ADMIN', 'USER']) {
    let reads = 0;
    const module = { exports: {} as { default: (props: unknown) => Promise<Element> } };
    const deps: Record<string, unknown> = {
      'next/link': { default: 'a' }, '../../../lib/auth': { requireUserSession: async () => ({ user: { role } }) },
      '../../../lib/productionForecasting/access': { requireProductionForecastContext: async () => ({ organization: { id: 'org_echo_spirits' }, platform: false }) },
      '../../../lib/productionForecasting/service': { getProductionDashboard: async () => ({ rows: [], run: null, today: '2026-11-10', latestImports: [] }) },
      '../../../lib/productionForecasting/model': { parseForecastHorizon: () => 60 }, '../../../lib/userAccess': { isAdminRole: (role: string) => ['ADMIN', 'PLATFORM_ADMIN'].includes(role) },
      '../../components/PageChrome': { PageHeader: header }, '../../components/AnchoredDetails': { AnchoredDetails: 'details' },
      './ForecastTable': { ForecastTable: table }, './ForecastConfidenceHelp': { ForecastConfidenceHelp: 'help' }, './ForecastRefreshControl': { ForecastRefreshControl: control },
      '../../../lib/productionForecasting/refreshRequests': { getForecastRefreshState: async () => { reads++; return idle(); } },
      '../../../lib/productionForecasting/operationalSignals/persistence': { getDeliveryAvailabilitySignals: async () => ({}) },
      '../../../lib/productionForecasting/operationalSignals/warehouseBalance': { getWarehouseBalanceSignals: async () => ({ rows: [] }) }, './OperationalSignals': { DeliveryAvailability: 'delivery' },
    };
    const source = ts.transpileModule(readFileSync('app/analytics/production/page.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(source, { module, exports: module.exports, React: { createElement: jsx }, URLSearchParams, require: (name: string) => name.endsWith('.css') ? {} : deps[name] ?? (() => { throw Error(`Unexpected forecast page dependency ${name}`); })() });
    const tree = await module.exports.default({ searchParams: Promise.resolve({ horizon: '60', q: '3150B', market: 'OH', sort: 'name' }) });
    const pageHeader = elements(tree).find(node => node.type === header)!;
    assert.equal(pageHeader.props.actions?.type === control, role !== 'USER'); assert.equal(reads, role === 'USER' ? 0 : 1);
    const forecastTable = elements(tree).find(node => node.type === table)!;
    assert.equal(forecastTable.props.horizon, 60); assert.equal(forecastTable.props.initial.q, '3150B'); assert.equal(forecastTable.props.initial.sort, 'name');
    assert.doesNotMatch(text(tree), /Import source reports|Upload |CSV or TSV/);
    assert.equal(elements(tree).some(node => node.props.href === '#source-import'), false);
  }
});

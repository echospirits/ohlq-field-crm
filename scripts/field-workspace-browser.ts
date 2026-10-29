// Credential-free acceptance of actual shared components and styles.
// This verifies layout/native disclosures, not hydrated server actions or live CRM writes.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import ts from 'typescript';
import { AccountBriefingView } from '../app/components/AccountBriefingView';
import { FEATURE_KEYS } from '../lib/featureRegistry';

function load(path: string, mocks: Record<string, unknown>) {
  const filename = resolve(path), nativeRequire = createRequire(filename), exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { exports, process, URLSearchParams, Date, require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name) });
  return exports;
}

async function main() {
  const link = { default: ({ children, ...props }: any) => h('a', props, children) };
  const nav = load('app/components/AppNavigation.tsx', { 'next/navigation': { usePathname: () => '/' }, 'next/link': link });
  const route = load('app/my-week/RoutePlanner.tsx', {
    'next/link': link, './route-actions': { suggestRoute: () => { throw Error('Fixture must not call server actions'); }, saveRouteAction: '#fixture' },
    '../components/CrmForm': { CrmForm: ({ children }: any) => h('form', null, children) },
  });
  const events = load('app/events/ScheduleEvents.tsx', {
    'next/link': link,
    '../../lib/auth': { getUserDisplayName: (user: any) => user.name },
    '../../lib/prisma': { prisma: { eventShift: { findMany: async () => [] }, user: { findMany: async () => [] }, organization: { findUniqueOrThrow: async () => ({ timezone: 'America/New_York' }) } } },
    './EventEditor': { EventEditor: () => h('p', null, 'Event editor fixture; no records are saved.') },
  });
  const scheduleEvents = await events.ScheduleEvents({ organizationId: 'fixture' });
  const nearby = load('app/components/NearbyAccountsSection.tsx', {
    'next/link': link,
    react: { useEffect: () => undefined, useState: (initial: unknown) => [Array.isArray(initial) ? [
      { id: 'nearby-one', name: 'Nearby fixture account', city: 'Columbus', distanceMiles: 0.4, lastVisitAt: null },
      { id: 'nearby-two', name: 'Previously visited fixture', city: 'Columbus', distanceMiles: 1.2, lastVisitAt: '2026-10-27T16:00:00Z' },
    ] : initial, () => undefined] },
    './useCurrentLocation': { useCurrentLocation: () => ({ location: { latitude: 0, longitude: 0, accuracy: 10 }, status: 'ready', requestLocation: () => undefined }) },
  });
  const styles = ['styles.css', 'crm/crm.css', 'redesign.css', 'theme.css', 'field-workspace.css', 'workspace-foundation.css'].map(p => readFileSync(`app/${p}`, 'utf8')).join('\n');
  const permissions = { enabledFeatures: [...FEATURE_KEYS], isAdmin: true, isPlatformAdmin: false, isTaster: false };
  const brief = { lastContact: null, lastMeaningful: null, lastVisit: null, lastFollowUp: null,
    health: { score: null, reasons: [], missing: ['Meaningful contact history'], contactDays: 30 },
    indicators: { status: 'Insufficient evidence', reasons: [], nextAction: 'Identify a buyer or decision-maker', days: null } };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors: string[] = [], checks: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  mkdirSync('output/playwright', { recursive: true });
  try {
    for (const theme of ['light', 'dark']) for (const [size, width, height] of [['mobile', 390, 844], ['desktop', 1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      const content = renderToStaticMarkup(h('html', { lang: 'en', 'data-theme': theme }, h('head', null,
        h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }), h('style', { dangerouslySetInnerHTML: { __html: styles } })),
      h('body', null, h('aside', null, h('div', { className: 'app-brand' }, h('strong', null, 'Neat')), h(nav.AppSidebarNavigation, permissions)),
        h('main', { id: 'main-content' }, h('header', { className: 'page-header page-heading' }, h('h1', null, 'My Schedule')),
          h('p', { className: 'muted' }, 'Interface fixture · no records are saved'),
          h(nearby.NearbyAccountsSection, { type: 'wholesale' }),
          h(route.RoutePlanner, { date: '2026-10-29', stops: [], omitted: 0 }), scheduleEvents,
          h('details', { className: 'card compact-details' }, h('summary', null, 'Account details and evidence'), h('p', null, 'Optional details remain available.')),
          h(AccountBriefingView, { briefing: brief }),
          h('div', { className: 'empty-state' }, h('div', null, h('h2', null, 'No matching work'), h('p', null, 'Try another account name.'))),
          h('label', null, 'Account search', h('input', { type: 'search', defaultValue: 'Long account name with several words and a city' })),
          h('p', { role: 'alert', className: 'notice danger' }, 'Unable to save. Your entries are preserved.'),
          h('button', { disabled: true }, 'Save visit'), h('p', { role: 'status' }, 'Select an account to save.'),
          h('p', { role: 'status', className: 'toast-notice' }, 'Visit saved. Follow-up added to Worklist.'),
          h('div', { role: 'status', 'aria-busy': true }, 'Loading account details…')),
        h(nav.MobileTabbar, permissions))));
      await page.setContent('<!doctype html>' + content);
      const dimensions = await page.locator('.schedule-route').evaluate(el => {
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { height: rect.height, background: css.backgroundColor, radius: css.borderRadius };
      });
      assert.ok(dimensions.height <= 85, `${size} route disclosure consumes ${dimensions.height}px`);
      assert.equal(dimensions.background, 'rgba(0, 0, 0, 0)', 'Navigation disclosure should not be a white box');
      assert.equal(dimensions.radius, '0px');
      assert.equal(await page.locator('.nearby-accounts').getAttribute('open'), null);
      await page.getByText('Nearby accounts', { exact: true }).click();
      await page.getByRole('link', { name: /Nearby fixture account/ }).waitFor();
      assert.equal(await page.locator('.nearby-account-row').count(), 2);
      assert.equal(await page.getByText('Never visited', { exact: false }).count(), 0);
      assert.ok(await page.getByText('Last visit', { exact: false }).count());
      await page.getByText('Plan my route', { exact: true }).click();
      await page.getByText('No account stops assigned to you on this date.', { exact: false }).waitFor();
      await page.getByText('Events and staff schedule', { exact: true }).click();
      await page.getByText('Add event or shift', { exact: true }).waitFor();
      await page.getByText('Relationship evidence', { exact: true }).click();
      await page.getByText('Missing data is not zero performance.', { exact: false }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size} ${theme} page overflow`);
      await page.screenshot({ path: `output/playwright/field-workspace-${size}-${theme}.png`, fullPage: true });
      if (size === 'mobile') {
        const small = await page.locator('main button, main summary').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map(el => el.textContent));
        assert.deepEqual(small, []);
        await page.locator('.mobile-more > summary').click();
        await page.locator('.mobile-more-menu a[href="/visits/new"]').waitFor({ state: 'visible' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `output/playwright/field-workspace-more-${theme}.png` });
      }
      checks.push({ viewport: `${width}x${height}`, theme, dimensions, overflow: false, disclosures: 'passed', states: ['empty', 'loading', 'error', 'disabled', 'success'] });
    }
    assert.deepEqual(errors, []);
    writeFileSync('output/playwright/field-workspace.json', JSON.stringify({ fixtureOnly: true, checks, errors }, null, 2));
    console.log('PASS: actual components, native disclosures, 390x844/1440x900, light/dark, no overflow, mobile touch targets and More entry. Server actions not exercised.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

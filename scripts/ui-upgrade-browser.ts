// Actual-component, credential-free UI acceptance. Synthetic records, no CRM writes.
// Run from the worktree with: npx tsx scripts/ui-upgrade-browser.ts [--round=final]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import ts from 'typescript';
import { FEATURE_KEYS } from '../lib/featureRegistry';
import { buildDailyFixtures } from './ui-upgrade-daily-fixtures';
import { buildFieldFixtures } from './ui-upgrade-field-fixtures';
import { buildForecastFixtures } from './ui-upgrade-forecast-fixtures';
import { runTimelineFilterAcceptance } from './ui-upgrade-interactions';

const baseline = 'ef41fe8fb5810dd52cadfecab09dd4d8d995a829';
const round = process.argv.includes('--round=final') ? 'final' : 'first';
const output = resolve(`output/playwright/ui-upgrade-20261104/${round}`);
const titles: Record<string, string> = { 'schedule-events': 'My Schedule', 'visit-history': 'Visits', tags: 'Tags', users: 'Users', 'log-visit': 'Log Visit', pipeline: 'Pipeline', 'account-profile': 'Account profile', 'account-plan': 'Account plan', 'account-worklist': 'Worklist', account: 'Account workspace', forecast: 'Production Forecasting', 'forecast-detail': 'Forecast detail', 'forecast-states': 'Data availability states' };
const paths: Record<string, string> = { 'schedule-events': '/', 'visit-history': '/visits', tags: '/tags', users: '/users', 'log-visit': '/visits/new', pipeline: '/pipeline', 'account-profile': '/wholesale/fixture', 'account-plan': '/wholesale/fixture', 'account-worklist': '/alerts', account: '/wholesale/fixture', forecast: '/analytics/production', 'forecast-detail': '/analytics/production/fixture', 'forecast-states': '/analytics/production' };
const cssPaths = ['app/styles.css', 'app/crm/crm.css', 'app/components/salesStatus.css', 'app/redesign.css', 'app/theme.css', 'app/field-workspace.css', 'app/workspace-foundation.css', 'app/field-data.css', 'app/daily-work.css', 'app/intelligence-browsing.css', 'app/analytics/analytics.css', 'app/analytics/production/forecast.css', 'app/analytics/production/operational-signals.css', 'app/admin/admin-workspace.css'];

function source(path: string, revision?: string) {
  return revision ? execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(path, 'utf8');
}
function moduleAt(path: string, mocks: Record<string, unknown>, revision?: string) {
  const filename = resolve(path), nativeRequire = createRequire(filename), exports: Record<string, any> = {};
  const code = ts.transpileModule(source(path, revision), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, process, URLSearchParams, Date, require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name) });
  return exports;
}
function shell(content: ReactNode, key: string, theme: string, css: string, revision?: string) {
  const link = { default: ({ children, scroll: _scroll, ...props }: any) => h('a', props, children) };
  const nav = moduleAt('app/components/AppNavigation.tsx', { 'next/navigation': { usePathname: () => paths[key] }, 'next/link': link }, revision);
  const permissions = { enabledFeatures: [...FEATURE_KEYS], isAdmin: true, isPlatformAdmin: false, isTaster: false };
  const rendered = renderToStaticMarkup(content);
  const heading = rendered.includes('<h1') ? '' : renderToStaticMarkup(h('header', { className: 'page-header page-heading' }, h('h1', null, titles[key])));
  const sidebar = renderToStaticMarkup(h('aside', null, h('div', { className: 'app-brand' }, h('strong', null, 'Neat'), h('span', null, 'Echo Spirits')), h(nav.AppSidebarNavigation, permissions), h('div', { className: 'user-card' }, h('strong', null, 'Sam Walker'), h('span', { className: 'pill' }, 'Admin'), h('a', { href: '/profile', className: 'user-card-profile' }, 'Profile & preferences'))));
  const tabbar = renderToStaticMarkup(h(nav.MobileTabbar, permissions));
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titles[key]} · Synthetic UI fixture</title><style>${css}</style></head><body class="has-environment-banner"><div class="environment-banner">Neat · synthetic UI fixture · no records are saved</div><a class="skip-link" href="#main-content">Skip to content</a>${sidebar}<main id="main-content"><header class="app-desktop-topbar"><span>Echo Spirits</span><span>UI review · 0.7.0-dev</span></header>${heading}${rendered}</main>${tabbar}</body></html>`;
}

async function main() {
  mkdirSync(output, { recursive: true });
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage();
  const errors: string[] = [], failures: string[] = [], checks: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const phase of (round === 'final' ? ['after'] : ['before', 'after']) as Array<'before' | 'after'>) {
      const revision = phase === 'before' ? baseline : undefined;
      const views = { ...await buildDailyFixtures(revision), ...await buildFieldFixtures(revision), ...buildForecastFixtures(revision) };
      const css = cssPaths.map(path => { try { return source(path, revision); } catch { return ''; } }).join('\n');
      const sizes: Array<[string, number, number]> = [['mobile', 390, 844], ['desktop', 1440, 900], ...(phase === 'after' ? [['inapp', 742, 668] as [string, number, number]] : [])];
      for (const theme of ['light', 'dark']) for (const [size, width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const [key, content] of Object.entries(views)) {
          // Baseline state fixtures use the same data; their source still represents the old layout.
          await page.setContent(shell(content, key, theme, css, revision), { waitUntil: 'load' });
          // tsx preserves local function names in evaluated callbacks. This
          // fixture-only helper is not part of the application's scripts.
          await page.evaluate('globalThis.__name = value => value');
          const metrics = await page.evaluate(() => {
            const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('details:not([open]) > :not(summary)'); };
            const rows = [...document.querySelectorAll('main tbody tr')].filter(visible);
            const inViewport = rows.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
            const controls = [...document.querySelectorAll('main button, main summary, main .btn, main a[href^="tel:"], main a[href^="mailto:"], main a[href^="sms:"]')].filter(visible);
            const text = document.querySelector('main')?.textContent ?? '';
            return {
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              bodyWidth: document.documentElement.scrollWidth,
              tableRows: rows.length, completeRowsInFirstViewport: inViewport.length,
              firstRowTop: rows[0]?.getBoundingClientRect().top ?? null,
              closedDisclosures: document.querySelectorAll('main details:not([open])').length,
              shortControls: controls.filter(el => el.getBoundingClientRect().height < 43.9).map(el => ({ text: el.textContent?.trim().slice(0, 60), height: el.getBoundingClientRect().height })),
              textLength: text.length, headings: [...document.querySelectorAll('main h1')].map(el => el.textContent),
            };
          });
          if (phase === 'after' && metrics.overflow) failures.push(`${key} ${size} ${theme}: page overflow (${metrics.bodyWidth}px)`);
          if (phase === 'after' && size === 'mobile' && metrics.shortControls.length) failures.push(`${key} ${theme}: undersized controls ${JSON.stringify(metrics.shortControls)}`);
          if (phase === 'after' && key === 'schedule-events') {
            if (!await page.getByText('Bartender training — Short North accounts', { exact: true }).isVisible()) failures.push(`schedule-events ${size} ${theme}: populated event hidden`);
          }
          if (phase === 'after' && key === 'forecast') {
            if (await page.locator('a[href^="/analytics/production/fixture-product-"]').count() !== 8) failures.push(`forecast ${size} ${theme}: duplicate or missing product destinations`);
            if (!await page.locator('.pf-demand-cell').first().isVisible()) failures.push(`forecast ${size} ${theme}: immediate demand hidden`);
          }
          if (phase === 'after' && key === 'pipeline') {
            const markers = await page.locator('.sales-journey-path, .sales-journey-other').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).listStyleType));
            if (markers.some(value => value !== 'none')) failures.push(`pipeline ${size} ${theme}: component stylesheet/list markers missing`);
          }
          const filename = `${key}-${phase}-${size}-${theme}`;
          await page.screenshot({ path: `${output}/${filename}.png`, fullPage: true });
          if (phase === 'after' && ['pipeline', 'forecast', 'account', 'log-visit'].includes(key)) await page.screenshot({ path: `${output}/${filename}-viewport.png` });
          checks.push({ key, phase, viewport: `${width}x${height}`, theme, ...metrics });
        }
      }
    }
    // Reflow and enlarged root text are separate checks, not a WCAG certification.
    const narrow = { ...await buildFieldFixtures(), ...buildForecastFixtures(), ...await buildDailyFixtures() };
    const css = cssPaths.filter(existsSync).map(path => readFileSync(path, 'utf8')).join('\n');
    for (const theme of ['light', 'dark']) for (const key of ['pipeline', 'forecast', 'log-visit', 'users']) {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.setContent(shell(narrow[key], key, theme, css));
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) failures.push(`${key} ${theme}: 320px reflow overflow`);
      await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) failures.push(`${key} ${theme}: enlarged root text at320px overflows`);
      await page.screenshot({ path: `${output}/${key}-320-enlarged${theme === 'dark' ? '-dark' : ''}.png`, fullPage: true });
    }
    const interactions = await runTimelineFilterAcceptance(page, css);
    writeFileSync(`${output}/results.json`, JSON.stringify({ fixtureOnly: true, baseline, round, checks, interactions, errors, failures }, null, 2));
    assert.deepEqual(errors, [], 'browser runtime errors');
    assert.deepEqual(failures, [], 'responsive and visibility acceptance');
    console.log(`PASS: ${checks.length} matched actual-component captures, 390x844/1440x900, light/dark, visible events/demand, one product DOM, touch targets, narrow reflow. Synthetic fixtures; no live writes.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

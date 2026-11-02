// Hydrated acceptance of the real inline editor, shared fields and ActionForm.
// Network/server actions are deterministic fixtures; this does not write live CRM data.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const output = resolve('output/playwright');

async function bundleFixture() {
  const result = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ResearchFailureList } from './app/admin/account-research/ResearchFailureList';
      const original = [{ id: 'failure-one', accountId: 'account-one', name: 'Ming Flower', identity: 'COLUMBUS · 06028778-1', reason: 'Exact-location validation failed: modelVerdict, city.', submittedLocation: '475 LAZELLE RD, COLUMBUS, 43081', failedAt: 'Oct 4, 2026, 8:29 AM EDT' }, { id: 'failure-two', accountId: 'account-two', name: 'MIN GA KOREAN RESTAURANT', identity: 'COLUMBUS · 6023595', reason: 'Exact-location validation failed: streetNumber.', submittedLocation: '798-800 BETHEL RD, COLUMBUS, 43214', failedAt: 'Oct 4, 2026, 8:29 AM EDT' }];
      const root = createRoot(document.getElementById('fixture-root'));
      const fixture = window.fixture = {
        loadMode: 'success', saveMode: 'error', loadCalls: 0, saveCalls: 0, refreshCalls: 0,
        pendingLoads: [], pendingSaves: [], posted: [], removeOnRefresh: false,
        account: { id: 'account-one', name: 'Ming Flower', licenseeIds: ['06028778-1', '06028778-2'], address: '475 LAZELLE RD', city: 'COLUMBUS', state: 'OH', zip: '43081', county: 'Franklin', phone: '614-555-0100', agencyId: '100', districtId: '12', ownership: 'Fixture owner', deliveryDay: 'Monday', addressImportProtected: false, cityImportProtected: false, zipImportProtected: false },
        render(failures = original) { root.render(<ResearchFailureList failures={failures} />); },
        refresh() { this.refreshCalls++; if (this.removeOnRefresh) this.render([]); },
        releaseLoad() { this.pendingLoads.shift()?.(); },
        releaseSave(result) { this.pendingSaves.shift()?.(result); },
      };
      fixture.render();
    ` },
    plugins: [{ name: 'fixture-adapters', setup(builder) {
      builder.onResolve({ filter: /^(next\/link|next\/navigation|react-dom)$|^\.\/edit-account-actions$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        const contents = args.path === 'next/link'
          ? `import React from ${JSON.stringify(require.resolve('react'))}; export default function Link({children,...props}) { return React.createElement('a', props, children); }`
          : args.path === 'next/navigation'
            ? `export const unstable_rethrow = () => {}; export const useRouter = () => ({ refresh: () => window.fixture.refresh() });`
            : args.path === 'react-dom'
              // React 18 outside Next does not expose the framework's form-status hook.
              // Actual ActionPendingContext still drives every pending/duplicate guard.
              ? `export * from ${JSON.stringify(require.resolve('react-dom'))}; export const useFormStatus = () => ({ pending: false });`
              : `export async function loadResearchAccountEditor(id) {
                  const f = window.fixture; f.loadCalls++;
                  const account = { ...f.account, id, name: id === 'account-two' ? 'MIN GA KOREAN RESTAURANT' : f.account.name };
                  if (f.loadMode === 'error') return { error: 'Could not load this account. Try again.' };
                  if (f.loadMode === 'pending') await new Promise(resolve => f.pendingLoads.push(resolve));
                  return { account };
                }
                export async function saveResearchAccount(data) {
                  const f = window.fixture; f.saveCalls++; f.posted.push(Object.fromEntries(data));
                  if (f.saveMode === 'pending') return new Promise(resolve => f.pendingSaves.push(resolve));
                  if (f.saveMode === 'success') f.account = { ...f.account, ...Object.fromEntries(data), licenseeIds: String(data.get('licenseeIds')).split('\\n') };
                  return f.saveMode === 'error' ? { error: 'Another restaurant account already uses one of those Licensee IDs.' } : { success: 'Restaurant account saved.' };
                }`;
        return { contents, loader: 'js', resolveDir: process.cwd() };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

async function checkLayout(page: Page, label: string) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: horizontal page overflow`);
  const smallTargets = await page.locator('main button, main summary, .research-failure-actions a').evaluateAll(elements => elements
    .filter(element => { const box = element.getBoundingClientRect(); return box.height > 0 && box.height < 44; })
    .map(element => ({ text: element.textContent, height: element.getBoundingClientRect().height })));
  assert.deepEqual(smallTargets, [], `${label}: touch targets below 44px`);
  const ids = await page.locator('[id]').evaluateAll(elements => elements.map(element => element.id));
  assert.equal(ids.length, new Set(ids).size, `${label}: duplicate field/help IDs`);
}

async function main() {
  mkdirSync(output, { recursive: true });
  console.log('Building the actual inline editor with fixture server boundaries.');
  const bundle = await bundleFixture();
  const styles = ['styles.css', 'crm/crm.css', 'redesign.css', 'theme.css', 'field-workspace.css', 'workspace-foundation.css'].map(path => readFileSync(`app/${path}`, 'utf8')).join('\n');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks: unknown[] = [];
  try {
    for (const theme of ['light', 'dark']) for (const [size, width, height] of [['mobile', 390, 844], ['desktop', 1440, 900]] as const) {
      console.log(`Checking ${size} ${theme} (${width}x${height}).`);
      const page = await browser.newPage({ viewport: { width, height } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<!doctype html><html lang="en" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><main><header class="page-header page-heading"><h1>Account Research</h1></header><p class="muted">Interactive acceptance fixture. No live accounts are changed.</p><details class="dashboard-section dashboard-details" id="research-failures" open><summary><span><strong>Failures to fix</strong><small>Accounts with a location match that may need correction</small></span><span class="pill">2</span></summary><div class="dashboard-details-content" id="fixture-root"></div></details></main></body></html>`);
      await page.addScriptTag({ content: bundle });
      const originalUrl = page.url();
      const row = page.locator('.research-failure-row').first();
      const edit = page.getByRole('button', { name: 'Edit Ming Flower', exact: true });
      await edit.waitFor();
      await checkLayout(page, `${size}/${theme}/closed`);

      // Cancel a delayed response, then open a fresh editor before the old response resolves.
      await page.evaluate(() => { (window as any).fixture.loadMode = 'pending'; });
      await edit.click();
      await row.getByRole('status').filter({ hasText: 'Loading account details' }).waitFor();
      assert.equal(await edit.getAttribute('aria-expanded'), 'true');
      await row.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await edit.evaluate(element => element === document.activeElement), true, 'Cancel returns focus to Edit');
      await page.evaluate(() => { const f = (window as any).fixture; f.loadMode = 'success'; f.account.name = 'Latest saved account name'; });
      await edit.click();
      const form = row.locator('form');
      await form.locator('input[name="name"]').waitFor();
      await page.evaluate(() => { (window as any).fixture.releaseLoad(); });
      assert.equal(await form.locator('input[name="name"]').inputValue(), 'Latest saved account name');
      assert.equal(await form.locator('input[name="name"]').evaluate(element => element === document.activeElement), true);
      await form.locator('input[name="name"]').fill('Unsaved draft');
      await form.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.evaluate(() => (window as any).fixture.saveCalls), 0);

      // Load errors remain in the originating row and offer a working retry.
      await page.evaluate(() => { (window as any).fixture.loadMode = 'error'; });
      await edit.click();
      await row.getByRole('alert').waitFor();
      await page.evaluate(() => { (window as any).fixture.loadMode = 'success'; });
      await row.getByRole('button', { name: 'Try again', exact: true }).click();
      await form.locator('input[name="name"]').waitFor();
      assert.equal(await form.locator('input[name="name"]').inputValue(), 'Latest saved account name');
      for (const [name, value] of Object.entries({ address: '475 LAZELLE RD', city: 'COLUMBUS', state: 'OH', zip: '43081' })) {
        assert.equal(await form.locator(`[name="${name}"]`).inputValue(), value);
      }
      await form.getByText('More account details', { exact: true }).click();
      for (const [name, value] of Object.entries({ licenseeIds: '06028778-1\n06028778-2', phone: '614-555-0100', agencyId: '100', county: 'Franklin', ownership: 'Fixture owner', districtId: '12', deliveryDay: 'Monday' })) {
        assert.equal(await form.locator(`[name="${name}"]`).inputValue(), value);
      }
      // Two open rows must not reuse label, help or state datalist IDs.
      await page.getByRole('button', { name: 'Edit MIN GA KOREAN RESTAURANT', exact: true }).click();
      const second = page.locator('.research-failure-row').nth(1);
      await second.locator('form input[name="name"]').waitFor();
      await checkLayout(page, `${size}/${theme}/two-editors`);
      await second.getByRole('button', { name: 'Cancel', exact: true }).click();
      await form.locator('input[name="city"]').fill('Westerville');
      await checkLayout(page, `${size}/${theme}/expanded`);
      await page.screenshot({ path: resolve(output, `account-research-inline-${size}-${theme}.png`), fullPage: true });

      // Pending saves prevent cancellation and duplicate requests, including a direct submit event.
      await page.evaluate(() => { (window as any).fixture.saveMode = 'pending'; });
      await form.getByRole('button', { name: 'Save changes', exact: true }).click();
      await form.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
      assert.equal(await form.getAttribute('aria-busy'), 'true');
      assert.equal(await form.getByRole('button', { name: 'Saving…', exact: true }).isDisabled(), true);
      assert.equal(await form.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
      assert.equal(await form.locator('input[name="city"]').isDisabled(), true, 'Inputs cannot change while the save is pending');
      await form.evaluate(element => (element as HTMLFormElement).requestSubmit());
      assert.equal(await page.evaluate(() => (window as any).fixture.saveCalls), 1);
      await page.evaluate(() => { (window as any).fixture.releaseSave({ error: 'Another restaurant account already uses one of those Licensee IDs.' }); });
      await form.getByRole('alert').waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
      assert.equal(await form.locator('input[name="city"]').inputValue(), 'Westerville');
      assert.equal(await form.getByRole('button', { name: 'Save changes', exact: true }).isEnabled(), true);

      await page.evaluate(() => { (window as any).fixture.saveMode = 'success'; });
      await form.getByRole('button', { name: 'Save changes', exact: true }).click();
      const notice = page.getByRole('status').filter({ hasText: 'Ming Flower saved.' });
      await notice.waitFor();
      assert.equal(await notice.evaluate(element => element === document.activeElement), true);
      // Saving the same row again must announce and focus success even when its text is unchanged.
      await edit.click();
      await form.locator('input[name="city"]').waitFor();
      assert.equal(await form.locator('input[name="city"]').inputValue(), 'Westerville');
      assert.equal(await form.locator('input[name="name"]').evaluate(element => element === document.activeElement), true);
      await page.evaluate(() => { (window as any).fixture.removeOnRefresh = true; });
      await form.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.getByRole('heading', { name: 'No account failures need attention' }).waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'status');
      assert.equal(await notice.evaluate(element => element === document.activeElement), true);
      assert.equal(page.url(), originalUrl, 'Inline editing must not navigate');
      assert.equal(await page.locator('#research-failures').evaluate(element => (element as HTMLDetailsElement).open), true);
      const result = await page.evaluate(() => { const f = (window as any).fixture; return { saveCalls: f.saveCalls, refreshCalls: f.refreshCalls, posted: f.posted }; });
      assert.equal(result.saveCalls, 3);
      assert.equal(result.refreshCalls, 2);
      assert.equal(result.posted[2].city, 'Westerville');
      assert.equal(result.posted[2].agencyId, '100');
      assert.equal(result.posted[2].licenseeIds, '06028778-1\n06028778-2');
      await checkLayout(page, `${size}/${theme}/success-empty`);
      assert.deepEqual(errors, []);
      checks.push({ viewport: `${width}x${height}`, theme, loadCalls: await page.evaluate(() => (window as any).fixture.loadCalls), ...result, errors, overflow: false, minimumControlHeight: 44, states: ['closed', 'loading', 'load-error', 'prefilled', 'cancelled', 'pending', 'save-error', 'saved', 'empty'], navigation: 'unchanged' });
      console.log(`Passed ${size} ${theme}.`);
      await page.close();
    }
    writeFileSync(resolve(output, 'account-research-inline.json'), JSON.stringify({ fixtureOnly: true, actualComponents: ['ResearchFailureList', 'WholesaleAccountEditFields', 'ActionForm', 'SubmitButton', 'StateField'], mockedBoundaries: ['server actions', 'Next router refresh', 'framework form-status hook'], checks }, null, 2));
    console.log('PASS: hydrated inline editing, prefill, retry, cancellation/focus, pending/duplicate prevention, save feedback/refresh, mobile/desktop light/dark, no overflow and 44px controls. Server actions are fixtures; no live CRM writes.');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { chromium } from 'playwright';

type Fixture = { rehearsal: boolean; synthetic: boolean; host: string; orderId: string; receiptOrderId?: string; sessions: Array<{ role: string; token: string }> };
const fixture = JSON.parse(readFileSync('output/production-supplies-qa.json', 'utf8')) as Fixture;
if (!fixture.rehearsal || !fixture.synthetic || !fixture.orderId || !fixture.sessions.some(session => session.role === 'ADMIN')) throw new Error('An explicit synthetic Production Supplies rehearsal fixture is required.');
const base = 'http://localhost:3117';
const folder = 'output/playwright/production-supplies';
mkdirSync(folder, { recursive: true }); mkdirSync('.impeccable/review', { recursive: true });

async function main() {
  const health = await fetch(`${base}/api/health`).then(response => response.json()) as { ok: boolean; environment: string; databaseTarget: string };
  assert.equal(health.ok, true, 'Rehearsal database must be connected');
  assert.equal(health.databaseTarget, 'supplies-rehearsal', 'Browser writes require the named isolated rehearsal target');
  assert.notEqual(health.environment, 'production');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks: string[] = [], errors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const anonymous = await browser.newPage(); await anonymous.goto(`${base}/production-supplies`); await anonymous.waitForURL(/\/login/); checks.push('Unauthenticated dashboard redirects to sign in'); await anonymous.close();
    await context.addCookies([{ name: 'echo_session', value: fixture.sessions.find(session => session.role === 'ADMIN')!.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000); page.on('pageerror', error => errors.push(error.message));
    if (process.argv.includes('--receipt-state-only')) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/production-supplies/${fixture.receiptOrderId || fixture.orderId}`);
      const receiptForm = page.locator('#receipt form');
      const quantity = receiptForm.locator('input[name="line.quantity"]').first();
      await quantity.fill('1');
      const originalKey = await receiptForm.locator('input[name="idempotencyKey"]').inputValue();
      const owner = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Assign owner$/ }) }).first();
      await owner.locator(':scope > summary').click();
      await owner.getByRole('button', { name: 'Save owner', exact: true }).click();
      await page.locator('.action-notice').filter({ hasText: 'Owner saved.' }).waitFor();
      assert.equal(await quantity.inputValue(), '1', 'Unrelated owner save must preserve the receipt draft');
      assert.equal(await receiptForm.locator('input[name="idempotencyKey"]').inputValue(), originalKey, 'Draft submission identity must survive unrelated revalidation');
      await receiptForm.getByRole('button', { name: 'Record received quantities', exact: true }).click();
      await page.locator('#receipt').getByRole('button', { name: 'Record another receipt', exact: true }).waitFor();
      assert.equal(await page.locator('#receipt form').count(), 0, 'Successful submission must replace the draft');
      await page.locator('#receipt').getByRole('button', { name: 'Record another receipt', exact: true }).click();
      assert.equal(await page.locator('#receipt input[name="line.quantity"]').first().inputValue(), '');
      assert.notEqual(await page.locator('#receipt input[name="idempotencyKey"]').inputValue(), originalKey);
      assert.deepEqual(errors, []);
      writeFileSync(`${folder}/receipt-state-acceptance.json`, JSON.stringify({ synthetic: true, passed: 4, checks: ['Owner save preserves receipt draft', 'Owner save preserves idempotency key', 'Receipt success replaces draft', 'Next receipt starts blank with a new key'], browserErrors: errors }, null, 2));
      console.log(JSON.stringify({ passed: 4, browserErrors: 0, evidence: `${folder}/receipt-state-acceptance.json` }));
      return;
    }
    const noOverflow = async (label: string) => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: horizontal overflow`); checks.push(label); };
    const capture = async (name: string) => { await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.screenshot({ path: `${folder}/${name}`, fullPage: true }); };
    await page.goto(`${base}/production-supplies`); await page.getByRole('heading', { name: 'Production Supplies', exact: true }).waitFor();
    assert.ok(await page.locator('.supply-record-link').count(), 'Synthetic incoming order is visible'); await noOverflow('Desktop incoming dashboard renders working rows'); await capture('incoming-desktop.png'); copyFileSync(`${folder}/incoming-desktop.png`, '.impeccable/review/desktop.png');
    await page.goto(`${base}/production-supplies?view=review`); await page.getByRole('heading', { name: 'Production Supplies', exact: true }).waitFor(); await noOverflow('Review view loads classifications and extraction exceptions'); await capture('review-desktop.png');
    await page.goto(`${base}/production-supplies/${fixture.orderId}?returnTo=${encodeURIComponent('/production-supplies?view=review')}`); await page.getByRole('heading', { name: 'Order lines', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Back to supplies', exact: true }).getAttribute('href'), '/production-supplies?view=review');
    checks.push('Order detail preserves filtered return context'); await noOverflow('Desktop detail shows individual lines and shipments'); await capture('detail-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${base}/production-supplies`); await page.getByRole('heading', { name: 'Production Supplies', exact: true }).waitFor(); await noOverflow('390px incoming view retains ETA, source, owner and action'); await capture('incoming-mobile.png'); copyFileSync(`${folder}/incoming-mobile.png`, '.impeccable/review/mobile.png');
    await page.goto(`${base}/production-supplies/${fixture.orderId}`); await page.getByRole('heading', { name: 'Order lines', exact: true }).waitFor(); await noOverflow('390px order detail and receipt form reflow'); await capture('detail-mobile.png');
    const detail = page.locator('.supply-line').first(); await detail.getByText('Correct line or link need', { exact: true }).click();
    assert.ok(await detail.getByLabel('Remember for future purchases', { exact: false }).count()); await noOverflow('Classification editor distinguishes this purchase from reusable rule');
    await page.goto(`${base}/production-supplies/${fixture.receiptOrderId || fixture.orderId}`); const receiptForm = page.locator('#receipt form'); const line = receiptForm.locator('fieldset').filter({ has: page.locator('input[name="line.unit"]') }).first();
    await line.locator('input[name="line.quantity"]').fill('9999999999'); await receiptForm.getByRole('button', { name: 'Record received quantities', exact: true }).click(); await receiptForm.getByRole('alert').waitFor();
    assert.equal(await line.locator('input[name="line.quantity"]').inputValue(), '9999999999'); checks.push('Invalid receipt reports error and preserves entered quantities'); await capture('receipt-error-mobile.png');
    await line.locator('input[name="line.quantity"]').fill('1'); await receiptForm.getByRole('button', { name: 'Record received quantities', exact: true }).click(); await page.locator('#receipt').getByText(/Receipt recorded\. Related needs remain open/).waitFor(); checks.push('Partial receipt persists through the authenticated server action');
    await page.goto(`${base}/production-supplies?view=ordering&entry=need#new-need`); const newNeed = page.locator('#new-need'); await newNeed.getByLabel('Material or supply', { exact: true }).fill('Synthetic browser supply need'); await newNeed.getByLabel('Needed at', { exact: true }).fill('Synthetic QA location'); await newNeed.getByLabel('Quantity needed', { exact: true }).fill('2'); await newNeed.getByLabel('Unit', { exact: true }).fill('lb'); await newNeed.getByRole('button', { name: 'Save supply need', exact: true }).click(); await newNeed.getByText('Supply need saved.', { exact: false }).waitFor(); checks.push('Mobile manual supply need persists');
    await page.goto(`${base}/production-supplies?entry=order#new-order`); const newOrder = page.locator('#new-order'); await newOrder.getByLabel('Supplier', { exact: true }).fill('Synthetic browser supplier'); await newOrder.getByLabel('Destination', { exact: true }).fill('Synthetic QA location'); const firstLine = newOrder.locator('fieldset').first(); await firstLine.getByLabel('Item description', { exact: true }).fill('Synthetic browser production material'); await firstLine.getByLabel('Ordered quantity', { exact: true }).fill('3'); await firstLine.getByLabel('Unit', { exact: true }).fill('lb'); await firstLine.locator('select[name="line.department"]').selectOption('PRODUCTION'); await newOrder.getByRole('button', { name: 'Save order', exact: true }).click(); await newOrder.getByText('Order saved.', { exact: false }).waitFor(); checks.push('Mobile manual order persists with item department');
    await page.goto(`${base}/production-supplies?q=NoSuchSyntheticMaterial`); await page.getByRole('heading', { name: 'No incoming supplies in this view', exact: true }).waitFor(); await noOverflow('Filtered empty state retains search and clear path'); await capture('empty-mobile.png');
    await page.goto(`${base}/production-supplies/settings`); await page.getByRole('heading', { name: 'Production Supplies settings', exact: true }).waitFor(); await noOverflow('Mobile settings distinguish membership, feature access and mailbox permission'); await capture('settings-mobile.png');
    await page.goto(`${base}/production-supplies`); await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await noOverflow('Dark theme uses shared semantic tokens'); await capture('incoming-dark-mobile.png');
    const viewerSession = fixture.sessions.find(session => session.role === 'VIEWER');
    if (viewerSession) { const viewer = await browser.newContext({ viewport: { width: 390, height: 844 } }); await viewer.addCookies([{ name: 'echo_session', value: viewerSession.token, url: base, httpOnly: true, sameSite: 'Lax' }]); const viewerPage = await viewer.newPage(); await viewerPage.goto(`${base}/production-supplies/${fixture.orderId}`); await viewerPage.getByRole('heading', { name: 'Order lines', exact: true }).waitFor(); assert.equal(await viewerPage.locator('#receipt form').count(), 0); assert.equal(await viewerPage.getByRole('button', { name: 'Apply to this purchase', exact: true }).count(), 0); checks.push('Viewer can read operational details and has no management controls'); await viewer.close(); }
    assert.deepEqual(errors, []); writeFileSync(`${folder}/acceptance.json`, JSON.stringify({ synthetic: true, liveTracking: false, liveMailboxes: false, checks, passed: checks.length, browserErrors: errors }, null, 2)); console.log(JSON.stringify({ passed: checks.length, browserErrors: errors.length, evidence: `${folder}/acceptance.json` }));
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

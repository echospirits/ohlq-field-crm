import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

type Fixture = { synthetic: boolean; rehearsal: boolean; sessions: Array<{ role: string; token: string }> };
const fixture = JSON.parse(readFileSync('output/production-supplies-status-qa.json', 'utf8')) as Fixture;
if (!fixture.synthetic || !fixture.rehearsal || !fixture.sessions.some(session => session.role === 'ADMIN')) throw Error('Explicit synthetic status-dashboard rehearsal fixtures are required.');
const base = 'http://localhost:3117';
const folder = 'output/playwright/production-supplies-status';
mkdirSync(folder, { recursive: true });
const resumeConfirmation = process.argv.includes('--resume-confirmation');
function luminance(color: string) {
  const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

async function main() {
  const health = await fetch(`${base}/api/health`).then(response => response.json()) as { ok: boolean; environment: string; databaseTarget: string };
  assert.equal(health.ok, true); assert.equal(health.databaseTarget, 'supplies-rehearsal'); assert.notEqual(health.environment, 'production');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const checks: string[] = [], errors: string[] = [];
  try {
    const anonymous = await browser.newPage(); await anonymous.goto(`${base}/production-supplies`); await anonymous.waitForURL(/\/login/); await anonymous.close(); checks.push('Anonymous dashboard remains protected');
    await context.addCookies([{ name: 'echo_session', value: fixture.sessions.find(session => session.role === 'ADMIN')!.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(error.message));
    const cards = page.locator('.supply-status-card');
    const noOverflow = async (name: string) => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name); checks.push(name); };
    await page.goto(`${base}/production-supplies`); await page.getByRole('heading', { name: 'Supplies', exact: true }).waitFor();
    const initial = await cards.count(); assert.ok(initial >= 2 && initial <= 10, 'Representative synthetic status cards are required');
    assert.equal(await page.locator('.supply-tabs, .supply-toolbar, .supply-disclosure').count(), 0);
    assert.equal(await page.locator('.supply-status-page input:not([type="hidden"]), .supply-status-page select, .supply-status-page textarea').count(), 0);
    checks.push('Dashboard contains status cards and only dismiss controls, without tabs or editors');
    await noOverflow('Desktop status cards have no page overflow'); if (!resumeConfirmation) await page.screenshot({ path: `${folder}/desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('Phone status cards have no page overflow');
    const cardBounds = await cards.first().boundingBox(); assert.ok(cardBounds && cardBounds.width <= 390);
    if (!resumeConfirmation) await page.screenshot({ path: `${folder}/mobile.png`, fullPage: true });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    // Existing shared button colors transition; inspect the settled theme.
    await page.waitForTimeout(350);
    if (!resumeConfirmation) await page.screenshot({ path: `${folder}/mobile-dark.png`, fullPage: true, animations: 'disabled' });
    const colors = await cards.first().getByRole('button', { name: /^Dismiss / }).evaluate(button => ({ foreground: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor }));
    const foreground = luminance(colors.foreground), background = luminance(colors.background);
    const contrast = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    assert.ok(contrast >= 4.5, `Dark dismiss contrast ${contrast}; ${JSON.stringify(colors)}`); checks.push('Dark dismiss text passes measured 4.5:1 contrast');
    if (process.argv.includes('--capture-only')) {
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ synthetic: true, capturesOnly: true, darkDismissContrast: contrast, evidence: folder }));
      return;
    }
    await page.evaluate(() => delete document.documentElement.dataset.theme);
    const actionRoute = `${base}/production-supplies`;
    await page.route(actionRoute, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) await route.fulfill({ status: 503, body: 'Synthetic unavailable response' });
      else await route.continue();
    });
    await cards.first().getByRole('button', { name: /^Dismiss / }).click();
    await cards.first().getByRole('alert').waitFor(); assert.equal(await cards.count(), initial); checks.push('Dismiss failure retains the card and shows an inline recovery error');
    await page.screenshot({ path: `${folder}/dismiss-error.png`, fullPage: true }); await page.unroute(actionRoute);
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(actionRoute, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) { await held; await route.continue(); }
      else await route.continue();
    });
    const firstButton = cards.first().getByRole('button', { name: /^Dismiss / });
    await firstButton.click(); await page.getByText('Dismissing…', { exact: true }).waitFor(); assert.equal(await firstButton.isDisabled(), true); checks.push('Dismiss pending state disables duplicate submissions');
    release(); await page.waitForFunction(count => document.querySelectorAll('.supply-status-card').length === count, initial - 1);
    await page.unroute(actionRoute); await page.reload(); await page.getByRole('heading', { name: 'Supplies', exact: true }).waitFor();
    assert.equal(await cards.count(), initial - 1); checks.push('Successful dismissal persists after reload');
    for (const path of ['/production-supplies/catalog', '/production-supplies/retired-order', '/production-supplies?view=history&entry=order']) {
      try { await page.goto(`${base}${path}`, { waitUntil: 'commit' }); }
      catch (error) { if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED')) throw error; }
      await page.waitForURL(url => url.pathname === '/production-supplies', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Supplies', exact: true }).waitFor(); assert.equal(await page.locator('.supply-tabs, .supply-edit-form').count(), 0);
    }
    checks.push('Old catalog, order and history entry points do not expose editing workflows');
    const viewerSession = fixture.sessions.find(session => session.role === 'VIEWER');
    if (viewerSession) {
      const viewer = await browser.newContext({ viewport: { width: 390, height: 844 } }); await viewer.addCookies([{ name: 'echo_session', value: viewerSession.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
      const viewerPage = await viewer.newPage(); await viewerPage.goto(`${base}/production-supplies`); await viewerPage.getByRole('heading', { name: 'Supplies', exact: true }).waitFor();
      assert.ok(await viewerPage.locator('.supply-status-card').count()); assert.equal(await viewerPage.getByRole('button', { name: /^Dismiss / }).count(), 0); checks.push('View-only access does not grant shared dismissal'); await viewer.close();
    }
    while (await cards.count()) {
      const count = await cards.count(); await cards.first().getByRole('button', { name: /^Dismiss / }).click(); await page.waitForFunction(previous => document.querySelectorAll('.supply-status-card').length < previous, count);
    }
    await page.getByRole('heading', { name: 'Nothing being tracked', exact: true }).waitFor(); await noOverflow('Empty dashboard has no page overflow');
    await page.screenshot({ path: `${folder}/empty-mobile.png`, fullPage: true }); checks.push('All dismissed or delivered cycles produce the simple empty state');
    assert.deepEqual(errors, []);
    writeFileSync(`${folder}/acceptance.json`, JSON.stringify({ synthetic: true, liveTracking: false, checks, passed: checks.length, browserErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, browserErrors: errors.length, evidence: `${folder}/acceptance.json` }));
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Status browser acceptance failed.'); process.exitCode = 1; });

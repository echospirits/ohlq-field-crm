import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { waitForPartnerDcTable } from '../lib/ohlqPartnerDcReady';
import { OHLQ_BAILMENT_INVOICE_REPORT, reportDateInput, validateOhlqPartnerDcExport } from '../lib/ohlqAnnualSalesReport';

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CI === 'true' ? {} : { channel: 'chrome' }) });
});
after(async () => { await browser?.close(); });

const rows = (count: number) => Array.from({ length: count }, (_, index) => `<tr><td>ITEM${index}</td><td>Fixture product</td></tr>`).join('');
const fixture = (summary: string, count = 0) => `<div id="tblPartnerDC_wrapper">
  <table id="tblPartnerDC"><thead><tr><th>Code</th><th>Product</th></tr></thead>
  <tbody>${count ? rows(count) : '<tr><td colspan="2">Loading</td></tr>'}</tbody></table>
  <div id="table-status">${summary}</div></div>`;
const withPage = async (run: (page: Page) => Promise<void>) => {
  const page = await browser.newPage();
  try { await run(page); } finally { await page.close(); }
};

test('Partner DC waits past the visible zero-row shell for all 33 source rows to load', async () => {
  await withPage(async page => {
    await page.setContent(fixture('Showing 0 to 0 of 0 entries'));
    let completed = false;
    const waiting = waitForPartnerDcTable(page, 5000).then(summary => { completed = true; return summary; });
    await page.waitForTimeout(100);
    assert.equal(completed, false, 'the initial zero total must not become the expected export count');
    await page.evaluate(html => {
      setTimeout(() => {
        document.querySelector('#tblPartnerDC tbody')!.innerHTML = html;
        document.querySelector('#table-status')!.textContent = 'Showing 1 to 25 of 33 entries';
      }, 50);
    }, rows(25));
    const summary = await waiting;
    assert.equal(summary, 'Showing 1 to 25 of 33 entries');
    assert.doesNotMatch(summary, /Fixture product|ITEM/);
    const csv = 'Code,Product\n' + Array.from({ length: 33 }, (_, index) => `ITEM${index},Fixture product`).join('\n');
    validateOhlqPartnerDcExport(csv, summary);
    assert.throws(() => validateOhlqPartnerDcExport(csv.split('\n').slice(0, 26).join('\n'), summary), /row count/);
  });
});

test('Partner DC waits for the visible row range even when the summary updates first', async () => {
  await withPage(async page => {
    await page.setContent(fixture('Showing 1 to 25 of 33 entries'));
    let completed = false;
    const waiting = waitForPartnerDcTable(page, 5000).then(summary => { completed = true; return summary; });
    await page.waitForTimeout(100);
    assert.equal(completed, false);
    await page.locator('#tblPartnerDC tbody').evaluate((body, html) => { body.innerHTML = html; }, rows(25));
    assert.equal(await waiting, 'Showing 1 to 25 of 33 entries');
  });
});

test('filtered and genuinely empty DC tables never pass completeness readiness', async () => {
  await withPage(async page => {
    await page.setContent(fixture('Showing 1 to 1 of 1 entries (filtered from 33 total entries)', 1));
    await assert.rejects(waitForPartnerDcTable(page, 250), /Timeout/);
    await page.setContent(fixture('Showing 0 to 0 of 0 entries'));
    await assert.rejects(waitForPartnerDcTable(page, 250), /Timeout/);
  });
});

test('Bailment uses its From and To labels and supports associated labels as well as ARIA', async () => {
  await withPage(async page => {
    await page.setContent('<label for="from">From</label><input id="from"><input aria-label="To"><input aria-label="From date"><input aria-label="To date">');
    const labels = OHLQ_BAILMENT_INVOICE_REPORT.dateLabels;
    await reportDateInput(page.mainFrame(), labels.from).fill('01/01/2019');
    await reportDateInput(page.mainFrame(), labels.to).fill('10/28/2026');
    assert.equal(await page.locator('#from').inputValue(), '01/01/2019');
    assert.equal(await page.getByLabel('To', { exact: true }).inputValue(), '10/28/2026');
    assert.equal(await page.getByLabel('From date', { exact: true }).inputValue(), '');
    await reportDateInput(page.mainFrame(), 'From date').fill('10/27/2026');
    assert.equal(await page.getByLabel('From date', { exact: true }).inputValue(), '10/27/2026');
  });
});

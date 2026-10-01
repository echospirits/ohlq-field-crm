import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright-core';
import {
  isOhlqLoginSuccessUrl,
  OHLQ_ANNUAL_SALES_BY_WHOLESALE_REPORT as report,
  openOhlqPowerBiReportWithSessionRetry,
  waitForOhlqPartnerLogin,
} from '../lib/ohlqAnnualSalesReport';

const reportUrl = `https://app.powerbigov.us/groups/me/apps/example/rdlreports/${report.reportId}?ctid=example`;
const pending = () => new Promise<never>(() => {});

function loginPage(destination: string, invalid = false) {
  const url = new URL(destination);
  const waits: Array<{ waitUntil?: string }> = [];
  const page = {
    url: () => destination,
    waitForURL: (matcher: RegExp | ((url: URL) => boolean), options: { waitUntil?: string }) => {
      waits.push(options);
      const matches = typeof matcher === 'function' ? matcher(url) : matcher.test(destination);
      return matches ? Promise.resolve() : pending();
    },
    getByText: () => ({ first: () => ({ waitFor: () => invalid ? Promise.resolve() : pending() }) }),
    locator: () => ({ innerText: async () => invalid ? 'Incorrect username or password' : '' }),
  } as unknown as Page;
  return { page, waits };
}

test('report re-login accepts the resumed wholesale report instead of waiting for the partner homepage', async () => {
  const { page, waits } = loginPage(reportUrl);
  await waitForOhlqPartnerLogin(page, report);
  assert.equal(waits[0].waitUntil, 'domcontentloaded');
});

test('report re-login hands Microsoft authentication back to the report handler', async () => {
  await waitForOhlqPartnerLogin(loginPage('https://login.microsoftonline.com/common/oauth2/authorize').page, report);
});

test('normal partner login still succeeds without report context', async () => {
  await waitForOhlqPartnerLogin(loginPage('https://ops.ohlq.com/partner').page);
});

test('report handoffs require the expected report and trusted HTTPS host, and do not apply to master login', () => {
  assert.equal(isOhlqLoginSuccessUrl(new URL(reportUrl)), false);
  assert.equal(isOhlqLoginSuccessUrl(new URL('https://login.microsoftonline.com/common')), false);
  for (const destination of [
    reportUrl.replace(report.reportId, 'another-report'),
    reportUrl.replace('app.powerbigov.us', 'untrusted.example'),
    reportUrl.replace('https:', 'http:'),
    'https://ops.ohlq.com/login',
  ]) assert.equal(isOhlqLoginSuccessUrl(new URL(destination), report), false, destination);
});

async function exerciseReportRecovery(loginDestinations: string[]) {
  let destination = 'https://ops.ohlq.com/login';
  let navigations = 0;
  const page = {
    url: () => destination,
    goto: async () => { navigations++; destination = 'https://ops.ohlq.com/login'; },
    locator: (selector: string) => selector === 'body' ? { innerText: async () => '' } : {
      first: () => ({
        waitFor: async () => {},
        fill: async () => {},
        click: async () => { destination = loginDestinations.shift()!; },
      }),
    },
    getByText: () => ({ first: () => ({ waitFor: pending }) }),
    waitForURL: (matcher: RegExp | ((url: URL) => boolean)) => {
      const matches = typeof matcher === 'function' ? matcher(new URL(destination)) : matcher.test(destination);
      return matches ? Promise.resolve() : pending();
    },
  } as unknown as Page;
  const runtime = { debugDir: 'unused', logger: { log() {}, error() {} } } as Parameters<typeof openOhlqPowerBiReportWithSessionRetry>[2];
  await openOhlqPowerBiReportWithSessionRetry(page, report, runtime, reportUrl, { username: 'test', password: 'test' });
  return { destination, navigations };
}

test('a successful re-login resumes the report without opening it again', async () => {
  const result = await exerciseReportRecovery([reportUrl]);
  assert.equal(result.destination, reportUrl);
  assert.equal(result.navigations, 2, 'only the report redirect and re-login navigation are needed');
});

test('partner-page re-login retries the report and accepts a direct handoff on the final attempt', async () => {
  const result = await exerciseReportRecovery(['https://ops.ohlq.com/partner', reportUrl]);
  assert.equal(result.destination, reportUrl);
  assert.equal(result.navigations, 4);
});

test('report re-login still fails on rejected credentials', async () => {
  await assert.rejects(waitForOhlqPartnerLogin(loginPage('https://ops.ohlq.com/login', true).page, report), /rejected the configured login credentials/);
});

test('report re-login still fails on password reset and redacts the reset token', async () => {
  await assert.rejects(
    waitForOhlqPartnerLogin(loginPage('https://ops.ohlq.com/passwordReset/user/private-token').page, report),
    (error: Error) => /redirected to password reset/.test(error.message) && !error.message.includes('private-token'),
  );
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium as playwrightChromium, type FrameLocator, type LaunchOptions, type Page } from 'playwright-core';

const APP_ROOT = process.cwd();
const POWER_BI_APP_ID = '1b854c43-d373-43ea-9f76-edefa2dd227f';
const POWER_BI_TENANT_ID = '50f8fcc4-94d8-4f07-84eb-36ed57c7c8a2';

type Logger = Pick<Console, 'error' | 'log'>;

type OhlqPowerBiReportConfig = {
  fileSlug: string;
  reportId: string;
  renderedTitle: string | RegExp;
};

const buildPowerBiReportUrl = (reportId: string) =>
  `https://app.powerbigov.us/groups/me/apps/${POWER_BI_APP_ID}/rdlreports/${reportId}?ctid=${POWER_BI_TENANT_ID}`;

export const OHLQ_ANNUAL_SALES_SUMMARY_REPORT = {
  fileSlug: 'annual-sales-summary',
  reportId: '9781fc23-73de-4ee8-b0b8-77ae6f9b7c4e',
  renderedTitle: 'Annual Sales Summary',
} satisfies OhlqPowerBiReportConfig;

export const OHLQ_ANNUAL_SALES_BY_WHOLESALE_REPORT = {
  fileSlug: 'annual-sales-summary-by-wholesale',
  reportId: 'dea7572c-2ea4-45bb-bbbc-29600bd326cc',
  renderedTitle: /Annual Sales Summary By Wholesale Account/i,
} satisfies OhlqPowerBiReportConfig;

export type ReportDate = {
  day: number;
  display: string;
  iso: string;
  monthName: string;
  year: number;
};

export type OhlqAnnualSalesDownloadResult = {
  csvBuffer?: Buffer;
  filename: string;
  outputPath: string;
  reportDate: string;
  runDate: string;
  sizeBytes: number;
};

export type OhlqAnnualSalesDownloadOptions = {
  browserChannel?: string;
  debugDir?: string;
  downloadDir?: string;
  headless?: boolean;
  logger?: Logger;
  reportDate?: string;
  returnBuffer?: boolean;
  useServerlessChromium?: boolean;
};

export function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(value);
}

function formatDateParts(year: number, month: number, day: number): ReportDate {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const normalizedYear = date.getUTCFullYear();
  const normalizedMonth = date.getUTCMonth() + 1;
  const normalizedDay = date.getUTCDate();
  const mm = String(normalizedMonth).padStart(2, '0');
  const dd = String(normalizedDay).padStart(2, '0');

  return {
    day: normalizedDay,
    display: `${mm}/${dd}/${normalizedYear}`,
    iso: `${normalizedYear}-${mm}-${dd}`,
    monthName: date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
    year: normalizedYear,
  };
}

function todayInEastern() {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/New_York',
    year: 'numeric',
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Unable to resolve Eastern date part: ${type}`);
    return Number(part);
  };

  return {
    day: value('day'),
    month: value('month'),
    year: value('year'),
  };
}

function defaultReportDate() {
  const today = todayInEastern();
  return formatDateParts(today.year, today.month, today.day - 1);
}

function todayIsoEastern() {
  const today = todayInEastern();
  return formatDateParts(today.year, today.month, today.day).iso;
}

function parseReportDate(rawDate: string | undefined) {
  if (!rawDate) return defaultReportDate();

  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return formatDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const displayMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (displayMatch) {
    return formatDateParts(Number(displayMatch[3]), Number(displayMatch[1]), Number(displayMatch[2]));
  }

  throw new Error('OHLQ_REPORT_DATE must be YYYY-MM-DD or MM/DD/YYYY when provided.');
}

function getReportDate() {
  return parseReportDate(process.env.OHLQ_REPORT_DATE?.trim());
}

export function getOhlqAnnualSalesReportDate(rawDate?: string) {
  return parseReportDate(rawDate?.trim() || process.env.OHLQ_REPORT_DATE?.trim());
}

export function getAnnualSalesReportFilename(runDateIso: string) {
  return getOhlqReportFilename(OHLQ_ANNUAL_SALES_SUMMARY_REPORT, runDateIso);
}

function getOhlqReportFilename(report: OhlqPowerBiReportConfig, runDateIso: string) {
  return `ohlq-${report.fileSlug}-${runDateIso}.csv`;
}

async function saveDebugScreenshot(page: Page, label: string, debugDir: string) {
  fs.mkdirSync(debugDir, { recursive: true });
  const screenshotPath = path.join(debugDir, `${label}-${Date.now()}.png`);
  await page.screenshot({ fullPage: true, path: screenshotPath }).catch(() => undefined);
  return screenshotPath;
}

async function clickIfVisible(page: Page, selectorName: string | RegExp) {
  const button = page.getByRole('button', { name: selectorName }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return true;
  }
  return false;
}

async function waitForMicrosoftStep(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(750);
}

async function getMicrosoftPageSummary(page: Page) {
  const text = await page
    .locator('body')
    .innerText({ timeout: 2_000 })
    .catch(() => '');

  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function throwMicrosoftInterrupt(page: Page, debugDir: string, message: string) {
  const screenshotPath = await saveDebugScreenshot(page, 'microsoft-sign-in-interrupted', debugDir);
  const pageSummary = await getMicrosoftPageSummary(page);
  throw new Error(`${message} Last Microsoft page: ${pageSummary || page.url()}. Debug screenshot: ${screenshotPath}`);
}

async function handleMicrosoftSignIn(page: Page, debugDir: string) {
  if (!page.url().includes('login.microsoftonline.com')) return;

  const username = process.env.OHLQ_MICROSOFT_USERNAME?.trim();
  const password = process.env.OHLQ_MICROSOFT_PASSWORD?.trim();
  if (!username) {
    const screenshotPath = await saveDebugScreenshot(page, 'microsoft-sign-in-required', debugDir);
    throw new Error(
      [
        'Clean browser reached Microsoft/OHID sign-in before Power BI loaded.',
        'Set OHLQ_MICROSOFT_USERNAME and, if allowed by the account policy, OHLQ_MICROSOFT_PASSWORD to keep testing.',
        'If this account requires MFA, device trust, or interactive SSO, cloud mode needs an automation-friendly service account or an API/export route.',
        `Debug screenshot: ${screenshotPath}`,
      ].join(' '),
    );
  }

  const deadline = Date.now() + 90_000;

  while (page.url().includes('login.microsoftonline.com') && Date.now() < deadline) {
    if (await page.getByText('There was an issue looking up your account').isVisible().catch(() => false)) {
      const screenshotPath = await saveDebugScreenshot(page, 'microsoft-account-lookup-error', debugDir);
      throw new Error(`Microsoft could not look up OHLQ_MICROSOFT_USERNAME. Debug screenshot: ${screenshotPath}`);
    }

    const hasMfaPrompt = await page
      .getByText(/approve sign in request|authenticator|verification code|enter code|more information required|help us protect your account/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (hasMfaPrompt) {
      await throwMicrosoftInterrupt(
        page,
        debugDir,
        'Microsoft sign-in requires additional verification before Power BI can load.',
      );
    }

    const accountChoice = page.getByText(username, { exact: false }).first();
    if (await accountChoice.isVisible().catch(() => false)) {
      await accountChoice.click();
      await waitForMicrosoftStep(page);
      continue;
    }

    if (await clickIfVisible(page, /use another account/i)) {
      await waitForMicrosoftStep(page);
      continue;
    }

    const usernameInput = page
      .locator('input[type="email"], input[name="loginfmt"], input[aria-label*="Email"], input[placeholder*="email" i]')
      .first();
    if (await usernameInput.isVisible().catch(() => false)) {
      await usernameInput.fill(username);
      await clickIfVisible(page, /next/i);
      await waitForMicrosoftStep(page);
      continue;
    }

    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible().catch(() => false)) {
      if (!password) {
        const screenshotPath = await saveDebugScreenshot(page, 'microsoft-password-required', debugDir);
        throw new Error(
          `Microsoft password prompt appeared, but OHLQ_MICROSOFT_PASSWORD is not set. Debug screenshot: ${screenshotPath}`,
        );
      }

      await passwordInput.fill(password);
      if (!(await clickIfVisible(page, /sign in/i))) {
        await clickIfVisible(page, /next/i);
      }
      await waitForMicrosoftStep(page);
      continue;
    }

    if (await clickIfVisible(page, /^yes$/i)) {
      await waitForMicrosoftStep(page);
      continue;
    }

    await page.waitForTimeout(1_000);
  }

  if (page.url().includes('login.microsoftonline.com')) {
    await throwMicrosoftInterrupt(page, debugDir, 'Microsoft sign-in did not complete before the automation timeout.');
  }
}

async function setDate(frame: FrameLocator, label: 'From date' | 'To date', reportDate: ReportDate) {
  const input = frame.locator(`input[aria-label="${label}"]`);
  await input.waitFor({ state: 'visible', timeout: 120_000 });
  await input.click();
  await input.fill(reportDate.display).catch(() => undefined);
  await input.press('Tab').catch(() => undefined);

  if ((await input.inputValue().catch(() => '')) === reportDate.display) return;

  await frame.locator(`input[aria-label="${label}"] + span[role="button"]`).click();
  await frame
    .getByRole('button', {
      name: `${reportDate.day}, ${reportDate.monthName}, ${reportDate.year}`,
    })
    .click();
  await input.waitFor({ state: 'visible', timeout: 30_000 });
}

async function selectAllVendors(frame: FrameLocator) {
  await frame.locator('span[aria-label="Open Vendor"]').click();
  const selectAll = frame.getByRole('menuitemcheckbox', { name: 'Select All' });
  await selectAll.waitFor({ state: 'visible', timeout: 30_000 });

  if ((await selectAll.getAttribute('aria-checked')) !== 'true') {
    await selectAll.click();
  }

  await frame.locator('body').press('Escape').catch(() => undefined);
}

async function viewReportIfReady(frame: FrameLocator) {
  const viewReportButton = frame.getByRole('button', { name: 'View report' });
  if (await viewReportButton.isEnabled().catch(() => false)) {
    await viewReportButton.click();
  }
}

async function getLaunchOptions(options: OhlqAnnualSalesDownloadOptions): Promise<LaunchOptions> {
  const useServerlessChromium =
    options.useServerlessChromium ?? envFlag('OHLQ_USE_SERVERLESS_CHROMIUM', process.env.VERCEL === '1');

  if (useServerlessChromium) {
    const { default: chromium } = await import('@sparticuz/chromium');

    return {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    };
  }

  const browserChannel =
    options.browserChannel ?? process.env.OHLQ_BROWSER_CHANNEL?.trim() ?? (process.env.CI ? undefined : 'chrome');

  return {
    channel: browserChannel,
    headless: options.headless ?? envFlag('OHLQ_HEADLESS', process.env.CI === 'true'),
  };
}

type OhlqDownloadRuntime = {
  debugDir: string;
  downloadDir: string;
  logger: Logger;
  reportDate: ReportDate;
  returnBuffer: boolean;
  runDateIso: string;
};

function createDownloadRuntime(options: OhlqAnnualSalesDownloadOptions): OhlqDownloadRuntime {
  const logger = options.logger ?? console;
  const reportDate = options.reportDate ? getOhlqAnnualSalesReportDate(options.reportDate) : getReportDate();
  const runDateIso = todayIsoEastern();
  const downloadDir = path.resolve(
    options.downloadDir ??
      (options.returnBuffer ? path.join(os.tmpdir(), 'ohlq-downloads') : path.join(APP_ROOT, 'output', 'ohlq-downloads')),
  );
  const debugDir = path.resolve(
    options.debugDir ?? (process.env.VERCEL ? path.join(os.tmpdir(), 'ohlq-playwright') : path.join(APP_ROOT, 'output', 'playwright')),
  );
  fs.mkdirSync(downloadDir, { recursive: true });

  return {
    debugDir,
    downloadDir,
    logger,
    reportDate,
    returnBuffer: options.returnBuffer ?? false,
    runDateIso,
  };
}

async function openBrowserPage(options: OhlqAnnualSalesDownloadOptions) {
  const launchOptions = await getLaunchOptions(options);
  const browser = await playwrightChromium.launch(launchOptions);
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { height: 900, width: 1536 },
  });
  const page = await context.newPage();

  return { browser, context, page };
}

async function signInToOhlqPartner(page: Page) {
  const ohlqUsername = requireEnv('OHLQ_OPS_USERNAME');
  const ohlqPassword = requireEnv('OHLQ_OPS_PASSWORD');

  await page.goto('https://ops.ohlq.com/login', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/partner')) {
    await page.getByPlaceholder('username or email').fill(ohlqUsername);
    await page.getByPlaceholder('please enter your password').fill(ohlqPassword);
    await Promise.all([
      page.waitForURL(/https:\/\/ops\.ohlq\.com\/partner/, { timeout: 60_000 }),
      page.getByRole('button', { name: 'Log In' }).click(),
    ]);
  }
}

async function downloadOhlqPowerBiReportFromPage(
  page: Page,
  report: OhlqPowerBiReportConfig,
  runtime: OhlqDownloadRuntime,
) {
  const { debugDir, downloadDir, logger, reportDate, returnBuffer, runDateIso } = runtime;
  const filename = getOhlqReportFilename(report, runDateIso);
  const powerBiReportUrl = buildPowerBiReportUrl(report.reportId);
  const ohlqReportRedirectUrl = `https://ops.ohlq.com/link/external/${encodeURIComponent(powerBiReportUrl)}`;

  logger.log(`Using report date ${reportDate.display} (${reportDate.iso}).`);

  await page.goto(ohlqReportRedirectUrl, { waitUntil: 'domcontentloaded' });
  await handleMicrosoftSignIn(page, debugDir);
  await page.waitForURL((url) => url.href.includes(`/rdlreports/${report.reportId}`), {
    timeout: 120_000,
  });

  const frame = page.frameLocator('iframe');
  await setDate(frame, 'From date', reportDate);
  await setDate(frame, 'To date', reportDate);

  await selectAllVendors(frame);

  await viewReportIfReady(frame);
  await frame.getByText(report.renderedTitle, { exact: typeof report.renderedTitle === 'string' }).waitFor({
    timeout: 240_000,
  });
  await frame
    .getByText(`From: ${reportDate.display.replace(/^0/, '').replace('/0', '/')}`)
    .waitFor({
      timeout: 30_000,
    })
    .catch(() => undefined);

  await frame.getByRole('menuitem', { name: /Export/ }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
  await frame.getByRole('menuitem', { name: /Comma Separated Values \(\.csv\)/ }).click();
  const download = await downloadPromise;

  const outputPath = path.join(downloadDir, filename);
  await download.saveAs(outputPath);

  const sizeBytes = fs.statSync(outputPath).size;
  const csvBuffer = returnBuffer ? fs.readFileSync(outputPath) : undefined;

  logger.log(`Downloaded CSV: ${outputPath}`);

  return {
    csvBuffer,
    filename,
    outputPath,
    reportDate: reportDate.iso,
    runDate: runDateIso,
    sizeBytes,
  } satisfies OhlqAnnualSalesDownloadResult;
}

async function downloadOhlqPowerBiReports(
  reports: OhlqPowerBiReportConfig[],
  options: OhlqAnnualSalesDownloadOptions = {},
) {
  const runtime = createDownloadRuntime(options);
  const { browser, context, page } = await openBrowserPage(options);
  let activeReport: OhlqPowerBiReportConfig | undefined;

  try {
    await signInToOhlqPartner(page);

    const results: OhlqAnnualSalesDownloadResult[] = [];
    for (const report of reports) {
      activeReport = report;
      results.push(await downloadOhlqPowerBiReportFromPage(page, report, runtime));
      activeReport = undefined;
    }

    return results;
  } catch (error) {
    const screenshotLabel = activeReport ? `ohlq-${activeReport.fileSlug}-error` : 'ohlq-report-batch-error';
    const screenshotPath = await saveDebugScreenshot(page, screenshotLabel, runtime.debugDir);
    runtime.logger.error(`Debug screenshot: ${screenshotPath}`);
    throw error;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function downloadOhlqPowerBiReport(
  report: OhlqPowerBiReportConfig,
  options: OhlqAnnualSalesDownloadOptions = {},
) {
  const [result] = await downloadOhlqPowerBiReports([report], options);
  return result;
}

export async function downloadOhlqAnnualSalesSummary(options: OhlqAnnualSalesDownloadOptions = {}) {
  return downloadOhlqPowerBiReport(OHLQ_ANNUAL_SALES_SUMMARY_REPORT, options);
}

export async function downloadOhlqAnnualSalesSummaryByWholesale(options: OhlqAnnualSalesDownloadOptions = {}) {
  return downloadOhlqPowerBiReport(OHLQ_ANNUAL_SALES_BY_WHOLESALE_REPORT, options);
}

export async function downloadOhlqAnnualSalesReports(options: OhlqAnnualSalesDownloadOptions = {}) {
  const [annualSalesSummary, annualSalesSummaryByWholesale] = await downloadOhlqPowerBiReports(
    [OHLQ_ANNUAL_SALES_SUMMARY_REPORT, OHLQ_ANNUAL_SALES_BY_WHOLESALE_REPORT],
    options,
  );

  if (!annualSalesSummary || !annualSalesSummaryByWholesale) {
    throw new Error('Unable to download both OHLQ annual sales reports.');
  }

  return { annualSalesSummary, annualSalesSummaryByWholesale };
}

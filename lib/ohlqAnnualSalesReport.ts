import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  chromium as playwrightChromium,
  type Frame,
  type LaunchOptions,
  type Locator,
  type Page,
} from 'playwright-core';

const APP_ROOT = process.cwd();
const POWER_BI_APP_ID = '1b854c43-d373-43ea-9f76-edefa2dd227f';
const POWER_BI_TENANT_ID = '50f8fcc4-94d8-4f07-84eb-36ed57c7c8a2';

type Logger = Pick<Console, 'error' | 'log'>;

const MICROSOFT_SIGN_IN_TIMEOUT_MS = 150_000;
const POWER_BI_REPORT_FRAME_TIMEOUT_MS = 180_000;
const POWER_BI_REPORT_FRAME_RELOAD_AFTER_MS = 75_000;
const MICROSOFT_INPUT_ACTION_TIMEOUT_MS = 5_000;
const BROWSER_COMPATIBILITY_LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];
const MICROSOFT_LOGOUT_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/logout';
const MICROSOFT_AUTH_RESET_DOMAINS = [
  /(?:^|\.)live\.com$/i,
  /(?:^|\.)microsoft\.com$/i,
  /(?:^|\.)microsoftonline\.com$/i,
  /(?:^|\.)microsoftonline\.us$/i,
  /(?:^|\.)msauth\.net$/i,
  /(?:^|\.)powerbigov\.us$/i,
  /(?:^|\.)windows\.net$/i,
];
const MICROSOFT_PASSWORD_PROMPT_TEXT = /enter password|forgot my password/i;
const MICROSOFT_USERNAME_INPUT_SELECTORS = [
  'input[type="email"]',
  'input[type="text"]',
  'input[name="loginfmt"]',
  'input#i0116',
  'input[autocomplete="username"]',
  'input[placeholder*="Email"]',
  'input[placeholder*="phone"]',
  'input[aria-label*="email" i]',
  'input[placeholder*="email" i]',
];
const MICROSOFT_PASSWORD_INPUT_SELECTORS = [
  'input[type="password"]',
  'input[name="passwd"]',
  'input#i0118',
  'input[autocomplete="current-password"]',
  'input[aria-label*="password" i]',
  'input[placeholder*="password" i]',
];
const MICROSOFT_PASSWORD_DOM_SELECTORS = ['input[type="password"]', 'input[name="passwd"]', 'input#i0118'];
const MICROSOFT_FORWARD_ACTION_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'input#idSIButton9',
  'input[value="Next"]',
  'input[value="Sign in"]',
];

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

function uniqueLaunchArgs(args: string[] = []) {
  return Array.from(new Set([...args, ...BROWSER_COMPATIBILITY_LAUNCH_ARGS]));
}

function getBrowserUserAgent(browserVersion: string) {
  const override = process.env.OHLQ_BROWSER_USER_AGENT?.trim();
  if (override) return override;

  const chromeVersion = browserVersion.match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? '148.0.0.0';
  return [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    `Chrome/${chromeVersion}`,
    'Safari/537.36',
  ].join(' ');
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
    return button.click({ timeout: MICROSOFT_INPUT_ACTION_TIMEOUT_MS }).then(() => true, () => false);
  }
  return false;
}

async function firstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = await candidates.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 5); index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }

  return null;
}

async function clickVisibleLocator(locator: Locator | null) {
  if (!locator) return false;
  if (!(await locator.isVisible().catch(() => false))) return false;

  return locator.click({ timeout: MICROSOFT_INPUT_ACTION_TIMEOUT_MS }).then(() => true, () => false);
}

async function clickMicrosoftForwardAction(page: Page) {
  if (await clickIfVisible(page, /^(sign in|next)$/i)) return true;

  const submitControl = await firstVisibleLocator(page, MICROSOFT_FORWARD_ACTION_SELECTORS);
  if (await clickVisibleLocator(submitControl)) return true;

  return false;
}

async function clickMicrosoftTextAction(page: Page, selectorName: string | RegExp) {
  if (await clickIfVisible(page, selectorName)) return true;

  const candidates = [
    page.getByRole('link', { name: selectorName }).first(),
    page.locator('button, a, [role="button"], [role="link"], [tabindex]').filter({ hasText: selectorName }).first(),
  ];

  for (const action of candidates) {
    if (await action.isVisible().catch(() => false)) {
      const clicked = await action.click({ force: true, timeout: MICROSOFT_INPUT_ACTION_TIMEOUT_MS }).then(() => true, () => false);
      if (clicked) return true;
    }
  }

  return page
    .evaluate((rawPattern) => {
      const pattern = new RegExp(rawPattern, 'i');
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="link"], [tabindex]'),
      );
      const action = candidates.find((element) => pattern.test(element.innerText || element.textContent || ''));
      action?.click();
      return Boolean(action);
    }, typeof selectorName === 'string' ? selectorName : selectorName.source)
    .catch(() => false);
}

async function waitForMicrosoftPasswordField(page: Page) {
  await page
    .locator(MICROSOFT_PASSWORD_INPUT_SELECTORS.join(', '))
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => undefined);
}

async function waitForMicrosoftStep(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(750);
}

async function isMicrosoftUsernameInputVisible(page: Page) {
  return Boolean(await firstVisibleLocator(page, MICROSOFT_USERNAME_INPUT_SELECTORS));
}

async function fillLocatorIfUsable(locator: Locator | null, value: string) {
  if (!locator) return false;
  if (!(await locator.isVisible().catch(() => false))) return false;

  return locator
    .fill(value, { timeout: MICROSOFT_INPUT_ACTION_TIMEOUT_MS })
    .then(() => true, () => false);
}

async function fillMicrosoftUsername(page: Page, username: string) {
  const usernameInput = await firstVisibleLocator(page, MICROSOFT_USERNAME_INPUT_SELECTORS);
  if (await fillLocatorIfUsable(usernameInput, username)) return true;

  return page
    .evaluate(
      ({ selectors, username: usernameValue }) => {
        const isVisible = (input: HTMLInputElement) => {
          const rect = input.getBoundingClientRect();
          const style = window.getComputedStyle(input);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        };

        for (const selector of selectors) {
          const input = document.querySelector<HTMLInputElement>(selector);
          if (!input || input.disabled || input.readOnly || !isVisible(input)) continue;

          input.focus();
          input.value = usernameValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        return false;
      },
      { selectors: MICROSOFT_USERNAME_INPUT_SELECTORS, username },
    )
    .catch(() => false);
}

async function fillMicrosoftPassword(page: Page, password: string, options: { allowDomFallback?: boolean } = {}) {
  const passwordInput = await firstVisibleLocator(page, MICROSOFT_PASSWORD_INPUT_SELECTORS);
  if (await fillLocatorIfUsable(passwordInput, password)) return true;

  if (!options.allowDomFallback) return false;

  return page
    .evaluate(
      ({ password: passwordValue, selectors }) => {
        for (const selector of selectors) {
          const input = document.querySelector<HTMLInputElement>(selector);
          if (!input || input.disabled || input.readOnly) continue;

          input.focus();
          input.value = passwordValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        return false;
      },
      { password, selectors: MICROSOFT_PASSWORD_DOM_SELECTORS },
    )
    .catch(() => false);
}

async function getMicrosoftPageSummary(page: Page) {
  const text = await page
    .locator('body')
    .innerText({ timeout: 2_000 })
    .catch(() => '');

  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function getFrameDebugSummary(page: Page) {
  const summaries: string[] = [];

  for (const [index, frame] of page.frames().entries()) {
    const text = await frame
      .locator('body')
      .innerText({ timeout: 750 })
      .catch(() => '');
    const summary = text.replace(/\s+/g, ' ').trim().slice(0, 220);
    summaries.push(`#${index} ${frame.url().slice(0, 180)}${summary ? ` :: ${summary}` : ''}`);
  }

  return summaries.join(' | ').slice(0, 1_200);
}

async function throwMicrosoftInterrupt(page: Page, debugDir: string, message: string) {
  const screenshotPath = await saveDebugScreenshot(page, 'microsoft-sign-in-interrupted', debugDir);
  const pageSummary = await getMicrosoftPageSummary(page);
  throw new Error(`${message} Last Microsoft page: ${pageSummary || page.url()}. Debug screenshot: ${screenshotPath}`);
}

async function resetMicrosoftAuthState(page: Page, restartUrl: string) {
  await page
    .evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    })
    .catch(() => undefined);

  for (const domain of MICROSOFT_AUTH_RESET_DOMAINS) {
    await page.context().clearCookies({ domain }).catch(() => undefined);
  }

  await page.goto(MICROSOFT_LOGOUT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
  await page
    .evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    })
    .catch(() => undefined);

  for (const domain of MICROSOFT_AUTH_RESET_DOMAINS) {
    await page.context().clearCookies({ domain }).catch(() => undefined);
  }

  await page.goto(restartUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
  await waitForMicrosoftStep(page);
}

async function handleMicrosoftSignIn(page: Page, debugDir: string, restartUrl?: string) {
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

  const deadline = Date.now() + MICROSOFT_SIGN_IN_TIMEOUT_MS;
  let passwordSubmitAttempts = 0;
  let accountPickerAttempts = 0;
  let accountPickerErrorCycles = 0;
  let authResetAttempts = 0;

  while (page.url().includes('login.microsoftonline.com') && Date.now() < deadline) {
    const pageSummary = await getMicrosoftPageSummary(page);

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

    const isPasswordPrompt = MICROSOFT_PASSWORD_PROMPT_TEXT.test(pageSummary);
    const hasAccountPickerError = /we couldn't sign you in|please try again/i.test(pageSummary);
    const usernameWasFilled = isPasswordPrompt ? false : await fillMicrosoftUsername(page, username);
    if (usernameWasFilled) {
      passwordSubmitAttempts = 0;
      accountPickerAttempts = 0;
      if (!(await clickMicrosoftForwardAction(page))) await page.keyboard.press('Enter').catch(() => undefined);
      await waitForMicrosoftStep(page);
      continue;
    }

    const passwordWasFilled = password ? await fillMicrosoftPassword(page, password, { allowDomFallback: isPasswordPrompt }) : false;
    if (passwordWasFilled) {
      passwordSubmitAttempts += 1;
      if (passwordSubmitAttempts > 3) {
        await throwMicrosoftInterrupt(
          page,
          debugDir,
          'Microsoft password prompt remained after multiple submit attempts. Check OHLQ_MICROSOFT_PASSWORD and account policy.',
        );
      }

      if (!(await clickMicrosoftForwardAction(page))) await page.keyboard.press('Enter').catch(() => undefined);
      await waitForMicrosoftStep(page);
      await page
        .waitForURL((url) => !url.href.includes('login.microsoftonline.com'), { timeout: 8_000 })
        .catch(() => undefined);
      continue;
    }

    if (isPasswordPrompt) {
      if (!password) {
        const screenshotPath = await saveDebugScreenshot(page, 'microsoft-password-required', debugDir);
        throw new Error(
          `Microsoft password prompt appeared, but OHLQ_MICROSOFT_PASSWORD is not set. Debug screenshot: ${screenshotPath}`,
        );
      }

      await waitForMicrosoftPasswordField(page);
      continue;
    }

    if (hasAccountPickerError || /pick an account/i.test(pageSummary)) {
      passwordSubmitAttempts = 0;
      accountPickerAttempts += 1;
      if (hasAccountPickerError) accountPickerErrorCycles += 1;

      if (restartUrl && hasAccountPickerError && accountPickerErrorCycles >= 2 && authResetAttempts < 2) {
        console.log('Resetting Microsoft auth state after repeated account-picker sign-in failures.');
        authResetAttempts += 1;
        accountPickerAttempts = 0;
        accountPickerErrorCycles = 0;
        passwordSubmitAttempts = 0;
        await resetMicrosoftAuthState(page, restartUrl);
        continue;
      }

      if (hasAccountPickerError && accountPickerAttempts === 1) {
        await clickMicrosoftTextAction(page, /^try again$/i);
        await waitForMicrosoftStep(page);
        continue;
      }

      const usedAnotherAccount = await clickMicrosoftTextAction(page, /use another account/i);
      await waitForMicrosoftStep(page);

      if (usedAnotherAccount && (await isMicrosoftUsernameInputVisible(page))) {
        continue;
      }

      if (restartUrl && accountPickerAttempts >= 2 && authResetAttempts < 2) {
        console.log('Resetting Microsoft auth state after repeated account-picker recovery attempts.');
        authResetAttempts += 1;
        accountPickerAttempts = 0;
        accountPickerErrorCycles = 0;
        passwordSubmitAttempts = 0;
        await resetMicrosoftAuthState(page, restartUrl);
      }

      continue;
    }

    if (await clickIfVisible(page, /^yes$/i)) {
      await waitForMicrosoftStep(page);
      continue;
    }

    const accountChoice = page.getByText(username, { exact: false }).first();
    if (await accountChoice.isVisible().catch(() => false)) {
      if (!(await accountChoice.click({ timeout: MICROSOFT_INPUT_ACTION_TIMEOUT_MS }).then(() => true, () => false))) {
        await waitForMicrosoftStep(page);
        continue;
      }
      await waitForMicrosoftStep(page);
      continue;
    }

    if (await clickMicrosoftTextAction(page, /use another account/i)) {
      await waitForMicrosoftStep(page);
      continue;
    }

    await page.waitForTimeout(1_000);
  }

  if (page.url().includes('login.microsoftonline.com')) {
    await throwMicrosoftInterrupt(page, debugDir, 'Microsoft sign-in did not complete before the automation timeout.');
  }
}

function reportDateInput(frame: Frame, label: 'From date' | 'To date') {
  return frame.locator(`input[aria-label="${label}" i]`).first();
}

async function waitForPowerBiReportFrame(
  page: Page,
  report: OhlqPowerBiReportConfig,
  debugDir: string,
  restartUrl: string,
) {
  const startedAt = Date.now();
  let didReload = false;

  while (Date.now() - startedAt < POWER_BI_REPORT_FRAME_TIMEOUT_MS) {
    if (page.url().includes('login.microsoftonline.com')) {
      await handleMicrosoftSignIn(page, debugDir, restartUrl);
      await page
        .waitForURL((url) => url.href.includes(`/rdlreports/${report.reportId}`), { timeout: 60_000 })
        .catch(() => undefined);
      continue;
    }

    for (const frame of page.frames()) {
      const fromDateInput = reportDateInput(frame, 'From date');
      if (await fromDateInput.isVisible({ timeout: 750 }).catch(() => false)) {
        return frame;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (!didReload && elapsedMs >= POWER_BI_REPORT_FRAME_RELOAD_AFTER_MS) {
      didReload = true;
      await saveDebugScreenshot(page, `power-bi-${report.fileSlug}-frame-wait-reload`, debugDir).catch(() => undefined);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
      await handleMicrosoftSignIn(page, debugDir, restartUrl);
      await page
        .waitForURL((url) => url.href.includes(`/rdlreports/${report.reportId}`), { timeout: 60_000 })
        .catch(() => undefined);
    }

    await page.waitForTimeout(1_000);
  }

  const screenshotPath = await saveDebugScreenshot(page, `power-bi-${report.fileSlug}-parameters-timeout`, debugDir);
  const pageSummary = await getMicrosoftPageSummary(page);
  const frameSummary = await getFrameDebugSummary(page);
  throw new Error(
    [
      `Power BI report parameters did not load for ${report.fileSlug}.`,
      `Expected the From date input in one of ${page.frames().length} frame(s).`,
      `Page: ${pageSummary || page.url()}.`,
      frameSummary ? `Frames: ${frameSummary}.` : '',
      `Debug screenshot: ${screenshotPath}`,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

async function setDate(frame: Frame, label: 'From date' | 'To date', reportDate: ReportDate) {
  const input = reportDateInput(frame, label);
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.click();
  await input.fill(reportDate.display).catch(() => undefined);
  await input.press('Tab').catch(() => undefined);

  if ((await input.inputValue().catch(() => '')) === reportDate.display) return;

  await frame.locator(`input[aria-label="${label}" i] + span[role="button"]`).click();
  await frame
    .getByRole('button', {
      name: `${reportDate.day}, ${reportDate.monthName}, ${reportDate.year}`,
    })
    .click();
  await input.waitFor({ state: 'visible', timeout: 30_000 });
}

async function selectAllVendors(frame: Frame) {
  await frame.locator('span[aria-label="Open Vendor"]').click();
  const selectAll = frame.getByRole('menuitemcheckbox', { name: 'Select All' });
  await selectAll.waitFor({ state: 'visible', timeout: 30_000 });

  if ((await selectAll.getAttribute('aria-checked')) !== 'true') {
    await selectAll.click();
  }

  await frame.locator('body').press('Escape').catch(() => undefined);
}

async function viewReportIfReady(frame: Frame) {
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
      args: uniqueLaunchArgs(chromium.args),
      executablePath: await chromium.executablePath(),
      headless: true,
    };
  }

  const browserChannel =
    options.browserChannel ?? process.env.OHLQ_BROWSER_CHANNEL?.trim() ?? (process.env.CI ? undefined : 'chrome');

  return {
    args: uniqueLaunchArgs(),
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
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent: getBrowserUserAgent(browser.version()),
    viewport: { height: 900, width: 1536 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
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
  await handleMicrosoftSignIn(page, debugDir, ohlqReportRedirectUrl);
  await page.waitForURL((url) => url.href.includes(`/rdlreports/${report.reportId}`), {
    timeout: 120_000,
  });

  const frame = await waitForPowerBiReportFrame(page, report, debugDir, ohlqReportRedirectUrl);
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

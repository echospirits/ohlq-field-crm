import type { Page } from 'playwright-core';

/** DataTables displays a visible zero-row wrapper before its AJAX data arrives.
 * Wait for the unfiltered count and its displayed rows before exporting. */
export async function waitForPartnerDcTable(page: Page, timeoutMs = 60_000): Promise<string> {
  const ready = await page.waitForFunction(() => {
    const wrapper = document.querySelector<HTMLElement>('#tblPartnerDC_wrapper');
    const table = wrapper?.querySelector<HTMLTableElement>('#tblPartnerDC');
    if (!wrapper || !table?.tBodies[0]) return false;
    const text = wrapper.innerText.replace(/\s+/g, ' ');
    const match = /Showing ([\d,]+) to ([\d,]+) of ([\d,]+) entries/i.exec(text);
    if (!match || /filtered from/i.test(text)) return false;
    const [start, end, total] = match.slice(1).map(value => Number(value.replaceAll(',', '')));
    if (![start, end, total].every(Number.isSafeInteger) || start < 1 || end < start || total < end) return false;
    // The empty/loading placeholder has one spanning cell. An actual row has
    // the report's separate columns; only this page's range must be present.
    const dataRows = Array.from(table.tBodies[0].rows).filter(row => row.cells.length > 1);
    if (dataRows.length !== end - start + 1) return false;
    // Return count metadata only, never source table contents.
    return match[0];
  }, undefined, { timeout: timeoutMs });
  try {
    return await ready.jsonValue() as string;
  } finally {
    await ready.dispose();
  }
}

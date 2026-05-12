export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import os from 'os';
import path from 'path';
import { NextResponse } from 'next/server';
import { importOhlqAnnualSalesCsv } from '../../../../lib/ohlqAnnualSalesImport';
import { downloadOhlqAnnualSalesSummary } from '../../../../lib/ohlqAnnualSalesReport';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const startedAt = Date.now();

  try {
    const result = await downloadOhlqAnnualSalesSummary({
      debugDir: path.join(os.tmpdir(), 'ohlq-playwright'),
      downloadDir: path.join(os.tmpdir(), 'ohlq-downloads'),
      headless: true,
      returnBuffer: true,
      useServerlessChromium: process.env.VERCEL === '1',
    });

    if (!result.csvBuffer) {
      throw new Error('CSV download completed, but no CSV buffer was returned for import.');
    }

    const importResult = await importOhlqAnnualSalesCsv({
      csv: result.csvBuffer,
      reportDate: result.reportDate,
    });

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      filename: result.filename,
      importedRows: importResult.importedRows,
      parsedRows: importResult.parsedRows,
      reportDate: result.reportDate,
      replacedRows: importResult.deletedRows,
      runDate: result.runDate,
      skippedRows: importResult.skippedRows,
      sizeBytes: result.sizeBytes,
    });
  } catch (error) {
    console.error('OHLQ annual sales cron failed:', error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown OHLQ annual sales cron failure.',
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import os from 'os';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  importOhlqAnnualSalesByWholesaleCsv,
  importOhlqAnnualSalesCsv,
} from '../../../../lib/ohlqAnnualSalesImport';
import { downloadOhlqAnnualSalesReports } from '../../../../lib/ohlqAnnualSalesReport';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const startedAt = Date.now();

  try {
    const { annualSalesSummary: annualSalesDownload, annualSalesSummaryByWholesale: wholesaleDownload } =
      await downloadOhlqAnnualSalesReports({
      debugDir: path.join(os.tmpdir(), 'ohlq-playwright'),
      downloadDir: path.join(os.tmpdir(), 'ohlq-downloads'),
      headless: true,
      returnBuffer: true,
      useServerlessChromium: process.env.VERCEL === '1',
    });

    if (!annualSalesDownload.csvBuffer) {
      throw new Error('Annual Sales Summary CSV download completed, but no CSV buffer was returned for import.');
    }

    const annualSalesImport = await importOhlqAnnualSalesCsv({
      csv: annualSalesDownload.csvBuffer,
      reportDate: annualSalesDownload.reportDate,
    });

    if (!wholesaleDownload.csvBuffer) {
      throw new Error(
        'Annual Sales Summary by Wholesale CSV download completed, but no CSV buffer was returned for import.',
      );
    }

    const wholesaleImport = await importOhlqAnnualSalesByWholesaleCsv({
      csv: wholesaleDownload.csvBuffer,
      reportDate: wholesaleDownload.reportDate,
    });

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      reports: {
        annualSalesSummary: {
          filename: annualSalesDownload.filename,
          importedRows: annualSalesImport.importedRows,
          parsedRows: annualSalesImport.parsedRows,
          reportDate: annualSalesDownload.reportDate,
          replacedRows: annualSalesImport.deletedRows,
          runDate: annualSalesDownload.runDate,
          skippedRows: annualSalesImport.skippedRows,
          sizeBytes: annualSalesDownload.sizeBytes,
        },
        annualSalesSummaryByWholesale: {
          filename: wholesaleDownload.filename,
          importedRows: wholesaleImport.importedRows,
          parsedRows: wholesaleImport.parsedRows,
          reportDate: wholesaleDownload.reportDate,
          replacedRows: wholesaleImport.deletedRows,
          runDate: wholesaleDownload.runDate,
          skippedRows: wholesaleImport.skippedRows,
          sizeBytes: wholesaleDownload.sizeBytes,
        },
      },
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

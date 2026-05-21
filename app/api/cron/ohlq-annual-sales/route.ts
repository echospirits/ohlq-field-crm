export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import {
  getOhlqCronCatchupDays,
  getOhlqCronMaxReportDates,
  getOhlqCronReportDatesToRun,
  getOhlqCronReportDatesToRefresh,
  getOhlqCronRefreshDays,
} from '../../../../lib/ohlqAnnualSalesCron';
import {
  dispatchOhlqAnnualSalesWorkflow,
  getGithubActionsDispatchConfig,
} from '../../../../lib/githubActionsDispatch';
import { getOhlqAnnualSalesReportDate } from '../../../../lib/ohlqAnnualSalesReport';
import { runOhlqAnnualSalesWorkflow } from '../../../../lib/ohlqAnnualSalesWorkflow';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  try {
    const url = new URL(request.url);
    const requestedReportDate = url.searchParams.get('date') ?? url.searchParams.get('reportDate');
    const catchupDays = getOhlqCronCatchupDays(url.searchParams.get('catchupDays') ?? undefined);
    const maxReportDates = getOhlqCronMaxReportDates(url.searchParams.get('maxDates') ?? undefined);
    const refreshDays = getOhlqCronRefreshDays(url.searchParams.get('refreshDays') ?? undefined);
    const dispatchConfig = getGithubActionsDispatchConfig();
    const reportDates = requestedReportDate
      ? [getOhlqAnnualSalesReportDate(requestedReportDate).iso]
      : dispatchConfig
        ? getOhlqCronReportDatesToRefresh(new Date(), refreshDays)
        : await getOhlqCronReportDatesToRun({
            catchupDays,
            maxReportDates,
          });

    if (reportDates.length === 0) {
      console.log('OHLQ annual sales cron skipped: all candidate report dates are already complete.');

      return NextResponse.json({
        ok: true,
        reportDates: [],
        skipped: true,
      });
    }

    console.log(`OHLQ annual sales cron selected report date(s): ${reportDates.join(', ')}.`);

    if (dispatchConfig) {
      const queuedRuns = [];
      for (const reportDate of reportDates) {
        console.log(`OHLQ annual sales cron queued GitHub Actions workflow for report date ${reportDate}.`);
        const result = await dispatchOhlqAnnualSalesWorkflow({ reportDate });
        queuedRuns.push({ reportDate, result });
      }

      return NextResponse.json({
        ok: true,
        queued: true,
        reportDates,
        runCount: queuedRuns.length,
        runs: queuedRuns,
      });
    }

    if (process.env.VERCEL === '1') {
      throw new Error('GitHub Actions dispatch is not configured. Add GITHUB_ACTIONS_DISPATCH_TOKEN in Vercel.');
    }

    const runs = [];
    for (const reportDate of reportDates) {
      console.log(`OHLQ annual sales cron started for report date ${reportDate}.`);
      const result = await runOhlqAnnualSalesWorkflow({ reportDate });
      console.log(`OHLQ annual sales cron completed for report date ${reportDate} in ${result.durationMs}ms.`);
      runs.push({ reportDate, result });
    }

    return NextResponse.json({
      ok: true,
      reportDates,
      runCount: runs.length,
      runs,
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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 800;

import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '../../../../lib/auth';
import {
  getLatestManualOhlqReportDate,
  isFutureOhlqReportDate,
  normalizeManualOhlqReportDate,
} from '../../../../lib/ohlqManualImport';

const redirectToDataStatus = (request: Request, status: string, params?: Record<string, string | number>) => {
  const query = new URLSearchParams({ status });

  for (const [key, value] of Object.entries(params ?? {})) {
    query.set(key, String(value));
  }

  return NextResponse.redirect(new URL(`/admin/data-status?${query.toString()}`, request.url), 303);
};

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  if (session.user.role !== UserRole.ADMIN) {
    return NextResponse.redirect(new URL('/', request.url), 303);
  }

  const formData = await request.formData();
  const reportDate = normalizeManualOhlqReportDate(formData.get('reportDate'));
  const latestAllowedReportDate = getLatestManualOhlqReportDate();

  if (!reportDate || isFutureOhlqReportDate(reportDate, latestAllowedReportDate)) {
    return redirectToDataStatus(request, 'ohlq-invalid');
  }

  try {
    const { runOhlqAnnualSalesWorkflow } = await import('../../../../lib/ohlqAnnualSalesWorkflow');
    const result = await runOhlqAnnualSalesWorkflow({ reportDate });

    revalidatePath('/');
    revalidatePath('/admin/data-status');
    revalidatePath('/agencies');
    revalidatePath('/wholesale');
    revalidatePath('/alerts');
    revalidatePath('/my-week');

    return redirectToDataStatus(request, 'ohlq-imported', {
      annualRows: result.reports.annualSalesSummary.importedRows,
      date: reportDate,
      wholesaleRows: result.reports.annualSalesSummaryByWholesale.importedRows,
    });
  } catch (error) {
    console.error('Manual OHLQ import failed:', error);

    return redirectToDataStatus(request, 'ohlq-error', {
      message: (error instanceof Error ? error.message : String(error)).slice(0, 180),
    });
  }
}

export async function GET(request: Request) {
  return redirectToDataStatus(request, 'ohlq-error', {
    message: 'Use the Data Status form to run an OHLQ import.',
  });
}

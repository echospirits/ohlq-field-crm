export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { runOhlqAnnualSalesWorkflow } from '../../../../lib/ohlqAnnualSalesWorkflow';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  try {
    return NextResponse.json(await runOhlqAnnualSalesWorkflow());
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

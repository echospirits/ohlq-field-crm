export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { syncAllGoogleCalendarConnections } from '../../../../lib/calendar/worklistSync';
import { isSideEffectEnabled, logEnvironmentEvent } from '../../../../lib/appEnvironment';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSideEffectEnabled('cron') || !isSideEffectEnabled('calendar')) {
    logEnvironmentEvent('cron.calendar-sync.suppressed');
    return NextResponse.json({ attempted: 0, succeeded: 0, failed: 0, environmentDisabled: true });
  }
  return NextResponse.json(await syncAllGoogleCalendarConnections());
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import {
  DEFAULT_DIGEST_TIME_ZONE,
  getWeeklyDigestWindow,
  getZonedDateParts,
  isWeeklyDigestCronSendWindow,
  sendWeeklyDigestForAllUsers,
} from '../../../../lib/weeklyDigest';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const now = new Date();
  const local = getZonedDateParts(now, DEFAULT_DIGEST_TIME_ZONE);

  if (!isWeeklyDigestCronSendWindow(now, DEFAULT_DIGEST_TIME_ZONE)) {
    return NextResponse.json({
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      reason: `Skipped because local time is ${local.weekday} ${String(local.hour).padStart(2, '0')}:${String(
        local.minute,
      ).padStart(2, '0')} ${DEFAULT_DIGEST_TIME_ZONE}`,
    });
  }

  const result = await sendWeeklyDigestForAllUsers({
    window: getWeeklyDigestWindow(now, DEFAULT_DIGEST_TIME_ZONE),
  });

  return NextResponse.json({
    attempted: result.attempted,
    sent: result.sent,
    skipped: result.skipped + result.missingEmailSkipped,
    failed: result.failed,
    missingEmailSkipped: result.missingEmailSkipped,
    results: result.results,
  });
}

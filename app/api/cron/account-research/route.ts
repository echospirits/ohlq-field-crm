export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { getAccountResearchAutomationAvailability } from '../../../../lib/accountResearchOpenAI';
import { runAutomaticAccountResearch } from '../../../../lib/accountResearchAutomation';
import { logEnvironmentEvent } from '../../../../lib/appEnvironment';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const availability = getAccountResearchAutomationAvailability();
  if (!availability.available) {
    logEnvironmentEvent('cron.account-research.suppressed', { appEnvironment: availability.appEnvironment, enabled: availability.enabled });
    return NextResponse.json({ ok: true, skipped: true, environmentDisabled: true });
  }
  try {
    const result = await runAutomaticAccountResearch();
    logEnvironmentEvent('cron.account-research.completed', { submitted: result.submitted, queueCount: result.queueCount });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Automatic account research failed:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown automatic account research failure.' }, { status: 500 });
  }
}

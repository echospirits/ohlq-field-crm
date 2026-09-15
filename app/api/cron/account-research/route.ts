export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { runDailyAccountResearchWorkflow } from '../../../../lib/accountResearchDailyWorkflow';
import { getAccountResearchAutomationAvailability } from '../../../../lib/accountResearchOpenAI';
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
    const run = await start(runDailyAccountResearchWorkflow);
    logEnvironmentEvent('cron.account-research.started', { workflowRunId: run.runId });
    return NextResponse.json({ ok: true, started: true, workflowRunId: run.runId });
  } catch (error) {
    console.error('Automatic account research failed:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown automatic account research failure.' }, { status: 500 });
  }
}

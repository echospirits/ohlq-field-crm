import { sleep } from 'workflow';
import { ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT, ACCOUNT_RESEARCH_AUTOMATIC_WAVE_PAUSE } from './accountResearchPilot';
import { runAutomaticAccountResearch } from './accountResearchAutomation';
import { ECHO_ORGANIZATION_ID } from './echoAccess';
import { runWithOrganizationStateAccess } from './prisma';

async function processAutomaticResearchWave(pilotId: string | undefined, remainingRunCapacity: number) {
  'use step';
  // Hosted workflow steps run in a new request without the cron's application authorization.
  return runWithOrganizationStateAccess(ECHO_ORGANIZATION_ID, () => runAutomaticAccountResearch({ pilotId, remainingRunCapacity }));
}

processAutomaticResearchWave.maxRetries = 2;

export async function runDailyAccountResearchWorkflow() {
  'use workflow';

  let pilotId: string | undefined;
  let latest: Awaited<ReturnType<typeof processAutomaticResearchWave>> | null = null;
  let attempted = 0;
  let submitted = 0;
  let reconciliationRequired = 0;
  // Keep each invocation on its original pilot, including a resumed pilot.
  for (let pass = 0; pass < 160; pass += 1) {
    latest = await processAutomaticResearchWave(pilotId, ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT - attempted);
    pilotId = latest.pilotId ?? undefined;
    attempted += latest.attempted;
    submitted += latest.submitted;
    reconciliationRequired += latest.reconciliationRequired;
    if (!pilotId || latest.outstandingJobs === 0 || latest.paused) break;
    await sleep(ACCOUNT_RESEARCH_AUTOMATIC_WAVE_PAUSE);
  }

  return {
    runLimit: ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
    pilotId: pilotId ?? null,
    attempted,
    submitted,
    reconciliationRequired,
    outstandingJobs: latest?.outstandingJobs ?? 0,
    paused: latest?.paused ?? false,
  };
}

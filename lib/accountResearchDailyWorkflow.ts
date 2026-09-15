import { sleep } from 'workflow';
import {
  ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
  ACCOUNT_RESEARCH_AUTOMATIC_WAVE_PAUSE,
  ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE,
} from './accountResearchPilot';
import { runAutomaticAccountResearch } from './accountResearchAutomation';

type AutomaticWaveResult = {
  submitted: number;
  submittedToday: number;
  outstandingJobs: number;
  queueCount: number;
  runLimitReached: boolean;
};

async function processAutomaticResearchWave(remainingRunCapacity: number): Promise<AutomaticWaveResult> {
  'use step';
  const result = await runAutomaticAccountResearch({ submissionTake: ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE, remainingRunCapacity });
  return {
    submitted: result.submitted,
    submittedToday: result.submittedToday,
    outstandingJobs: result.outstandingJobs,
    queueCount: result.queueCount,
    runLimitReached: result.runLimitReached,
  };
}

processAutomaticResearchWave.maxRetries = 2;

export async function runDailyAccountResearchWorkflow() {
  'use workflow';

  let latest: AutomaticWaveResult | null = null;
  let submittedThisRun = 0;
  // Each invocation is capped independently. The scheduled cron invokes this
  // once per day, while an operator can run it again from Vercel to backfill
  // another batch without sharing the scheduled invocation's allowance.
  // The pass bound is larger than the 20 submission waves required for 500
  // accounts because alternate passes poll and apply background results.
  for (let pass = 0; pass < 160; pass += 1) {
    latest = await processAutomaticResearchWave(ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT - submittedThisRun);
    submittedThisRun += latest.submitted;
    if (submittedThisRun >= ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT || (latest.queueCount === 0 && latest.outstandingJobs === 0)) break;
    await sleep(ACCOUNT_RESEARCH_AUTOMATIC_WAVE_PAUSE);
  }

  return {
    runLimit: ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
    submittedThisRun,
    ...latest,
  };
}

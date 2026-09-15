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
  dailyLimitReached: boolean;
};

async function processAutomaticResearchWave(): Promise<AutomaticWaveResult> {
  'use step';
  const result = await runAutomaticAccountResearch({ submissionTake: ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE });
  return {
    submitted: result.submitted,
    submittedToday: result.submittedToday,
    outstandingJobs: result.outstandingJobs,
    queueCount: result.queueCount,
    dailyLimitReached: result.dailyLimitReached,
  };
}

processAutomaticResearchWave.maxRetries = 2;

export async function runDailyAccountResearchWorkflow() {
  'use workflow';

  let latest: AutomaticWaveResult | null = null;
  // This bound is intentionally larger than the 20 submission waves required
  // for 500 accounts because alternate passes poll and apply background results.
  for (let pass = 0; pass < 160; pass += 1) {
    latest = await processAutomaticResearchWave();
    if (latest.dailyLimitReached || (latest.queueCount === 0 && latest.outstandingJobs === 0)) break;
    await sleep(ACCOUNT_RESEARCH_AUTOMATIC_WAVE_PAUSE);
  }

  return {
    dailyLimit: ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
    ...latest,
  };
}

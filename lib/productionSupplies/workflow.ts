import { getWorkflowMetadata, sleep } from 'workflow';

/** Finite generations keep replay logs small and regularly adopt the latest deployment. */
export async function productionSupplySchedulerWorkflow(organizationId: string, generation: string) {
  'use workflow';
  const runId = getWorkflowMetadata().workflowRunId;
  const owner = { organizationId, generation, runId };
  for (let batch = 0; batch < 96; batch++) {
    const next = await supplySchedulerStep(owner);
    if (!next.continue || !next.nextAt) return { stopped: true, reason: next.reason };
    await sleep(new Date(next.nextAt));
  }
  return continueSupplyScheduler(owner);
}
async function supplySchedulerStep(owner: { organizationId: string; generation: string; runId: string }) {
  'use step';
  const { runSupplySchedulerTick } = await import('./scheduler');
  const next = await runSupplySchedulerTick(owner);
  console.log('Supply scheduler batch checkpointed', { organizationId: owner.organizationId, continuing: next.continue, nextAt: next.nextAt, reason: next.reason });
  return next;
}
async function continueSupplyScheduler(owner: { organizationId: string; generation: string; runId: string }) {
  'use step';
  const { rollSupplyScheduler } = await import('./scheduler');
  const result = await rollSupplyScheduler(owner);
  console.log('Supply scheduler generation handed off', { organizationId: owner.organizationId, status: result.status });
  return result;
}

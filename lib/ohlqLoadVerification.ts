import { validateRuntimeEnvironment } from './appEnvironment';
import { parseOhlqLoadDates } from './ohlqLoadDates';

/** Fail closed before any database read, including when setup never emitted its manifest. */
export function ohlqLoadVerificationInput(env: NodeJS.ProcessEnv = process.env) {
  const { appEnvironment } = validateRuntimeEnvironment(env);
  if (appEnvironment !== 'production' && appEnvironment !== 'test') throw new Error('Load verification requires an explicit production or test target.');
  const expectedRepository = appEnvironment === 'production' ? 'echospirits/ohlq-field-crm' : 'echospirits/neat-tst';
  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== expectedRepository) throw new Error('Load verification repository does not match the requested environment.');
  if (env.OHLQ_INPUTS_VALID !== 'success') throw new Error('The load did not supply a validated date manifest.');
  const reportDates = parseOhlqLoadDates(env.OHLQ_REPORT_DATES ?? '');
  const observationDates = parseOhlqLoadDates(env.OHLQ_OBSERVATION_DATE ?? '');
  if (observationDates.length !== 1) throw new Error('Load verification requires one observation date.');
  return { reportDates, observationDate: observationDates[0] };
}

// Discovery and sales-state reconciliation do not have durable completion
// receipts. A failed attempted stage leaves their outcome unverified. A skipped
// stage after setup failure can still use the independent saved-data proof.
export function unverifiedOhlqProcessingStages(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ['ACCOUNT_SALES_RECONCILIATION', env.OHLQ_SALES_STAGE_STATUS],
    ['PRODUCT_DISCOVERY', env.OHLQ_DISCOVERY_STAGE_STATUS],
  ].filter(([, outcome]) => outcome !== 'success' && outcome !== 'skipped').map(([source]) => source!);
}

/** Readiness retries are reads only. No importer is called from the final gate. */
export async function verifyOhlqLoadWithRetries<T extends { ready: boolean }>(check: () => Promise<T>, {
  wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
  warn = console.warn,
  retryIncomplete = true,
}: { wait?: (milliseconds: number) => Promise<void>; warn?: (message: string) => void; retryIncomplete?: boolean } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await check();
      if (result.ready || !retryIncomplete || attempt === 3) return result;
    } catch (error) {
      if (attempt === 3) throw error;
    }
    warn(`Required data is not yet verified; checking again in ${attempt * 30} seconds (attempt ${attempt + 1}/3).`);
    await wait(attempt * 30_000);
  }
}

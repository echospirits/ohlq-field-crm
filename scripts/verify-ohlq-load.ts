import { appendFileSync } from 'node:fs';
import { checkOhlqLoadReadiness } from '../lib/ohlqLoadReadiness';
import { ohlqLoadVerificationInput, unverifiedOhlqProcessingStages, verifyOhlqLoadWithRetries } from '../lib/ohlqLoadVerification';
import { prisma } from '../lib/prisma';
import { EASTERN_TIME_ZONE, formatDateInputValue } from '../lib/dateTime';

async function main() {
  const preflight = process.argv.includes('--preflight');
  const input = ohlqLoadVerificationInput();
  const result = await verifyOhlqLoadWithRetries(() => prisma.$transaction(async db => {
    await db.$executeRaw`SET TRANSACTION READ ONLY`;
    return checkOhlqLoadReadiness(input, db);
  }, { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 120_000 }), {
    retryIncomplete: !preflight,
    warn: message => console.warn(`::warning::${message}`),
  });
  if (preflight) {
    // Both automatic triggers share workflow concurrency. A confirmed gap can
    // enter recovery now. An unavailable read must not authorize writes.
    const summary = result.ready
      ? 'Required saved data is current. Skipping the full load.'
      : 'Required saved data is incomplete. Proceeding with the daily load.';
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error('Preflight requires a GitHub Actions output file.');
    console.log(summary, JSON.stringify({ ...input, ...result }));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## OHLQ daily load check\n\n${summary}\n`);
    }
    appendFileSync(output, `already_current=${result.ready}\n`);
    return;
  }
  for (const source of unverifiedOhlqProcessingStages()) {
    const issue = { source, date: input.observationDate, status: 'FAIL' as const, code: 'UNVERIFIED_PROCESSING_STAGE' };
    result.checks.push(issue);
    result.issues.push(issue);
    result.ready = false;
  }
  if (!result.ready && formatDateInputValue(new Date(), EASTERN_TIME_ZONE) !== input.observationDate) {
    result.warnings.push({ source: 'LOAD_VERIFICATION', date: input.observationDate, status: 'WARNING', code: 'VERIFICATION_CLOCK_ROLLOVER' });
  }
  // The checker returns only reason codes, dates, scoped identifiers and counts;
  // never provider messages, credentials, raw source rows or account details.
  console.log(JSON.stringify({ ...input, ...result }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## OHLQ data verification\n\n${result.ready ? 'Required saved data is complete and current.' : 'Required data remains incomplete after retries.'}\n\n` +
      `Report dates: ${input.reportDates.join(', ')}. Observation date: ${input.observationDate}.\n\n` +
      `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
  }
  if (!result.ready) {
    console.error('::error::Unresolved OHLQ data issue after retries. See the verification summary for affected sources.');
    process.exitCode = 1;
  } else if (process.env.OHLQ_ATTEMPT_STATUS !== 'success') {
    console.warn('::warning::A load attempt failed, but the required saved data was independently verified current. No unresolved data issue remains.');
  }
}

main().catch(() => {
  // Raw Prisma/provider errors can contain connection details. An unknown result
  // is actionable, not a successful empty scope or a silent warning.
  console.error('::error::Unable to verify required OHLQ data after retries. Check the target, date manifest and database availability.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

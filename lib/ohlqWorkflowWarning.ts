import { appendFileSync } from 'node:fs';
import type { OhlqSourceNotUpdatedError } from './ohlqSourceFreshness';

export function reportOhlqSourceWarning(error: OhlqSourceNotUpdatedError, env: Record<string, string | undefined> = process.env, log: (message: string) => void = console.warn) {
  const message = error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  log(env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `Warning: ${error.message}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'imported=false\n');
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n### OHLQ source warning\n\n${error.message}\n`);
}

import { z } from 'zod';
import { readAccountConfiguration } from '../crm/accountConfiguration';
import { isSideEffectEnabled, parseBooleanEnvironmentValue } from '../appEnvironment';

export const SUPPLY_POLL_MINUTES = 6 * 60;
export const SUPPLY_FRESH_MAIL_MS = 15 * 60_000;
export const SUPPLY_FRESH_MAILBOX_LIMIT = 3;

export function nextSupplyFreshMailSlot(now: number) {
  return (Math.floor(now / SUPPLY_FRESH_MAIL_MS) + 1) * SUPPLY_FRESH_MAIL_MS;
}

// Explicit TST opt-in affects this feature only; it never enables unrelated jobs.
export function supplyJobsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return parseBooleanEnvironmentValue(env.SUPPLY_JOBS_ENABLED, 'SUPPLY_JOBS_ENABLED') ?? isSideEffectEnabled('cron', env);
}

export const supplySettingsInput = z.object({
  productionTeamId: z.string().max(100).default(''),
  viewerUserIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  managerUserIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  historyDays: z.coerce.number().int().min(1).max(365).default(90),
  // Retain older saved settings and their access grants while enforcing the
  // current minimum interval for every mailbox, without a database rewrite.
  pollMinutes: z.coerce.number().int().min(15).max(1440).default(SUPPLY_POLL_MINUTES).transform(minutes => Math.max(SUPPLY_POLL_MINUTES, minutes)),
  includeSent: z.boolean().default(true),
});
export type SupplySettings = z.infer<typeof supplySettingsInput>;
export function readSupplySettings(preferences: unknown): SupplySettings {
  const raw = (preferences as { productionSupplies?: unknown } | null)?.productionSupplies;
  const result = supplySettingsInput.safeParse(raw ?? {});
  return result.success ? result.data : supplySettingsInput.parse({});
}
export function productionMemberIds(preferences: unknown): string[] {
  const settings = readSupplySettings(preferences);
  return readAccountConfiguration(preferences).teams.find(team => team.id === settings.productionTeamId)?.memberIds ?? [];
}
// Membership never confers operational access or permission to read a mailbox.
export function hasSupplyAccess(user: { id: string; role: string }, settings: SupplySettings, manage = false) {
  if (user.role === 'ADMIN' || user.role === 'PLATFORM_ADMIN') return true;
  if (settings.managerUserIds.includes(user.id)) return true;
  return !manage && settings.viewerUserIds.includes(user.id);
}

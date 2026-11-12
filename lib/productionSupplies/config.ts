import { z } from 'zod';
import { readAccountConfiguration } from '../crm/accountConfiguration';
import { isSideEffectEnabled, parseBooleanEnvironmentValue } from '../appEnvironment';

// Explicit TST opt-in affects this feature only; it never enables unrelated jobs.
export function supplyJobsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return parseBooleanEnvironmentValue(env.SUPPLY_JOBS_ENABLED, 'SUPPLY_JOBS_ENABLED') ?? isSideEffectEnabled('cron', env);
}

export const supplySettingsInput = z.object({
  productionTeamId: z.string().max(100).default(''),
  viewerUserIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  managerUserIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  historyDays: z.coerce.number().int().min(1).max(365).default(90),
  pollMinutes: z.coerce.number().int().min(15).max(1440).default(15),
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

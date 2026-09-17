import { z } from 'zod';

export const ownershipOptions = ['Unknown', 'Independent', 'Chain', 'Franchise'] as const;
export const formatOptions = ['Unknown', 'Grocery', 'Liquor / beverage store', 'Wine / specialty store', 'Convenience', 'Other'] as const;
export const buyingOptions = ['Unknown', 'Store buyer', 'Regional buyer', 'Corporate buyer', 'Shared decision'] as const;
export const settingOptions = ['Unknown', 'Urban', 'Suburban', 'Small town', 'Rural', 'Mixed'] as const;
export const nearbyOptions = ['Grocery', 'Restaurants / bars', 'Specialty food', 'Shopping center', 'Offices', 'Residential', 'University', 'Hotels / tourism'] as const;
const text = (max: number) => z.string().trim().max(max);
const date = text(10).refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10), 'Use a valid date on or before today.');
const source = z.object({
  name: text(200),
  url: text(1000).refine((value) => { if (!value) return true; try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }, 'Use an http or https source URL.'),
  observedOn: date,
});
const optionalNumber = (max: number) => z.number().int().min(0).max(max).nullable();

export const storeContextSchema = z.object({
  store: z.object({ ownership: z.enum(ownershipOptions), chainName: text(160), format: z.enum(formatOptions), buying: z.enum(buyingOptions), notes: text(1000), source }),
  area: z.object({ setting: z.enum(settingOptions), neighborhood: text(160), nearby: z.array(z.enum(nearbyOptions)).max(nearbyOptions.length).transform((values) => [...new Set(values)]), notes: text(1000), source }),
  demographics: z.object({ geography: text(200), year: z.number().int().min(2000).max(new Date().getUTCFullYear()).nullable(), medianHouseholdIncome: optionalNumber(10_000_000), adultPopulation: optionalNumber(100_000_000), source }),
}).superRefine((value, context) => {
  if (['Chain', 'Franchise'].includes(value.store.ownership) && !value.store.chainName) context.addIssue({ code: 'custom', path: ['store', 'chainName'], message: 'Enter the chain or franchise name.' });
  const d = value.demographics;
  if ((d.medianHouseholdIncome !== null || d.adultPopulation !== null) && (!d.geography || !d.year || !d.source.name || !d.source.url || !d.source.observedOn)) context.addIssue({ code: 'custom', path: ['demographics', 'source', 'name'], message: 'Demographics need the area, data year, source name, URL, and observation date.' });
  for (const section of ['store', 'area'] as const) {
    const populated = section === 'store'
      ? value.store.ownership !== 'Unknown' || value.store.format !== 'Unknown' || value.store.buying !== 'Unknown' || Boolean(value.store.chainName || value.store.notes)
      : value.area.setting !== 'Unknown' || Boolean(value.area.neighborhood || value.area.nearby.length || value.area.notes);
    if (populated && (!value[section].source.name || !value[section].source.observedOn)) context.addIssue({ code: 'custom', path: [section, 'source', 'name'], message: 'Add a source (such as a buyer conversation or store website) and observation date.' });
  }
});
export type StoreContextInput = z.infer<typeof storeContextSchema>;
export type StoreContext = StoreContextInput & { version: 1; savedAt: string; savedBy: string };
export const emptyStoreContext = (): StoreContextInput => ({
  store: { ownership: 'Unknown', chainName: '', format: 'Unknown', buying: 'Unknown', notes: '', source: { name: '', url: '', observedOn: '' } },
  area: { setting: 'Unknown', neighborhood: '', nearby: [], notes: '', source: { name: '', url: '', observedOn: '' } },
  demographics: { geography: '', year: null, medianHouseholdIncome: null, adultPopulation: null, source: { name: '', url: '', observedOn: '' } },
});
export function readStoreContext(value: unknown): StoreContext | null {
  const result = storeContextSchema.safeParse(value);
  if (!result.success || !value || typeof value !== 'object') return null;
  const metadata = value as Record<string, unknown>;
  if (metadata.version !== 1 || typeof metadata.savedAt !== 'string' || typeof metadata.savedBy !== 'string') return null;
  return { ...result.data, version: 1, savedAt: metadata.savedAt, savedBy: metadata.savedBy };
}
export const contextSourceIsStale = (observedOn: string, now = new Date()) => Boolean(observedOn) && now.getTime() - Date.parse(observedOn) > 180 * 86_400_000;

export function readCategoryMix(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0).sort((a, b) => b[1] - a[1]);
}

export const FEATURE_KEYS = [
  'CORE_CRM',
  'VISITS',
  'WORKLIST',
  'AGENCIES',
  'WHOLESALE_ACCOUNTS',
  'OHLQ_SALES_DATA',
  'AGENCY_INVENTORY',
  'WEEKLY_DIGEST',
  'CALENDAR_INTEGRATION',
  'LOCATION_PROXIMITY',
  'AGENCY_INTELLIGENCE',
  'WHOLESALE_OPPORTUNITIES',
  'ADVANCED_INTELLIGENCE',
  'TASTING_WORKFLOWS',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureDefinition = {
  key: FeatureKey;
  label: string;
  description: string;
  category: 'Core' | 'Ohio data' | 'Intelligence' | 'Field';
  defaultEnabled: boolean;
  dependencies: FeatureKey[];
  beta?: boolean;
};

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDefinition> = {
  CORE_CRM: { key: 'CORE_CRM', label: 'Core CRM', description: 'Users, shared accounts, private overlays, and core relationship workflows.', category: 'Core', defaultEnabled: true, dependencies: [] },
  VISITS: { key: 'VISITS', label: 'Visits', description: 'Field visit capture and visit history.', category: 'Core', defaultEnabled: true, dependencies: ['CORE_CRM'] },
  WORKLIST: { key: 'WORKLIST', label: 'Worklist', description: 'Assignments, follow-ups, and personal work planning.', category: 'Core', defaultEnabled: true, dependencies: ['CORE_CRM'] },
  AGENCIES: { key: 'AGENCIES', label: 'Agencies', description: 'Ohio agency directory and shared reference data.', category: 'Ohio data', defaultEnabled: true, dependencies: ['CORE_CRM'] },
  WHOLESALE_ACCOUNTS: { key: 'WHOLESALE_ACCOUNTS', label: 'Wholesale accounts', description: 'Ohio wholesale accounts and purchase history.', category: 'Ohio data', defaultEnabled: true, dependencies: ['CORE_CRM'] },
  OHLQ_SALES_DATA: { key: 'OHLQ_SALES_DATA', label: 'Ohio sales data', description: 'Shared OHLQ sales datasets and tenant-specific product interpretation.', category: 'Ohio data', defaultEnabled: true, dependencies: [] },
  AGENCY_INVENTORY: { key: 'AGENCY_INVENTORY', label: 'Agency inventory', description: 'Current and historical Ohio agency inventory.', category: 'Ohio data', defaultEnabled: true, dependencies: ['AGENCIES'] },
  WEEKLY_DIGEST: { key: 'WEEKLY_DIGEST', label: 'Weekly digest', description: 'Organization-scoped activity email summaries.', category: 'Core', defaultEnabled: true, dependencies: ['CORE_CRM'] },
  CALENDAR_INTEGRATION: { key: 'CALENDAR_INTEGRATION', label: 'Calendar integration', description: 'Worklist synchronization with connected calendars.', category: 'Field', defaultEnabled: true, dependencies: ['WORKLIST'] },
  LOCATION_PROXIMITY: { key: 'LOCATION_PROXIMITY', label: 'Location proximity', description: 'Nearby-account tools for field teams.', category: 'Field', defaultEnabled: true, dependencies: ['CORE_CRM'] },
  AGENCY_INTELLIGENCE: { key: 'AGENCY_INTELLIGENCE', label: 'Agency Intelligence', description: 'Organization-specific agency prioritization and recommended actions.', category: 'Intelligence', defaultEnabled: true, dependencies: ['AGENCIES', 'OHLQ_SALES_DATA', 'AGENCY_INVENTORY'] },
  WHOLESALE_OPPORTUNITIES: { key: 'WHOLESALE_OPPORTUNITIES', label: 'Wholesale Opportunities', description: 'Forward-looking wholesale account opportunity detection, prioritization, and recommended actions.', category: 'Intelligence', defaultEnabled: false, dependencies: ['WHOLESALE_ACCOUNTS', 'OHLQ_SALES_DATA'] },
  ADVANCED_INTELLIGENCE: { key: 'ADVANCED_INTELLIGENCE', label: 'Advanced intelligence', description: 'Advanced scoring and predictive account recommendations.', category: 'Intelligence', defaultEnabled: false, dependencies: ['OHLQ_SALES_DATA'] },
  TASTING_WORKFLOWS: { key: 'TASTING_WORKFLOWS', label: 'Tasting workflows', description: 'Restricted tasting visit workflow and context.', category: 'Field', defaultEnabled: true, dependencies: ['VISITS', 'AGENCIES'] },
};

export const DEFAULT_FEATURE_KEYS = FEATURE_KEYS.filter((key) => FEATURE_REGISTRY[key].defaultEnabled);
export const ECHO_FEATURE_KEYS = [...FEATURE_KEYS];

export function validateFeatureSelection(selected: readonly string[]) {
  const enabled = new Set(selected.filter((key): key is FeatureKey => FEATURE_KEYS.includes(key as FeatureKey)));
  const missing = [...enabled].flatMap((key) => FEATURE_REGISTRY[key].dependencies.filter((dependency) => !enabled.has(dependency)).map((dependency) => ({ feature: key, dependency })));
  return { enabled: [...enabled], missing };
}

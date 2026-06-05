export type TenantProductFilterMode = 'vendor-exclusions' | 'item-list';

export type TenantProductFilter = {
  excludedItemCodes: string[];
  itemCodes: string[];
  mode: TenantProductFilterMode;
  vendorIds: string[];
};

export type TenantConfig = {
  appName: string;
  digestName: string;
  entityName: string;
  id: string;
  productLabel: string;
  productPluralLabel: string;
  productFilter: TenantProductFilter;
};

export const DEFAULT_TENANT_ID = 'echo-spirits';
export const DEFAULT_TENANT_ENTITY_NAME = 'Echo Spirits Distilling Co.';
export const DEFAULT_TENANT_APP_NAME = 'Echo Field CRM';
export const DEFAULT_TENANT_DIGEST_NAME = 'Echo CRM';
export const DEFAULT_TENANT_PRODUCT_LABEL = 'Echo';
export const DEFAULT_TENANT_PRODUCT_PLURAL_LABEL = 'Echo items';
export const DEFAULT_TENANT_OHLQ_VENDOR_IDS = ['Z90399001'] as const;
export const DEFAULT_TENANT_EXCLUDED_ITEM_CODES = ['3150B'] as const;

const normalizeToken = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
};

const parseList = (value: string | null | undefined) =>
  Array.from(
    new Set(
      String(value ?? '')
        .split(/[\n,;]+/)
        .map(normalizeToken)
        .filter(Boolean) as string[],
    ),
  );

const fromEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
) => {
  const value = env[key]?.trim();
  return value || fallback;
};

const getFilterMode = (
  value: string | null | undefined,
): TenantProductFilterMode => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'item-list' || normalized === 'item-code-list' ? 'item-list' : 'vendor-exclusions';
};

export function getTenantConfig(env: NodeJS.ProcessEnv = process.env): TenantConfig {
  const productLabel = fromEnv(env, 'TENANT_PRODUCT_LABEL', DEFAULT_TENANT_PRODUCT_LABEL);
  const vendorIds = parseList(
    env.TENANT_OHLQ_VENDOR_IDS ?? DEFAULT_TENANT_OHLQ_VENDOR_IDS.join(','),
  );
  const excludedItemCodes = parseList(
    env.TENANT_EXCLUDED_ITEM_CODES ?? DEFAULT_TENANT_EXCLUDED_ITEM_CODES.join(','),
  );
  const itemCodes = parseList(env.TENANT_ITEM_CODES);

  return {
    appName: fromEnv(env, 'TENANT_APP_NAME', DEFAULT_TENANT_APP_NAME),
    digestName: fromEnv(env, 'TENANT_DIGEST_NAME', DEFAULT_TENANT_DIGEST_NAME),
    entityName: fromEnv(env, 'TENANT_ENTITY_NAME', DEFAULT_TENANT_ENTITY_NAME),
    id: fromEnv(env, 'TENANT_ID', DEFAULT_TENANT_ID),
    productLabel,
    productPluralLabel: fromEnv(
      env,
      'TENANT_PRODUCT_PLURAL_LABEL',
      DEFAULT_TENANT_PRODUCT_PLURAL_LABEL,
    ),
    productFilter: {
      excludedItemCodes,
      itemCodes,
      mode: getFilterMode(env.TENANT_PRODUCT_FILTER_MODE),
      vendorIds,
    },
  };
}

export function matchesTenantProductFilter({
  filter,
  itemCode,
  vendor,
}: {
  filter: TenantProductFilter;
  itemCode: string | null | undefined;
  vendor: string | null | undefined;
}) {
  const normalizedItemCode = normalizeToken(itemCode);

  if (filter.mode === 'item-list') {
    return Boolean(normalizedItemCode && filter.itemCodes.includes(normalizedItemCode));
  }

  const normalizedVendor = normalizeToken(vendor);
  return Boolean(
    normalizedVendor &&
      filter.vendorIds.includes(normalizedVendor) &&
      !filter.excludedItemCodes.includes(normalizedItemCode ?? ''),
  );
}

export function matchesTenantProduct({
  config = getTenantConfig(),
  itemCode,
  vendor,
}: {
  config?: TenantConfig;
  itemCode: string | null | undefined;
  vendor: string | null | undefined;
}) {
  return matchesTenantProductFilter({
    filter: config.productFilter,
    itemCode,
    vendor,
  });
}

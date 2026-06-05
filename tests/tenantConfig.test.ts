import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getTenantConfig,
  matchesTenantProduct,
} from '../lib/tenantConfig';

describe('tenant product configuration', () => {
  it('defaults to the current Echo vendor with configured exclusions', () => {
    const config = getTenantConfig({} as NodeJS.ProcessEnv);

    assert.equal(config.entityName, 'Echo Spirits Distilling Co.');
    assert.equal(matchesTenantProduct({ config, vendor: 'Z90399001', itemCode: '0100A' }), true);
    assert.equal(matchesTenantProduct({ config, vendor: 'z90399001', itemCode: '3150B' }), false);
    assert.equal(matchesTenantProduct({ config, vendor: 'OTHER', itemCode: '0100A' }), false);
  });

  it('supports a vendor ID list plus excluded item codes', () => {
    const config = getTenantConfig({
      TENANT_OHLQ_VENDOR_IDS: 'VENDOR1, vendor2',
      TENANT_EXCLUDED_ITEM_CODES: 'SKIP1; skip2',
      TENANT_PRODUCT_LABEL: 'Acme',
      TENANT_PRODUCT_PLURAL_LABEL: 'Acme items',
    } as NodeJS.ProcessEnv);

    assert.equal(config.productLabel, 'Acme');
    assert.equal(matchesTenantProduct({ config, vendor: 'vendor2', itemCode: 'KEEP1' }), true);
    assert.equal(matchesTenantProduct({ config, vendor: 'vendor1', itemCode: 'skip2' }), false);
    assert.equal(matchesTenantProduct({ config, vendor: 'OTHER', itemCode: 'KEEP1' }), false);
  });

  it('supports an explicit item-code allowlist instead of vendor filtering', () => {
    const config = getTenantConfig({
      TENANT_PRODUCT_FILTER_MODE: 'item-list',
      TENANT_ITEM_CODES: '0100A\n0200B',
      TENANT_OHLQ_VENDOR_IDS: '',
    } as NodeJS.ProcessEnv);

    assert.equal(matchesTenantProduct({ config, vendor: 'OTHER', itemCode: '0100A' }), true);
    assert.equal(matchesTenantProduct({ config, vendor: 'Z90399001', itemCode: '0300C' }), false);
  });
});

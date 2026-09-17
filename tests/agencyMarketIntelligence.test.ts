import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  aggregateAgencyMarketPurchases,
  analyzeAgencyMarketProfile,
  analyzeAgencyProductMarketFit,
  getAgencyMarketRecommendationType,
} from '../lib/agencyMarketIntelligence';
import type { AffinityProduct, AffinityPurchase, BuyerBasket } from '../lib/opportunityAffinity';

const target: AffinityProduct = {
  category: 'RUM',
  isLocal: true,
  itemCode: 'TENANT-RUM',
  name: 'Tenant Rum',
  price750: 30,
  priority: 1,
};

const purchase = (overrides: Partial<AffinityPurchase> = {}): AffinityPurchase => ({
  bottles90: 24,
  category: 'RUM',
  isEcho: false,
  isLocal: false,
  itemCode: 'OTHER-RUM',
  liters: 0.75,
  price750: 30,
  ...overrides,
});

describe('Agency market basket construction', () => {
  test('normalizes size and separates tenant volume from non-tenant evidence', () => {
    const result = aggregateAgencyMarketPurchases({
      catalog: [
        { itemCode: 'TENANT-RUM', name: 'Tenant Rum', category: 'Rum', productVolume: 25.4, retailPrice: 30 },
        { itemCode: 'OTHER-RUM', name: 'Other Rum', category: 'Rum', productVolume: 59.2, retailPrice: 35 },
      ],
      rows: [
        { agencyId: ' 10562 ', brand: 'TENANT-RUM', retailBottlesSold: 100 },
        { agencyId: '10562', brand: 'OTHER-RUM', retailBottlesSold: 3 },
      ],
      tenantItemCodes: new Set(['TENANT-RUM']),
    });
    const purchases = result.get('10562')!;
    const profile = analyzeAgencyMarketProfile(purchases, 30);

    assert.equal(profile.tenantRetailEqBottles, 100);
    assert.equal(profile.nonTenantRetailEqBottles, 7);
    assert.deepEqual(profile.categoryMix, { RUM: 7 });
    assert.equal(profile.medianPrice750, 15);
  });

  test('missing observation coverage is uncertainty rather than a market zero', () => {
    const profile = analyzeAgencyMarketProfile([purchase()], 7);
    assert.equal(profile.nonTenantRetailEqBottles, 24);
    assert.equal(profile.confidence, 'INSUFFICIENT_DATA');
  });
});

describe('shadow product fit', () => {
  const peerBaskets: BuyerBasket[] = Array.from({ length: 10 }, (_, index) => ({
    accountId: `peer-${index}`,
    purchases: [
      purchase({ bottles90: 4, isEcho: true, itemCode: target.itemCode }),
      purchase({ bottles90: 24, itemCode: `OTHER-${index}` }),
    ],
  }));

  test('uses non-tenant category and price demand without rewarding existing tenant sales', () => {
    const market = [purchase({ bottles90: 36 })];
    const tenantSuccess = purchase({ bottles90: 500, isEcho: true, itemCode: target.itemCode });
    const profile = analyzeAgencyMarketProfile([...market, tenantSuccess], 30);
    const withoutTenantSales = analyzeAgencyProductMarketFit({
      agencyId: 'candidate',
      baskets: peerBaskets,
      observedDayCount: 30,
      profile,
      purchases: market,
      target,
    });
    const withTenantSales = analyzeAgencyProductMarketFit({
      agencyId: 'candidate',
      baskets: peerBaskets,
      observedDayCount: 30,
      profile,
      purchases: [...market, tenantSuccess],
      target,
    });

    assert.equal(withTenantSales.fitScore, withoutTenantSales.fitScore);
    assert.equal(withTenantSales.categoryEqBottles, withoutTenantSales.categoryEqBottles);
    assert.equal(withTenantSales.fitBand, 'HIGH');
    assert.equal(withTenantSales.confidence, 'MEDIUM');
  });

  test('does not translate cheap vodka volume into premium rum fit', () => {
    const purchases = [purchase({ bottles90: 500, category: 'VODKA', price750: 7 })];
    const profile = analyzeAgencyMarketProfile(purchases, 30);
    const fit = analyzeAgencyProductMarketFit({
      agencyId: 'candidate',
      baskets: peerBaskets,
      observedDayCount: 30,
      profile,
      purchases,
      target,
    });

    assert.equal(fit.categoryEqBottles, 0);
    assert.equal(fit.confidence, 'INSUFFICIENT_DATA');
    assert.equal(fit.fitBand, 'INSUFFICIENT_DATA');
  });

  test('classifies entry, expansion, and current placement independently of fit', () => {
    assert.equal(getAgencyMarketRecommendationType({ currentPlacement: false, hasAnyPortfolioPlacement: false }), 'ENTRY');
    assert.equal(getAgencyMarketRecommendationType({ currentPlacement: false, hasAnyPortfolioPlacement: true }), 'EXPANSION');
    assert.equal(getAgencyMarketRecommendationType({ currentPlacement: true, hasAnyPortfolioPlacement: true }), 'CURRENT_PLACEMENT');
  });
});

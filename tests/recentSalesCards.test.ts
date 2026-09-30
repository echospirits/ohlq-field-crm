import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyRecentSalesCard } from '../app/agencies/AgencyRecentSalesCard';
import { WholesaleRecentPurchasesCard } from '../app/wholesale/WholesaleRecentPurchasesCard';
import type { TenantConfig } from '../lib/tenantConfig';

const config: TenantConfig = {
  appName: 'Neat',
  digestName: 'Neat',
  entityName: 'Other Distillery',
  id: 'other-tenant',
  productLabel: 'Other Distillery',
  productPluralLabel: 'Other Distillery items',
  productFilter: { excludedItemCodes: [], itemCodes: ['0200B'], mode: 'item-list', vendorIds: ['OTHER'] },
};

it('labels retail sales for the selected organization, including the empty state', () => {
  const html = renderToStaticMarkup(createElement(AgencyRecentSalesCard, {
    config,
    salesWindows: [
      { days: 7, endDate: '2026-05-12', items: [], startDate: '2026-05-06' },
      { days: 30, endDate: '2026-05-12', items: [], startDate: '2026-04-13' },
    ],
  }));
  assert.match(html, /Recent Other Distillery Item Sales/);
  assert.match(html, /No Other Distillery items sales found/);
  assert.doesNotMatch(html, /Echo/);
});

it('shows only the tenant product list in wholesale purchases', () => {
  const html = renderToStaticMarkup(createElement(WholesaleRecentPurchasesCard, {
    purchases: {
      endDate: '2026-05-12',
      licenseeId: '72045',
      productLabel: config.productLabel,
      productPluralLabel: config.productPluralLabel,
      startDate: '2026-04-13',
      tracked: {
        count: 1,
        items: [{ agencyCount: 1, itemCode: '0200B', itemName: 'Zeta Whiskey', purchaseLineCount: 1, totalBottlesSold: 2, vendorCount: 1 }],
        purchaseLineCount: 1,
        totalBottlesSold: 2,
      },
    },
  }));
  assert.match(html, /Other Distillery/);
  assert.match(html, /Zeta Whiskey/);
  assert.doesNotMatch(html, /All purchases/);
  assert.doesNotMatch(html, /Echo/);
});

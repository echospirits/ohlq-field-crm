import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OrganizationProductStatus, type PrismaClient } from '@prisma/client';
import { discoverOrganizationProducts } from '../lib/organizationProductDiscovery';

describe('organization product discovery', () => {
  it('infers the Brand Master vendor from sales and adds every vendor item for review', async () => {
    let catalogCall = 0;
    let createdProducts: Array<Record<string, unknown>> = [];
    const updates: unknown[] = [];
    const db = {
      organization: {
        findUnique: async () => ({
          onboardingData: { productsConfirmed: true },
          primaryState: 'OH',
          vendorIdentifiers: [{ label: null, vendorId: 'Z30170001' }],
        }),
        update: async (args: unknown) => { updates.push(args); },
      },
      ohlqAnnualSalesRow: { findMany: async () => [{ brand: '7698B' }] },
      ohlqAnnualSalesByWholesaleRow: { findMany: async () => [] },
      ohlqAgencyInventoryCurrent: { findMany: async () => [] },
      ohlqBrandMasterItem: {
        findMany: async () => {
          catalogCall += 1;
          if (catalogCall === 1) return [{ vendor: 'MIDDLE WEST SPIRITS LLC' }];
          return [
            { category: 'Vodka', itemCode: '7698B', name: 'OYO VODKA' },
            { category: 'Whiskey', itemCode: '7700B', name: 'MIDDLE WEST STRAIGHT WHEAT WHISKEY' },
          ];
        },
      },
      organizationProduct: {
        count: async () => 2,
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          createdProducts = data;
          return { count: data.length };
        },
      },
    } as unknown as PrismaClient;

    const result = await discoverOrganizationProducts({ db, organizationId: 'middle-west' });

    assert.deepEqual(result.inferredVendorNames, ['MIDDLE WEST SPIRITS LLC']);
    assert.equal(result.created, 2);
    assert.deepEqual(createdProducts.map((product) => product.externalItemCode), ['7698B', '7700B']);
    assert.ok(createdProducts.every((product) => product.status === OrganizationProductStatus.PENDING_REVIEW));
    assert.equal(updates.length, 1);
  });

  it('does not overwrite existing organization product decisions', async () => {
    const db = {
      organization: {
        findUnique: async () => ({ onboardingData: {}, primaryState: 'OH', vendorIdentifiers: [{ label: 'Known Vendor', vendorId: 'V1' }] }),
        update: async () => { throw new Error('No onboarding update expected when nothing new was created.'); },
      },
      ohlqAnnualSalesRow: { findMany: async () => [] },
      ohlqAnnualSalesByWholesaleRow: { findMany: async () => [] },
      ohlqAgencyInventoryCurrent: { findMany: async () => [] },
      ohlqBrandMasterItem: { findMany: async () => [{ category: null, itemCode: 'A1', name: 'Existing item' }] },
      organizationProduct: { count: async () => 1, createMany: async () => ({ count: 0 }) },
    } as unknown as PrismaClient;

    const result = await discoverOrganizationProducts({ db, organizationId: 'existing' });
    assert.equal(result.created, 0);
  });
});

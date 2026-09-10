import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getWholesaleOrderAutomaticMatchKey,
  normalizeWholesalePermitNumber,
  planWholesaleOrderReconciliation,
  reconcileWholesaleOrdersAfterOhlqImport,
  type WholesaleOrderReconciliationOrder,
  type WholesaleOrderReconciliationRow,
} from '../lib/wholesaleOrderReconciliation';
import type { PrismaClient } from '@prisma/client';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const order = (overrides: Partial<WholesaleOrderReconciliationOrder> = {}): WholesaleOrderReconciliationOrder => ({
  customerIdentity: 'customer-1',
  customerPermitNumber: '00123456-01-2',
  filedSource: null,
  id: 'order-1',
  lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'Z90399001' }],
  organizationId: 'organization-1',
  saleDate: day('2026-08-01'),
  sellerStoreNumber: '90399',
  status: 'SENT',
  ...overrides,
});

const row = (overrides: Partial<WholesaleOrderReconciliationRow> = {}): WholesaleOrderReconciliationRow => ({
  agencyId: '90399',
  itemCode: '2804B',
  permitNumber: '123456-1-2',
  reportDate: day('2026-08-01'),
  vendor: 'Z90399001',
  wholesaleBottlesSold: 2,
  ...overrides,
});

describe('wholesale order reconciliation matching', () => {
  it('normalizes leading zeroes in every numeric permit segment without dropping suffixes', () => {
    assert.equal(normalizeWholesalePermitNumber(' 00123456-01-002 '), '123456-1-2');
    assert.notEqual(normalizeWholesalePermitNumber('00123456-1'), normalizeWholesalePermitNumber('00123456-1-2'));
  });

  it('matches the order date and inclusive seventh day, but not the eighth day', () => {
    for (const reportDate of ['2026-08-01', '2026-08-08']) {
      const plan = planWholesaleOrderReconciliation({ orders: [order()], rows: [row({ reportDate: day(reportDate) })] });
      assert.equal(plan.matches.length, 1, reportDate);
    }
    assert.equal(planWholesaleOrderReconciliation({
      orders: [order()],
      rows: [row({ reportDate: day('2026-08-09') })],
    }).matches.length, 0);
  });

  it('requires exact store, permit, vendor, item, and quantity', () => {
    const mismatches: Array<Partial<WholesaleOrderReconciliationRow>> = [
      { agencyId: '90285' },
      { permitNumber: '123456-1-3' },
      { vendor: 'Z90399002' },
      { itemCode: '2805B' },
      { wholesaleBottlesSold: 3 },
    ];
    for (const mismatch of mismatches) {
      assert.equal(planWholesaleOrderReconciliation({ orders: [order()], rows: [row(mismatch)] }).matches.length, 0);
    }
  });

  it('requires the complete product set for captured vendors and ignores unrelated vendors', () => {
    const twoLine = order({ lines: [
      { itemCode: '2804B', quantityBottles: 2, vendor: 'Z90399001' },
      { itemCode: '2847B', quantityBottles: 1, vendor: 'Z90399001' },
    ] });
    assert.equal(planWholesaleOrderReconciliation({ orders: [twoLine], rows: [row()] }).matches.length, 0);
    assert.equal(planWholesaleOrderReconciliation({
      orders: [twoLine],
      rows: [row(), row({ itemCode: '2847B', wholesaleBottlesSold: 1 })],
    }).matches.length, 1);
    assert.equal(planWholesaleOrderReconciliation({
      orders: [order()],
      rows: [row(), row({ itemCode: '9999X', vendor: 'OTHER-VENDOR', wholesaleBottlesSold: 20 })],
    }).matches.length, 1);
    assert.equal(planWholesaleOrderReconciliation({
      orders: [order()],
      rows: [row(), row({ itemCode: '9999X', wholesaleBottlesSold: 20 })],
    }).matches.length, 0);
  });

  it('aggregates repeated PDF lines but rejects colliding report product identities', () => {
    const repeatedLines = order({ lines: [
      { itemCode: '2804B', quantityBottles: 1, vendor: 'Z90399001' },
      { itemCode: '2804B', quantityBottles: 1, vendor: 'Z90399001' },
    ] });
    assert.equal(planWholesaleOrderReconciliation({ orders: [repeatedLines], rows: [row()] }).matches.length, 1);
    assert.equal(planWholesaleOrderReconciliation({
      orders: [repeatedLines],
      rows: [row({ itemCode: '2804b', wholesaleBottlesSold: 1 }), row({ wholesaleBottlesSold: 1 })],
    }).matches.length, 0);
  });

  it('leaves repeated equal daily quantities ambiguous for one order', () => {
    const plan = planWholesaleOrderReconciliation({
      orders: [order()],
      rows: [row(), row({ reportDate: day('2026-08-02') })],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1']);
  });

  it('leaves multiple plausible orders ambiguous and detects different customers sharing a permit', () => {
    const duplicate = order({ id: 'order-2', organizationId: 'organization-2' });
    let plan = planWholesaleOrderReconciliation({ orders: [order(), duplicate], rows: [row()] });
    assert.equal(plan.matches.length, 0);
    assert.equal(plan.ambiguousEvidenceKeys.length, 1);

    plan = planWholesaleOrderReconciliation({
      orders: [order(), order({
        customerIdentity: 'customer-2',
        id: 'order-2',
        lines: [{ itemCode: '2847B', quantityBottles: 1, vendor: 'Z90399001' }],
      })],
      rows: [row()],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1', 'order-2']);
  });

  it('never reuses claimed evidence across tenants or on replay', () => {
    const evidence = row();
    const key = getWholesaleOrderAutomaticMatchKey(evidence);
    assert.equal(planWholesaleOrderReconciliation({
      claimedEvidenceKeys: [key],
      orders: [order({ organizationId: 'another-tenant' })],
      rows: [evidence],
    }).matches.length, 0);
  });

  it('treats a manually filed matching order as an evidence reservation', () => {
    const plan = planWholesaleOrderReconciliation({
      orders: [
        order(),
        order({ filedSource: 'MANUAL', id: 'manual-order', status: 'FILED' }),
      ],
      rows: [row()],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1']);
    assert.equal(plan.ambiguousEvidenceKeys.length, 1);
  });

  it('does not match malformed or incomplete order line snapshots', () => {
    assert.equal(planWholesaleOrderReconciliation({
      orders: [order({ lines: [] })],
      rows: [row()],
    }).matches.length, 0);
    assert.equal(planWholesaleOrderReconciliation({
      orders: [order({ lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: '' }] })],
      rows: [row()],
    }).matches.length, 0);
  });
});

describe('wholesale order reconciliation persistence adapter', () => {
  it('holds the lifecycle lock and atomically records durable match provenance', async () => {
    const updates: Array<Record<string, unknown>> = [];
    let orderRead = 0;
    const pending = {
      customerPermitNumber: '00123456-01-2',
      filedSource: null,
      id: 'order-1',
      inputSnapshot: {
        version: 1,
        a3aSignature: '',
        customerSignature: '',
        saleDate: '2026-08-01',
        customer: { address: '', city: '', dba: '', f2Permit: false, name: 'Customer', permitNumber: '00123456-01-2', phone: '', postalCode: '', state: 'OH' },
        seller: { addressLine1: '', city: '', email: '', name: 'Seller', phone: '', postalCode: '', state: 'OH', storeId: '90399' },
        lines: [{ itemCode: '2804B', itemName: 'Product', quantityBottles: 2, unitPriceCents: 1000, wholesalePrice: 10, vendor: 'Z90399001' }],
        totals: { sinTaxCents: 0, subtotalCents: 2000, totalCents: 2000 },
      },
      organizationId: 'organization-1',
      saleDate: day('2026-08-01'),
      sellerStoreNumber: '90399',
      status: 'SENT',
      wholesaleAccountId: 'customer-1',
    };
    const tx = {
      $executeRaw: async () => 1,
      ohlqAnnualSalesByWholesaleRow: {
        findMany: async () => [{
          agencyId: '90399', brand: '2804B', permitNumber: '123456-1-2',
          reportDate: day('2026-08-02'), vendor: 'Z90399001', wholesaleBottlesSold: 2,
        }],
      },
      wholesaleOrder: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          orderRead += 1;
          if (orderRead === 1) return [pending];
          if ('filedSource' in args.where) return [];
          return [];
        },
        updateMany: async (args: Record<string, unknown>) => {
          updates.push(args);
          return { count: 1 };
        },
      },
    };
    const db = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as PrismaClient;

    const result = await reconcileWholesaleOrdersAfterOhlqImport({ db });
    assert.equal(result.checkedOrders, 1);
    assert.equal(result.filedOrders, 1);
    assert.equal(result.stillOutstandingOrders, 0);
    assert.equal(updates.length, 1);
    const data = updates[0].data as Record<string, unknown>;
    const where = updates[0].where as Record<string, unknown>;
    assert.equal(data.filedSource, 'AUTO_MATCH');
    assert.equal(data.status, 'FILED');
    assert.equal((data.reconciliationEvidence as { reportDate: string }).reportDate, '2026-08-02');
    assert.equal(where.automaticMatchKey, null);
    assert.deepEqual(where.status, { in: ['PDF_GENERATED', 'SENT'] });
  });
});

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

  it('bridges exact supplier names to report vendor IDs without changing captured lines', () => {
    const captured = order({ lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'ETOHIO LLC' }] });
    assert.equal(planWholesaleOrderReconciliation({ orders: [captured], rows: [row()] }).matches.length, 0);
    const plan = planWholesaleOrderReconciliation({
      orders: [captured], rows: [row()],
      vendorAliases: [{ vendorName: ' etohio llc ', vendorId: 'Z90399001' }],
    });
    assert.equal(plan.matches.length, 1);
    assert.equal(plan.matches[0].evidence.lines[0].vendor, 'Z90399001');
    assert.equal(captured.lines[0].vendor, 'ETOHIO LLC');
  });

  it('keeps supplier, product, quantity, and complete supplier-product safeguards after bridging', () => {
    const captured = order({ lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'ETOHIO LLC' }] });
    const vendorAliases = [{ vendorName: 'ETOHIO LLC', vendorId: 'Z90399001' }];
    for (const rows of [
      [row({ vendor: 'Z90399002' })],
      [row({ itemCode: '2847B' })],
      [row({ wholesaleBottlesSold: 3 })],
      [row(), row({ itemCode: '2847B', wholesaleBottlesSold: 1 })],
    ]) {
      assert.equal(planWholesaleOrderReconciliation({ orders: [captured], rows, vendorAliases }).matches.length, 0);
    }
    assert.equal(planWholesaleOrderReconciliation({
      orders: [captured], vendorAliases,
      rows: [row(), row({ itemCode: '2847B', vendor: 'ANOTHER-SUPPLIER', wholesaleBottlesSold: 1 })],
    }).matches.length, 1);
  });

  it('leaves supplier names with multiple observed vendor IDs ambiguous', () => {
    const plan = planWholesaleOrderReconciliation({
      orders: [order({ lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'ETOHIO LLC' }] })],
      rows: [row()],
      vendorAliases: [
        { vendorName: 'ETOHIO LLC', vendorId: 'Z90399001' },
        { vendorName: 'etohio llc', vendorId: 'Z90399002' },
      ],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1']);
  });

  it('keeps ambiguous supplier mappings on manual reservations from releasing their evidence', () => {
    const plan = planWholesaleOrderReconciliation({
      orders: [
        order(),
        order({
          id: 'manual-order', filedSource: 'MANUAL', status: 'COMPLETED',
          lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'ETOHIO LLC' }],
        }),
      ],
      rows: [row()],
      vendorAliases: [
        { vendorName: 'ETOHIO LLC', vendorId: 'Z90399001' },
        { vendorName: 'ETOHIO LLC', vendorId: 'Z90399002' },
      ],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1']);
  });

  it('keeps an unresolved historical supplier name on a manual reservation from releasing evidence', () => {
    const plan = planWholesaleOrderReconciliation({
      orders: [
        order(),
        order({
          id: 'manual-order', filedSource: 'MANUAL', status: 'COMPLETED',
          lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'PREVIOUS SUPPLIER NAME' }],
        }),
      ],
      rows: [row()],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1']);
  });

  it('uses exact account permit aliases only when they still include the captured permit', () => {
    const captured = order({ customerPermitNumber: '3763541', customerPermitNumbers: ['3763541', '03763541-1'] });
    assert.equal(planWholesaleOrderReconciliation({
      orders: [captured], rows: [row({ permitNumber: '03763541-1' })],
    }).matches.length, 1);
    assert.equal(planWholesaleOrderReconciliation({
      orders: [captured], rows: [row({ permitNumber: '03763541-2' })],
    }).matches.length, 0, 'an unlinked location suffix must remain unmatched');
    assert.equal(planWholesaleOrderReconciliation({
      orders: [{ ...captured, customerPermitNumbers: ['03763541-1'] }],
      rows: [row({ permitNumber: '03763541-1' })],
    }).matches.length, 0, 'a captured permit detached from the current account cannot borrow its aliases');
  });

  it('blocks overlapping explicit permit aliases across distinct customer identities', () => {
    const plan = planWholesaleOrderReconciliation({
      orders: [
        order({ customerPermitNumber: '3763541', customerPermitNumbers: ['3763541', '03763541-1'] }),
        order({
          id: 'order-2', customerIdentity: 'customer-2', customerPermitNumber: 'OTHER-PERMIT',
          customerPermitNumbers: ['OTHER-PERMIT', '03763541-1'],
          lines: [{ itemCode: '2847B', quantityBottles: 1, vendor: 'Z90399001' }],
        }),
      ],
      rows: [row({ permitNumber: '03763541-1' })],
    });
    assert.equal(plan.matches.length, 0);
    assert.deepEqual(plan.ambiguousOrderIds, ['order-1', 'order-2']);
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

  it('treats manually filed and completed matching orders as evidence reservations', () => {
    for (const status of ['FILED', 'COMPLETED'] as const) {
      const manual = order({ filedSource: 'MANUAL', id: 'manual-order', status });
      const plan = planWholesaleOrderReconciliation({ orders: [order(), manual], rows: [row()] });
      assert.equal(plan.matches.length, 0);
      assert.deepEqual(plan.ambiguousOrderIds, ['order-1']);
      assert.equal(plan.ambiguousEvidenceKeys.length, 1);
      assert.equal(planWholesaleOrderReconciliation({ orders: [manual], rows: [row()] }).matches.length, 0);
    }
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

const snapshotOrder = (overrides: Partial<WholesaleOrderReconciliationOrder> = {}) => {
  const captured = order({
    organizationId: 'org_echo_spirits',
    lines: [{ itemCode: '2804B', quantityBottles: 2, vendor: 'ETOHIO LLC' }],
    ...overrides,
  });
  const subtotalCents = captured.lines.reduce((total, line) => total + line.quantityBottles * 1000, 0);
  return {
    ...captured,
    inputSnapshot: {
      version: 1,
      a3aSignature: '',
      customerSignature: '',
      saleDate: captured.saleDate.toISOString().slice(0, 10),
      customer: { address: '', city: '', dba: '', f2Permit: false, name: 'Customer', permitNumber: captured.customerPermitNumber, phone: '', postalCode: '', state: 'OH' },
      seller: { addressLine1: '', city: '', email: '', name: 'Seller', phone: '', postalCode: '', state: 'OH', storeId: captured.sellerStoreNumber },
      lines: captured.lines.map((line) => ({ ...line, itemName: 'Product', unitPriceCents: 1000, wholesalePrice: 10 })),
      totals: { sinTaxCents: 0, subtotalCents, totalCents: subtotalCents },
    },
    sentAt: day('2026-08-01'),
    paidAt: null as Date | null,
    wholesaleAccountId: captured.customerIdentity,
    wholesaleAccount: { licenseeId: captured.customerPermitNumber, licenseeIds: [] as { licenseeId: string }[] },
  };
};

const persistenceFixture = ({
  pending = snapshotOrder(),
  manual = [] as ReturnType<typeof snapshotOrder>[],
  rows = [row({ reportDate: day('2026-08-02') })],
  catalogItems = [{ itemCode: '2804B', vendor: 'ETOHIO LLC' }],
} = {}) => {
  const updates: Array<{ data: Record<string, unknown>; where: Record<string, unknown> }> = [];
  let locked = false;
  const tx = {
    $executeRaw: async () => { locked = true; return 1; },
    ohlqAnnualSalesByWholesaleRow: {
      findMany: async () => rows.map((value) => ({ ...value, brand: value.itemCode })),
    },
    ohlqBrandMasterItem: {
      findMany: async (args: { where: { itemCode: { in: string[] } } }) => {
        assert.deepEqual([...args.where.itemCode.in].sort(), [...new Set(rows.map((value) => value.itemCode))].sort());
        return catalogItems;
      },
    },
    wholesaleOrder: {
      findMany: async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        assert.equal(locked, true);
        if ('automaticMatchKey' in args.where) return [];
        assert.equal(args.where.organizationId, 'org_echo_spirits');
        assert.deepEqual(args.select.wholesaleAccount, { select: { licenseeId: true, licenseeIds: { select: { licenseeId: true } } } });
        return 'filedSource' in args.where ? manual : [pending];
      },
      updateMany: async (args: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient;
  return { db, pending, updates };
};

describe('wholesale order reconciliation persistence adapter', () => {
  it('bridges catalog supplier names under the lifecycle lock and records durable report provenance', async () => {
    const { db, pending, updates } = persistenceFixture();
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
    assert.equal((data.reconciliationEvidence as { lines: { vendor: string }[] }).lines[0].vendor, 'Z90399001');
    assert.equal(pending.inputSnapshot.lines[0].vendor, 'ETOHIO LLC');
    assert.equal('inputSnapshot' in data, false);
    assert.equal(where.automaticMatchKey, null);
    assert.equal(where.filedAt, null);
    assert.equal(where.organizationId, 'org_echo_spirits');
  });

  it('loads explicit account permit aliases while preserving the saved permit', async () => {
    const pending = snapshotOrder({ customerPermitNumber: '3763541' });
    pending.wholesaleAccount.licenseeIds = [{ licenseeId: '03763541-1' }];
    const { db, updates } = persistenceFixture({ pending, rows: [row({ permitNumber: '03763541-1' })] });
    const result = await reconcileWholesaleOrdersAfterOhlqImport({ db });
    assert.equal(result.filedOrders, 1);
    assert.equal((updates[0].data.reconciliationEvidence as { normalizedPermitNumber: string }).normalizedPermitNumber, '3763541-1');
    assert.equal(pending.customerPermitNumber, '3763541');
    assert.equal(pending.inputSnapshot.customer.permitNumber, '3763541');
  });

  it('fails closed when catalog-linked report items identify multiple IDs for a supplier name', async () => {
    const { db, updates } = persistenceFixture({
      rows: [row(), row({ itemCode: '2847B', vendor: 'Z90399002' })],
      catalogItems: [{ itemCode: '2804B', vendor: 'ETOHIO LLC' }, { itemCode: '2847B', vendor: 'ETOHIO LLC' }],
    });
    const result = await reconcileWholesaleOrdersAfterOhlqImport({ db });
    assert.equal(result.filedOrders, 0);
    assert.deepEqual(result.ambiguousOrderIds, ['order-1']);
    assert.equal((updates[0].data.reconciliationEvidence as { reviewRequired: boolean }).reviewRequired, true);
    assert.equal('filedAt' in updates[0].data, false);
  });

  it('does not try to file a manually completed reservation that matches independently of pending orders', async () => {
    const manual = snapshotOrder({ id: 'manual-order', status: 'COMPLETED', filedSource: 'MANUAL' });
    const pending = snapshotOrder({ lines: [{ itemCode: '2847B', quantityBottles: 1, vendor: 'ETOHIO LLC' }] });
    const { db, updates } = persistenceFixture({ pending, manual: [manual] });
    const result = await reconcileWholesaleOrdersAfterOhlqImport({ db });
    assert.equal(result.checkedOrders, 1);
    assert.equal(result.filedOrders, 0);
    assert.equal(result.matches.length, 0);
    assert.deepEqual(updates.map((value) => value.where.id), ['order-1']);
    assert.equal(manual.status, 'COMPLETED');
    assert.equal(manual.filedSource, 'MANUAL');
  });
});

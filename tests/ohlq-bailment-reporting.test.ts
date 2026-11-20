import assert from 'node:assert/strict';
import test from 'node:test';
import type { OhlqBailmentReportingSnapshot, Prisma, PrismaClient } from '@prisma/client';
import {
  BAILMENT_REPORTING_REPORT_ID, BAILMENT_REPORTING_WRITE_BATCH,
  BailmentReportingError, publishBailmentReportingSnapshot, type BailmentReportingInput,
} from '../lib/ohlqBailmentReporting';
import { BAILMENT_REPORTING_HEADERS } from '../lib/ohlqBailmentReportingParser';
import { formatDateInputValue } from '../lib/dateTime';

type Snapshot = OhlqBailmentReportingSnapshot;
type Line = Prisma.OhlqBailmentReportingLineCreateManyInput;
type State = { snapshots: Snapshot[]; lines: Line[]; nextId: number };
type Where = {
  organizationId?: string; snapshotId?: string;
  id?: { notIn: string[] };
};
const compare = (a: Snapshot, b: Snapshot) => b.requestedAt.getTime() - a.requestedAt.getTime()
  || (a.requestId < b.requestId ? 1 : a.requestId > b.requestId ? -1 : 0);

function database() {
  let state: State = { snapshots: [], lines: [], nextId: 1 };
  let queue = Promise.resolve();
  let failBatch = 0;
  let calls = 0;
  const unavailable = new Set<string>();
  const settings = new Map<string, { historyStart: string; timezone: string }>();
  const db = {
    $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const copy = structuredClone(state);
      const matching = (where: Where) => copy.snapshots.filter(s => s.organizationId === where.organizationId);
      const tx = {
        $executeRaw: async () => 1,
        organization: {
          findFirst: async ({ where }: { where: { id: string; active: boolean; accountStatus: { notIn: string[] }; enabledStates: { has: string } } }) => {
            assert.equal(where.active, true);
            assert.deepEqual(where.accountStatus.notIn, ['SUSPENDED', 'CANCELLED']);
            assert.equal(where.enabledStates.has, 'OH');
            if (unavailable.has(where.id)) return null;
            const config = settings.get(where.id) ?? { historyStart: '2019-01-01', timezone: 'America/New_York' };
            return { id: where.id, timezone: config.timezone, settings: { productionForecasting: { ohio: { historyStart: config.historyStart } } } };
          },
        },
        ohlqBailmentReportingSnapshot: {
          findFirst: async ({ where }: { where: Where }) => matching(where).sort(compare)[0] ?? null,
          findUnique: async ({ where }: { where: Record<string, Record<string, string>> }) => {
            const key = Object.values(where)[0];
            return copy.snapshots.find(s => Object.entries(key).every(([name, value]) => (s as unknown as Record<string, unknown>)[name] === value)) ?? null;
          },
          findMany: async ({ where }: { where: Where }) => matching(where).sort(compare),
          create: async ({ data }: { data: Omit<Snapshot, 'id' | 'createdAt'> }) => {
            const row = { ...data, id: `snapshot-${copy.nextId++}`, createdAt: new Date() };
            copy.snapshots.push(row); return row;
          },
          update: async ({ where, data }: { where: { organizationId_id: { organizationId: string; id: string } }; data: Partial<Snapshot> }) => {
            const row = copy.snapshots.find(s => s.organizationId === where.organizationId_id.organizationId && s.id === where.organizationId_id.id)!;
            Object.assign(row, data); return row;
          },
          deleteMany: async ({ where }: { where: Where }) => {
            const removed = copy.snapshots.filter(s => s.organizationId === where.organizationId && !where.id!.notIn.includes(s.id));
            const ids = new Set(removed.map(s => s.id));
            copy.snapshots = copy.snapshots.filter(s => !ids.has(s.id));
            copy.lines = copy.lines.filter(l => !ids.has(l.snapshotId));
            return { count: removed.length };
          },
        },
        ohlqBailmentReportingLine: {
          createMany: async ({ data }: { data: Line[] }) => {
            calls++;
            if (calls === failBatch) throw Error('PRIVATE_DATABASE_AND_SOURCE_VALUES');
            copy.lines.push(...data); return { count: data.length };
          },
          count: async ({ where }: { where: Where }) => copy.lines.filter(l => l.organizationId === where.organizationId && l.snapshotId === where.snapshotId).length,
        },
      } as unknown as Prisma.TransactionClient;
      try {
        const result = await work(tx);
        state = copy;
        return result;
      } finally { release(); }
    },
  } as unknown as PrismaClient;
  return {
    db,
    state: () => structuredClone(state),
    failNextSecondBatch: () => { failBatch = calls + 2; },
    unavailable,
    settings,
    corruptCurrentCount: () => { state.lines.pop(); },
  };
}

type Fields = Partial<Record<typeof BAILMENT_REPORTING_HEADERS[number], string>>;
const row = (changes: Fields = {}): string[] => {
  const fields: Fields = {
    Vendor_Name: 'Echo', Broker_Name: 'Broker', Invoice_Date: '11/17/2026', Invoice_Number: '0001a',
    PO_Create_Date: '11/16/2026', PO_Number: 'PO0001', Agency: '00123', UPC_Code: '00001001',
    Brand: '3150B', Name: 'Excluded item', Category: 'Rum', Cases: '2', Odd_Bottles: '0',
    Cases_Bottles: 'C6', Quoted_Case_Price: '$50.05', Discount: '$0.00', Total: '$100.10',
    ...changes,
  };
  return BAILMENT_REPORTING_HEADERS.map(key => fields[key] ?? '');
};
const csv = (rows = [row()]) => Buffer.from(`${BAILMENT_REPORTING_HEADERS.join(',')}\r\n${rows.map(cells => cells.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')}\r\n\r\n`);
function input(requestId: string, csvBuffer = csv(), minute = 0, organizationId = 'org-a'): BailmentReportingInput {
  const requestedAt = new Date(Date.UTC(2026, 10, 18, 15, minute));
  return {
    organizationId, requestId, csvBuffer, requestedAt, acquiredAt: new Date(requestedAt.getTime() + 500),
    requestedFrom: '2019-01-01', requestedTo: formatDateInputValue(requestedAt, 'America/New_York'),
    timezone: 'America/New_York', reportIdentity: BAILMENT_REPORTING_REPORT_ID,
    parameterScope: { parameter: 'Brand', values: 'all' }, exportCompleted: true, expectedSizeBytes: csvBuffer.length,
  };
}
const errorCode = (code: string) => (error: unknown) => error instanceof BailmentReportingError && error.code === code;

test('publishes all native line values, repeated invoice numbers and signed corrections without forecasting filters', async () => {
  const f = database();
  const source = csv([row(), row(), row({ Cases: '-0.5', Odd_Bottles: '', Discount: '-$0.01', Total: '-$25.035', Date_Paid: '11/18/2026' })]);
  const result = await publishBailmentReportingSnapshot(input('first', source), f.db);
  assert.equal(result.published, true);
  assert.equal(result.rowCount, 3);
  const state = f.state();
  assert.deepEqual(state.lines.map(l => l.sourceLineNumber), [1, 2, 3]);
  assert.equal(state.lines[0].invoiceNumber, '0001a');
  assert.equal(state.lines[0].agency, '00123');
  assert.equal(state.lines[0].upcCode, '00001001');
  assert.equal(state.lines[0].brand, '3150B');
  assert.equal(state.lines[0].total, '100.10');
  assert.equal(state.lines[0].datePaid, null);
  assert.equal(state.lines[2].cases, '-0.5');
  assert.equal(state.lines[2].oddBottles, null);
  assert.equal(state.lines[2].discount, '-0.01');
  assert.equal(state.lines[2].total, '-25.035');
  assert.deepEqual(state.lines[2].sourceValues, row({ Cases: '-0.5', Odd_Bottles: '', Discount: '-$0.01', Total: '-$25.035', Date_Paid: '11/18/2026' }));
});

test('payment-only and monetary-only revisions become the current successful report', async () => {
  const f = database();
  const first = await publishBailmentReportingSnapshot(input('first'), f.db);
  const paid = await publishBailmentReportingSnapshot(input('paid', csv([row({ Date_Paid: '11/18/2026' })]), 1), f.db);
  assert.notEqual(paid.contentHash, first.contentHash);
  assert.equal(paid.published, true);
  const revised = await publishBailmentReportingSnapshot(input('amount', csv([row({ Total: '$99.99', Discount: '$0.11', Date_Paid: '11/18/2026' })]), 2), f.db);
  assert.notEqual(revised.contentHash, paid.contentHash);
  assert.equal(f.state().snapshots.length, 2);
  assert.equal(f.state().lines.find(l => l.snapshotId === revised.snapshotId)?.total, '99.99');
});

test('a fresh identical download advances provenance while preserving previous distinct content', async () => {
  const f = database();
  const first = await publishBailmentReportingSnapshot(input('first'), f.db);
  const changed = csv([row({ Total: '$110.00' })]);
  const second = await publishBailmentReportingSnapshot(input('second', changed, 1), f.db);
  const refreshInput = input('tomorrow', changed, 1440);
  const refresh = await publishBailmentReportingSnapshot(refreshInput, f.db);
  assert.equal(refresh.unchanged, true);
  assert.equal(refresh.snapshotId, second.snapshotId);
  assert.equal(f.state().snapshots.length, 2);
  assert.equal(f.state().lines.length, 2);
  assert.ok(f.state().snapshots.some(s => s.id === first.snapshotId));
  const current = f.state().snapshots.find(s => s.id === second.snapshotId)!;
  assert.equal(current.acquiredAt.toISOString(), refreshInput.acquiredAt.toISOString());
  assert.equal(current.requestedTo.toISOString().slice(0, 10), '2026-11-19');
});

test('identical request replay is idempotent and reused request identity with changed input is rejected', async () => {
  const f = database();
  const request = input('one');
  await publishBailmentReportingSnapshot(request, f.db);
  const replay = await publishBailmentReportingSnapshot(request, f.db);
  assert.equal(replay.replay, true);
  assert.equal(replay.published, false);
  assert.equal(f.state().snapshots.length, 1);
  const different = input('one', csv([row({ Total: '$0.01' })]));
  await assert.rejects(publishBailmentReportingSnapshot(different, f.db), errorCode('request-conflict'));
  assert.equal(f.state().lines[0].total, '100.10');
});

test('late older completion and a pruned older retry cannot replace newer reporting data', async () => {
  const f = database();
  const old = input('old', csv([row({ Total: '$1' })]), 0);
  await publishBailmentReportingSnapshot(old, f.db);
  await publishBailmentReportingSnapshot(input('middle', csv([row({ Total: '$2' })]), 1), f.db);
  const newest = await publishBailmentReportingSnapshot(input('newest', csv([row({ Total: '$3' })]), 2), f.db);
  const before = f.state();
  assert.equal(before.snapshots.length, 2);
  const late = await publishBailmentReportingSnapshot(old, f.db);
  assert.equal(late.superseded, true);
  assert.equal(late.snapshotId, newest.snapshotId);
  assert.deepEqual(f.state(), before);
});

test('same-time request ordering uses the C-collated request identifier consistently', async () => {
  const f = database();
  await publishBailmentReportingSnapshot(input('a', csv([row({ Total: '$2' })])), f.db);
  const late = await publishBailmentReportingSnapshot(input('Z', csv([row({ Total: '$1' })])), f.db);
  assert.equal(late.superseded, true);
  assert.equal(f.state().snapshots[0].requestId, 'a');
});

test('a mid-publication database failure rolls back both new rows and current metadata', async () => {
  const f = database();
  await publishBailmentReportingSnapshot(input('good'), f.db);
  const before = f.state();
  f.failNextSecondBatch();
  const manyRows = Array.from({ length: BAILMENT_REPORTING_WRITE_BATCH + 1 }, (_, i) => row({ Invoice_Number: `line-${i}` }));
  await assert.rejects(publishBailmentReportingSnapshot(input('broken', csv(manyRows), 1), f.db), error => {
    assert.ok(error instanceof BailmentReportingError);
    assert.equal(error.code, 'persistence');
    assert.doesNotMatch(error.message, /PRIVATE|line-/);
    return true;
  });
  assert.deepEqual(f.state(), before);
});

test('invalid and detectably truncated sources preserve the last successful report', async () => {
  const f = database();
  await publishBailmentReportingSnapshot(input('good'), f.db);
  const before = f.state();
  for (const bad of [Buffer.from(''), Buffer.from('<html>PRIVATE_LOGIN</html>'), Buffer.from(`${BAILMENT_REPORTING_HEADERS.join(',')}\n"unfinished`)]) {
    await assert.rejects(publishBailmentReportingSnapshot(input('bad', bad, 1), f.db), error => {
      assert.ok(error instanceof BailmentReportingError);
      assert.doesNotMatch(error.message, /PRIVATE_LOGIN|unfinished/);
      return true;
    });
    assert.deepEqual(f.state(), before);
  }
});

test('broad unexplained historical loss is quarantined while ordinary same-month correction remains possible', async () => {
  const f = database();
  const original = csv(Array.from({ length: 20 }, (_, i) => row({ Invoice_Date: i < 10 ? '1/1/2019' : '2/1/2020' })));
  await publishBailmentReportingSnapshot(input('history', original), f.db);
  const before = f.state();
  await assert.rejects(publishBailmentReportingSnapshot(input('lost-history', csv([row({ Invoice_Date: '2/1/2020' })]), 1), f.db), errorCode('incomplete-export'));
  assert.deepEqual(f.state(), before);
  const sameMonth = database();
  await publishBailmentReportingSnapshot(input('first', csv(Array.from({ length: 20 }, () => row()))), sameMonth.db);
  await publishBailmentReportingSnapshot(input('corrected', csv([row()]), 1), sameMonth.db);
  assert.equal(sameMonth.state().snapshots.length, 2);
});

test('source identity, completed export, byte size and actual native date scope are required', async () => {
  const f = database();
  const base = input('provenance');
  for (const override of [
    { reportIdentity: 'other-report' }, { exportCompleted: false },
    { expectedSizeBytes: base.csvBuffer.length - 1 }, { requestedTo: '2026-11-17' },
    { requestedFrom: '2020-01-01' }, { acquiredAt: new Date(base.requestedAt.getTime() - 1) },
    { parameterScope: { parameter: 'Brand', values: ['3150B'] } },
    { timezone: 'UTC' },
  ]) {
    await assert.rejects(publishBailmentReportingSnapshot({ ...base, ...override } as BailmentReportingInput, f.db), errorCode('invalid-provenance'));
  }
  assert.equal(f.state().snapshots.length, 0);
});

test('shared hashes and request IDs never combine or prune data across organizations', async () => {
  const f = database();
  await publishBailmentReportingSnapshot(input('same', csv(), 0, 'org-a'), f.db);
  const other = await publishBailmentReportingSnapshot(input('same', csv(), 0, 'org-b'), f.db);
  await publishBailmentReportingSnapshot(input('second', csv([row({ Total: '$2' })]), 1, 'org-a'), f.db);
  await publishBailmentReportingSnapshot(input('third', csv([row({ Total: '$3' })]), 2, 'org-a'), f.db);
  assert.equal(f.state().snapshots.length, 3);
  assert.equal(f.state().lines.find(l => l.snapshotId === other.snapshotId)?.organizationId, 'org-b');
  assert.equal(f.state().lines.find(l => l.snapshotId === other.snapshotId)?.total, '100.10');
  f.unavailable.add('org-b');
  await assert.rejects(publishBailmentReportingSnapshot(input('denied', csv(), 3, 'org-b'), f.db), errorCode('organization-unavailable'));
});

test('an incomplete retained row set cannot receive a false successful freshness update', async () => {
  const f = database();
  await publishBailmentReportingSnapshot(input('first'), f.db);
  f.corruptCurrentCount();
  const before = f.state();
  await assert.rejects(publishBailmentReportingSnapshot(input('refresh', csv(), 1), f.db), errorCode('persistence'));
  assert.deepEqual(f.state(), before);
});

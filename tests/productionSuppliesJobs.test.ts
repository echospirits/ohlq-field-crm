import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { runSupplyJobs } from '../lib/productionSupplies/jobs';
import { refreshSupplyShipmentTracking } from '../lib/productionSupplies/tracking';
import { syncSupplyMailbox } from '../lib/productionSupplies/mail';

const mailboxResult = (patch: { processed?: number; continuation?: boolean; backfillIncomplete?: boolean } = {}) => ({ processed: 0, continuation: false, backfillIncomplete: false, processedMessages: 0, ignoredInlineImages: 0, catchupPhase: 'INCREMENTAL' as const, ...patch });

function queueFake() {
  const mailboxes = [{ organizationId: 'org-one', userId: 'joe', next: 1 }, { organizationId: 'org-one', userId: 'karl', next: 2 }, { organizationId: 'org-one', userId: 'nikhil', next: 3 }];
  const order = { ignored: false, supplier: 'Fixture supplier', lines: [{ description: 'Fixture material', ignored: false, allocations: [{ needId: 'need-watched' }] }] };
  const shipments = [{ id: 'shipment-one', organizationId: 'org-one', next: 1, order }, { id: 'shipment-two', organizationId: 'org-two', next: 2, order }, { id: 'shipment-three', organizationId: 'org-one', next: 3, order }];
  const selections: Array<{ kind: string; args: Record<string, unknown> }> = [];
  const db = {
    organization: { findMany: async () => [{ id: 'org-one' }, { id: 'org-two' }] },
    supplyAudit: { findMany: async () => [] },
    supplyMailboxSync: { findMany: async (args: Record<string, unknown>) => { selections.push({ kind: 'mail', args }); return [...mailboxes].sort((a, b) => a.next - b.next).slice(0, Number(args.take)); } },
    supplyShipment: { findMany: async (args: Record<string, unknown>) => { selections.push({ kind: 'tracking', args }); return [...shipments].sort((a, b) => a.next - b.next).slice(0, Number(args.take)); } },
  };
  const watchScope = async (organizationId: string) => ({ materials: [{ key: 'watched', material: 'Watched raisins', location: 'Location unknown', unit: 'lb', catalogItemId: 'dx5-alerted-material', aliases: [], vendorRefs: [], needIds: ['need-watched'], latestWarningAt: new Date(), sharedUse: false }] as Awaited<ReturnType<typeof import('../lib/productionSupplies/watch').getWatchedSupplyOrderScope>>['materials'], orderWhere: { organizationId, lines: { some: { catalogItemId: 'dx5-alerted-material' } } } });
  return { db: db as unknown as PrismaClient, mailboxes, shipments, selections, watchScope };
}

test('global due scheduling bounds work and advances fairly between Production people and tenants', async () => {
  const fake = queueFake(), mailRuns: string[] = [], trackingRuns: string[] = [];
  const services = {
    watchScope: fake.watchScope,
    reconcile: async () => ['unused-membership-array'],
    mailbox: (async (_org, user, _db, options) => { assert.equal(options?.budgetMs, 120_000); mailRuns.push(user); fake.mailboxes.find(item => item.userId === user)!.next += 10; return mailboxResult({ processed: 1 }); }) as typeof syncSupplyMailbox,
    tracking: (async (_org, shipment, _db, options) => { assert.equal(options?.timeoutMs, 8000); assert.equal(options?.maxAttempts, 2); trackingRuns.push(shipment); fake.shipments.find(item => item.id === shipment)!.next += 10; return { status: 'updated' }; }) as typeof refreshSupplyShipmentTracking,
  };
  const first = await runSupplyJobs(fake.db, services);
  assert.deepEqual(mailRuns, ['joe', 'karl']);
  assert.deepEqual(trackingRuns, ['shipment-one', 'shipment-two']);
  assert.equal(first.mailboxChecks, 2);
  assert.equal(first.tracking.length, 2);
  await runSupplyJobs(fake.db, services);
  assert.equal(mailRuns[2], 'nikhil');
  assert.equal(trackingRuns[2], 'shipment-three');
  assert.deepEqual(fake.selections[0].args.orderBy, [{ nextCheckAt: 'asc' }, { id: 'asc' }]);
  assert.deepEqual(fake.selections[1].args.orderBy, [{ nextSyncAt: 'asc' }, { id: 'asc' }]);
  assert.equal((fake.selections[1].args.where as { organizationId: { in: string[] } }).organizationId.in.length, 2);
});

test('tracking and both mailbox lanes start concurrently; one provider failure does not stop other work', async () => {
  const fake = queueFake(), started: string[] = [];
  let release!: () => void, allStarted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const startedGate = new Promise<void>(resolve => { allStarted = resolve; });
  const mark = (value: string) => { started.push(value); if (started.length >= 3) allStarted(); };
  const running = runSupplyJobs(fake.db, {
    watchScope: fake.watchScope,
    reconcile: async () => [],
    mailbox: (async (_org, user) => { mark(user); await gate; if (user === 'joe') throw new Error('one mailbox disconnected'); return mailboxResult({ processed: 1 }); }) as typeof syncSupplyMailbox,
    tracking: (async (_org, shipment) => { mark(shipment); await gate; return { status: 'updated' }; }) as typeof refreshSupplyShipmentTracking,
  });
  await startedGate;
  assert.equal(started[0], 'shipment-one');
  assert.ok(started.includes('joe') && started.includes('karl'));
  release();
  const result = await running;
  assert.equal(result.mailboxErrors, 1);
  assert.equal(result.mailboxChecks, 1);
  assert.equal(result.tracking.length, 2);
});

test('slow reconciliation defers metadata work and leaves queue selection bounded', async () => {
  const fake = queueFake();
  let elapsed = 0, reconciled = 0;
  const result = await runSupplyJobs(fake.db, {
    watchScope: fake.watchScope,
    clock: () => elapsed,
    reconcile: async () => { reconciled++; elapsed = 30_000; return []; },
    mailbox: (async () => mailboxResult()) as typeof syncSupplyMailbox,
    tracking: (async () => ({ status: 'updated' })) as typeof refreshSupplyShipmentTracking,
  });
  assert.equal(reconciled, 1);
  assert.equal(result.deferred, true);
  assert.ok(fake.selections.every(selection => selection.args.take === (selection.kind === 'tracking' ? 20 : 2)));
});

test('no Dx5 watch leaves mailbox warning discovery active and never dispatches shipment tracking', async () => {
  const fake = queueFake();
  let mailboxChecks = 0;
  const result = await runSupplyJobs(fake.db, {
    reconcile: async () => [], watchScope: async organizationId => ({ materials: [], orderWhere: { organizationId } }),
    mailbox: (async () => { mailboxChecks++; return mailboxResult(); }) as typeof syncSupplyMailbox,
    tracking: (async () => { assert.fail('an unwatched shipment cannot reach a provider registration'); }) as typeof refreshSupplyShipmentTracking,
  });
  assert.equal(mailboxChecks, 2);
  assert.equal(result.tracking.length, 0);
  assert.equal(fake.selections.some(selection => selection.kind === 'tracking'), false);
});

test('tracking due queue constrains each candidate to tenant-scoped watched orders', async () => {
  const fake = queueFake();
  await runSupplyJobs(fake.db, {
    reconcile: async () => [], watchScope: fake.watchScope,
    mailbox: (async () => mailboxResult()) as typeof syncSupplyMailbox,
    tracking: (async () => ({ status: 'out_of_scope' })) as typeof refreshSupplyShipmentTracking,
  });
  const selection = fake.selections.find(item => item.kind === 'tracking')!;
  assert.deepEqual((selection.args.where as { order: unknown }).order, { OR: [
    { organizationId: 'org-one', lines: { some: { catalogItemId: 'dx5-alerted-material' } } },
    { organizationId: 'org-two', lines: { some: { catalogItemId: 'dx5-alerted-material' } } },
  ] });
});

test('exact scope filtering skips an older unrelated candidate without consuming either tracking slot', async () => {
  const fake = queueFake();
  fake.shipments[0].order = { ignored: false, supplier: 'Fixture supplier', lines: [{ description: 'Unrelated item', ignored: false, allocations: [] }] };
  const attempted: string[] = [];
  await runSupplyJobs(fake.db, {
    reconcile: async () => [], watchScope: fake.watchScope,
    mailbox: (async () => mailboxResult()) as typeof syncSupplyMailbox,
    tracking: (async (_org, shipment) => { attempted.push(shipment); return { status: 'updated' }; }) as typeof refreshSupplyShipmentTracking,
  });
  assert.deepEqual(attempted, ['shipment-two', 'shipment-three']);
});

test('one tenant watch-query failure does not stop other tenants or warning mailbox discovery', async () => {
  const fake = queueFake();
  const attempted: string[] = [];
  let mailboxes = 0;
  const result = await runSupplyJobs(fake.db, {
    reconcile: async () => [], watchScope: async organizationId => { if (organizationId === 'org-one') throw new Error('temporary metadata error'); return fake.watchScope(organizationId); },
    mailbox: (async () => { mailboxes++; return mailboxResult(); }) as typeof syncSupplyMailbox,
    tracking: (async (_org, shipment) => { attempted.push(shipment); return { status: 'updated' }; }) as typeof refreshSupplyShipmentTracking,
  });
  assert.deepEqual(attempted, ['shipment-two']);
  assert.equal(mailboxes, 2);
  assert.equal(result.deferred, true);
});

test('recurring jobs resume bounded retained-evidence replay for watched tenants independently of mailbox availability', async () => {
  const fake = queueFake(), replayed: string[] = [];
  const result = await runSupplyJobs(fake.db, {
    reconcile: async () => [], watchScope: fake.watchScope,
    mailbox: (async () => mailboxResult()) as typeof syncSupplyMailbox,
    tracking: (async () => ({ status: 'updated' })) as typeof refreshSupplyShipmentTracking,
    replay: async (organizationId, _db, options) => { replayed.push(organizationId); assert.equal(options?.maxSources, 20); assert.equal(options?.budgetMs, 8000); assert.ok(options?.materials?.length); return { attempted: 20, linked: 0, errors: 0, deferred: true }; },
  });
  assert.deepEqual(replayed, ['org-one', 'org-two']);
  assert.equal(result.evidenceReplays, 2);
  assert.equal(result.deferred, true);
});

test('one incomplete mailbox propagates its continuation even when it is the only due person', async () => {
  const fake = queueFake(); fake.mailboxes.splice(1);
  const result = await runSupplyJobs(fake.db, {
    reconcile: async () => [], watchScope: async organizationId => ({ materials: [], orderWhere: { organizationId } }),
    mailbox: (async () => mailboxResult({ processed: 1, continuation: true, backfillIncomplete: true })) as typeof syncSupplyMailbox,
  });
  assert.equal(result.mailboxChecks, 1);
  assert.equal(result.continuation, true);
  assert.equal(result.backfillIncomplete, true);
});

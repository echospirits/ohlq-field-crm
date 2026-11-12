import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { replayWatchedSupplyEvidence, supplyWatchSignature } from '../lib/productionSupplies/replay';
import type { WatchedSupplyMaterial } from '../lib/productionSupplies/statusDomain';
import { ingestEvidence } from '../lib/productionSupplies/service';
import { scopeSupplyEvidence } from '../lib/productionSupplies/watch';

const at = new Date('2026-11-12T12:00:00Z');
const evidence = (kind: 'ORDER' | 'SHIPMENT') => ({ kind, supplier: 'Fixture supplier', orderReference: 'ORDER-42', lines: [{ description: 'Raisins', quantity: 2, unit: 'lb' }, { description: 'Unrelated bar supplies', quantity: 1, unit: 'case' }], shipments: [] });
function replayFake() {
  const teamId = 'd635139e-d9a6-49d0-83ee-c302ea29ce37';
  const preferences = { productionSupplies: { productionTeamId: teamId }, accountConfiguration: { version: 1, territories: [], fields: [], categories: [], teams: [{ id: teamId, name: 'Production', memberIds: ['owner-one'] }] } };
  const sources = ['SHIPMENT', 'ORDER'].map((kind, index) => ({ id: `source-${index}`, organizationId: 'tenant-one', userId: 'owner-one', mailboxConnectionId: 'connection-one' as string | null, provider: 'GOOGLE', messageId: `message-${index}`, attachmentKey: '', messageDate: at, contentHash: `hash-${index}`, filename: null, mimeType: null, subject: 'Sanitized fixture', historical: true, extractedFacts: evidence(kind as 'ORDER' | 'SHIPMENT') }));
  const materials: WatchedSupplyMaterial[] = [{ key: 'material-one', material: 'Raisins', location: 'Fixture facility', unit: 'lb', catalogItemId: null, aliases: [], vendorRefs: [], needIds: ['need-one'], latestWarningAt: at, sharedUse: false }];
  const connection = { id: 'connection-one', organizationId: 'tenant-one', userId: 'owner-one', provider: 'GOOGLE', enabled: true, scope: 'https://www.googleapis.com/auth/gmail.readonly', accessTokenEncrypted: 'supply-v1.sanitized' };
  let active = true, role = 'USER';
  const queries: Array<Record<string, unknown>> = [];
  const checkpoints: Array<{ detail: unknown }> = [];
  const db = {
    organization: { findFirst: async () => ({ crmPreferences: preferences }) },
    user: { findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => active && where.id === 'owner-one' && where.organizationId === 'tenant-one' ? { id: 'owner-one', role } : null },
    mailboxConnection: { findFirst: async ({ where }: { where: { organizationId: string; userId: string; id: string } }) => connection.enabled && where.id === connection.id && where.userId === connection.userId && where.organizationId === connection.organizationId ? connection : null },
    supplyAudit: { findFirst: async () => checkpoints.at(-1) ?? null, create: async ({ data }: { data: { detail: unknown } }) => { checkpoints.push(structuredClone(data)); return data; } },
    supplySource: { findMany: async (args: Record<string, unknown>) => { queries.push(args); const where = args.where as { organizationId: string; extractedFacts: { equals: string }; OR?: Array<{ messageDate: { lt: Date } } | { messageDate: Date; id: { gt: string } }> }; const after = where.OR?.[1] as { messageDate: Date; id: { gt: string } } | undefined; return sources.filter(source => source.organizationId === where.organizationId && source.extractedFacts.kind === where.extractedFacts.equals && (!after || source.messageDate < after.messageDate || source.messageDate.getTime() === after.messageDate.getTime() && source.id > after.id.gt)).sort((a,b)=>b.messageDate.getTime()-a.messageDate.getTime() || a.id.localeCompare(b.id)).slice(0, Number(args.take)); } },
  };
  const scope = (async (_org, facts) => ({ evidence: facts, materialKeys: ['material-one'], reason: 'Fixture watched material' })) as typeof scopeSupplyEvidence;
  return { db: db as unknown as PrismaClient, preferences, sources, connection, queries, scope, materials, checkpoints, deactivate: () => { active = false; }, admin: () => { role = 'ADMIN'; } };
}

test('newest-first retained shipping notices replay after order evidence without refetching mail or recursive scans', async () => {
  const fake = replayFake(), linked = new Set<string>(), order: string[] = [];
  const ingest = async (actor: { organizationId: string; userId: string }, input: unknown, _db: PrismaClient, options: { reconcile: false }) => {
    assert.deepEqual(actor, { organizationId: 'tenant-one', userId: 'owner-one' });
    assert.equal(options.reconcile, false);
    const facts = (input as { evidence: ReturnType<typeof evidence> }).evidence;
    order.push(facts.kind);
    assert.equal(facts.lines.length, 2, 'original validated facts reach ingestion for safe scoped filtering');
    if (facts.kind === 'SHIPMENT') assert.ok(linked.has('ORDER'));
    linked.add(facts.kind);
    return { orderId: 'order-one' };
  };
  const first = await replayWatchedSupplyEvidence('tenant-one', fake.db, ingest, { scope: fake.scope, materials: fake.materials });
  await replayWatchedSupplyEvidence('tenant-one', fake.db, ingest, { scope: fake.scope, materials: fake.materials, force: true });
  assert.deepEqual(order, ['ORDER', 'SHIPMENT', 'ORDER', 'SHIPMENT']);
  assert.equal(first.linked, 2);
  assert.equal(linked.size, 2);
  assert.ok(fake.queries.every(query => Number(query.take) <= 20 && (query.where as { organizationId: string }).organizationId === 'tenant-one'));
});

test('retained mailbox replay rechecks original owner membership, activity, read scope and exact connection ownership', async () => {
  for (const change of [
    (fake: ReturnType<typeof replayFake>) => { fake.deactivate(); },
    (fake: ReturnType<typeof replayFake>) => { fake.preferences.accountConfiguration.teams[0].memberIds = []; },
    (fake: ReturnType<typeof replayFake>) => { fake.connection.enabled = false; },
    (fake: ReturnType<typeof replayFake>) => { fake.connection.userId = 'different-owner'; },
    (fake: ReturnType<typeof replayFake>) => { fake.connection.organizationId = 'different-tenant'; },
    (fake: ReturnType<typeof replayFake>) => { fake.connection.scope = 'https://www.googleapis.com/auth/calendar'; },
    (fake: ReturnType<typeof replayFake>) => { fake.connection.accessTokenEncrypted = 'retired-token-format'; },
  ]) {
    const fake = replayFake(); change(fake);
    const result = await replayWatchedSupplyEvidence('tenant-one', fake.db, async () => { assert.fail('revoked/foreign mailbox evidence cannot be republished'); }, { scope: fake.scope, materials: fake.materials });
    assert.equal(result.attempted, 0);
  }
});

test('manager bootstrap evidence can replay while non-manager manual evidence remains blocked', async () => {
  const fake = replayFake();
  fake.sources.forEach(source => { source.mailboxConnectionId = null; });
  assert.equal((await replayWatchedSupplyEvidence('tenant-one', fake.db, async () => { assert.fail('manual source needs a manager'); }, { scope: fake.scope, materials: fake.materials })).attempted, 0);
  fake.admin();
  assert.equal((await replayWatchedSupplyEvidence('tenant-one', fake.db, async () => ({ orderId: 'order-one' }), { scope: fake.scope, materials: fake.materials, force: true })).linked, 2);
});

test('one malformed retained source does not block the next source and replay obeys its initiation deadline', async () => {
  const fake = replayFake();
  let elapsed = 0;
  const result = await replayWatchedSupplyEvidence('tenant-one', fake.db, async (_actor, input) => { if ((input as { evidence: { kind: string } }).evidence.kind === 'ORDER') throw new Error('bad retained source'); return { orderId: 'order-one' }; }, { scope: fake.scope, materials: fake.materials });
  assert.equal(result.errors, 1);
  assert.equal(result.linked, 1);
  const bounded = await replayWatchedSupplyEvidence('tenant-one', fake.db, async () => { elapsed = 20_000; return { orderId: 'order-one' }; }, { scope: fake.scope, materials: fake.materials, now: () => at.getTime() + elapsed, force: true });
  assert.equal(bounded.attempted, 1);
  assert.equal(bounded.deferred, true);
});

test('unwatched source is retained idempotently without creating any operational order or shipment', async () => {
  const retained: Array<Record<string, unknown>> = [];
  const db = {
    organization: { findFirst: async () => ({ id: 'tenant-one', crmPreferences: {} }) },
    user: { findFirst: async () => ({ id: 'manager-one', role: 'ADMIN' }) },
    organizationFeature: { findFirst: async () => ({ id: 'enabled' }) },
    supplyNeed: { findMany: async () => [] }, supplyCatalogItem: { findMany: async () => [] },
    $executeRaw: async () => 1,
    supplySource: {
      findFirst: async () => retained[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const source = { id: 'source-one', ...data }; retained.push(source); return source; },
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(retained[0], data); return retained[0]; },
    },
  };
  const client = { ...db, $transaction: async (action: (tx: typeof db) => Promise<unknown>) => action(db) } as unknown as PrismaClient;
  const input = { source: { provider: 'MANUAL', messageId: 'unwatched-fixture', messageDate: at.toISOString(), contentHash: 'fixture-hash', extractionStatus: 'COMPLETE' }, evidence: evidence('ORDER') };
  const result = await ingestEvidence({ organizationId: 'tenant-one', userId: 'manager-one' }, input, client);
  await ingestEvidence({ organizationId: 'tenant-one', userId: 'manager-one' }, input, client);
  assert.equal(result.orderId, undefined);
  assert.equal(result.review, false);
  assert.equal(retained.length, 1);
  assert.deepEqual(retained[0].extractedFacts, { ...input.evidence, lines: input.evidence.lines.map(line => ({ ...line })), shipments: [] });
});

test('persisted replay cursor advances past more than one window of unrelated sources to an older matching order', async () => {
  const fake = replayFake(), template = fake.sources[1];
  fake.sources.splice(0, fake.sources.length, ...Array.from({ length: 46 }, (_, index) => ({ ...template, id: `source-${String(index).padStart(3,'0')}`, messageId: `message-${index}`, messageDate: new Date(at.getTime() - index * 60_000), extractedFacts: { ...evidence('ORDER'), lines: [{ description: index === 45 ? 'Raisins' : 'Unrelated bar material', quantity: 1, unit: 'lb' }] } })));
  const matched: string[] = [];
  const scope = (async (_org, facts) => ({ evidence: facts.lines?.some(line => line.description === 'Raisins') ? facts : null, materialKeys: [], reason: 'Exact fixture material' })) as typeof scopeSupplyEvidence;
  const ingest = async (_actor: unknown, input: unknown) => { matched.push((input as { source: { messageId: string } }).source.messageId); return { orderId: 'matched-order' }; };
  for (let run = 0; run < 3; run++) {
    // Repeated usage alerts must not restart the retained-evidence cursor.
    fake.materials[0].latestWarningAt = new Date(at.getTime() + run * 60_000);
    await replayWatchedSupplyEvidence('tenant-one', fake.db, ingest, { scope, materials: fake.materials, maxSources: 20 });
  }
  assert.deepEqual(matched, ['message-45']);
  assert.equal((fake.checkpoints[0].detail as { after: { id: string } }).after.id, 'source-019');
  assert.equal((fake.checkpoints[1].detail as { after: { id: string } }).after.id, 'source-039');
  assert.equal(fake.sources.length, 46, 'retained facts are neither deleted nor consumed');
});

test('watch signature changes only for matching inputs and completed passes wait before retrying failures', async () => {
  const fake = replayFake(), original = supplyWatchSignature(fake.materials);
  assert.equal(supplyWatchSignature([{ ...fake.materials[0], latestWarningAt: new Date(), needIds: ['another-cycle'], key: 'enriched-cycle' }]), original);
  assert.notEqual(supplyWatchSignature([{ ...fake.materials[0], aliases: ['new explicit alias'] }]), original);
  let attempts = 0;
  const ingest = async () => { attempts++; throw new Error('temporary retained write failure'); };
  await replayWatchedSupplyEvidence('tenant-one', fake.db, ingest, { scope: fake.scope, materials: fake.materials, now: () => at.getTime() });
  await replayWatchedSupplyEvidence('tenant-one', fake.db, ingest, { scope: fake.scope, materials: fake.materials, now: () => at.getTime() + 1_000 });
  assert.equal(attempts, 2);
  await replayWatchedSupplyEvidence('tenant-one', fake.db, ingest, { scope: fake.scope, materials: fake.materials, now: () => at.getTime() + 16 * 60_000 });
  assert.equal(attempts, 4, 'a later full pass retries failed candidates without changing extraction fields');
});

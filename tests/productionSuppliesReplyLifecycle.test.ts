import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import { extractSupplyMessage } from '../lib/productionSupplies/extraction';
import { supplyMessageRelationship } from '../lib/productionSupplies/mailProvenance';
import { findSupplyReplyOrder, readSupplySourceProvenance } from '../lib/productionSupplies/orderConfirmation';
import { ingestEvidence, supplyEvidenceInput } from '../lib/productionSupplies/service';

const organizationId = 'fixture-production';
const actor = { organizationId, userId: 'fixture-owner' };
const teamId = '2fec6bd0-b2c3-4224-bdc1-4ac507d062fe';
const preferences = {
  accountConfiguration: { version: 1, territories: [], categories: [], fields: [], teams: [{ id: teamId, name: 'Production', memberIds: [actor.userId] }] },
  productionSupplies: { productionTeamId: teamId },
};
const messageDate = new Date('2026-11-20T15:00:00Z');
const supplier = 'Fixture Glass Supplier';
const fromEmail = 'orders@supplier.invalid';
const messageId = 'a'.repeat(64);
const anchorId = 'b'.repeat(64);
const provenance = {
  threadId: 'reply-mailbox-thread', internetMessageId: messageId, internetReferences: [anchorId],
  contentVersion: 'SUPPLY_CURRENT_V1' as const, evidenceContext: 'CURRENT_MESSAGE' as const,
  direction: 'RECEIVED' as const, fromEmail, senderAuthenticated: true, productionTeamAuthorized: true,
};
const notice = supplyEvidenceInput.shape.evidence.parse({ kind: 'SHIPMENT', supplier, lines: [], shipments: [], billOfLadingPromised: true })!;
const order = {
  id: 'fixture-order', supplier, destination: null as string | null, ignored: false, orderReference: null, orderedAt: null,
  lines: [{ description: 'Fixture glass bottles', sku: null, ignored: false, allocations: [{ needId: 'fixture-need' }] }],
};

test('RFC relationship provenance hashes provider headers and keeps an early and recent anchor', () => {
  const firstMessage = supplyMessageRelationship([{ name: 'Message-ID', value: '<Original@Supplier.INVALID>' }]);
  const ancestors = ['<Original@supplier.invalid>', ...Array.from({length: 30}, (_, index) => `<ref-${index}@supplier.invalid>`)];
  const reply = supplyMessageRelationship([
    { name: 'Message-Id', value: '<Reply@supplier.invalid>' },
    { name: 'References', value: ancestors.join('\r\n ') },
    { name: 'In-Reply-To', value: '<parent@supplier.invalid>' },
  ]);
  assert.match(firstMessage.internetMessageId!, /^[a-f0-9]{64}$/);
  assert.ok(reply.internetReferences?.includes(firstMessage.internetMessageId!));
  assert.ok(reply.internetReferences?.includes(supplyMessageRelationship([{ name: 'Message-ID', value: ancestors.at(-1)! }]).internetMessageId!));
  assert.notEqual(reply.internetMessageId, firstMessage.internetMessageId);
  assert.equal(reply.internetReferences?.length, 16);
  assert.deepEqual(supplyMessageRelationship([
    { name: 'Message-ID', value: '<fake@attacker.invalid>' },
    { name: 'Message-ID', value: '<second@attacker.invalid>' },
    { name: 'References', value: '(quoted <bad@attacker.invalid>) non-address' },
    { name: 'Subject', value: '<injected@attacker.invalid>' },
  ]), {});
});

test('a missing or ambiguous RFC relationship cannot match cross-mailbox updates by supplier alone', async () => {
  const source = { mailboxConnectionId: 'fixture-mailbox', userId: actor.userId, messageDate };
  const queries: Prisma.SupplyOrderFindManyArgs[] = [];
  const db = (matches: typeof order[]) => ({ supplyOrder: { findMany: async (args: Prisma.SupplyOrderFindManyArgs) => {
    queries.push(args);
    return matches;
  } } }) as unknown as Prisma.TransactionClient;
  const crossMailbox = { ...provenance, threadId: undefined };
  assert.equal((await findSupplyReplyOrder(db([order]), organizationId, source, notice, crossMailbox))?.id, order.id);
  const clause = queries[0].where?.sources?.some?.source as Prisma.SupplySourceWhereInput;
  assert.equal(queries[0].where?.organizationId, organizationId);
  assert.equal(clause.organizationId, organizationId);
  assert.deepEqual(clause.OR?.[0].OR?.map(branch => branch.extractedFacts), [messageId, anchorId].map(id => ({ path: ['_provenance', 'internetMessageId'], equals: id })));
  assert.ok(JSON.stringify(clause.OR?.[0].AND).includes(fromEmail));
  assert.equal(await findSupplyReplyOrder(db([order, { ...order, id: 'other-order' }]), organizationId, source, notice, crossMailbox), null);
  assert.equal(await findSupplyReplyOrder(db([order]), organizationId, source, { ...notice, destination: 'Second facility' }, { ...crossMailbox, senderAuthenticated: false }), null);
  assert.equal(await findSupplyReplyOrder(db([order]), organizationId, source, notice, { ...crossMailbox, internetMessageId: undefined, internetReferences: undefined }), null);
  const locatedOrder = { ...order, destination: 'Fixture production' };
  assert.equal(await findSupplyReplyOrder(db([locatedOrder]), organizationId, source, { ...notice, destination: 'Second facility' }, crossMailbox), null);
  await findSupplyReplyOrder(db([order]), organizationId, source, notice, provenance);
  const mailboxFilter = queries.at(-1)?.where?.sources?.some?.source as Prisma.SupplySourceWhereInput;
  assert.equal(mailboxFilter.OR?.[0].mailboxConnectionId, source.mailboxConnectionId);
});

function retainedReplyFixture(alreadyLinked: boolean) {
  const source = {
    id: 'fixture-source', organizationId, userId: actor.userId, mailboxConnectionId: 'fixture-mailbox', provider: 'GOOGLE',
    messageId: 'fixture-provider-id', attachmentKey: '', messageDate, contentHash: 'fixture-exact-content-hash',
    extractionStatus: 'COMPLETE',
    extractedFacts: {
      kind: 'SHIPMENT', supplier, lines: [], orderDeliveryComplete: true,
      shipments: [{ referenceType: 'BILL_OF_LADING', status: 'IN_TRANSIT', reference: 'legacy-model-guess' }],
      _provenance: { contentVersion: 'SUPPLY_CURRENT_V1', evidenceContext: 'CURRENT_MESSAGE' },
    } as Record<string, unknown>,
  };
  const links = alreadyLinked ? [{ orderId: order.id }] : [];
  const auditActions: string[] = [];
  const tx = {
    organization: { findFirst: async () => ({ id: organizationId, crmPreferences: preferences }) },
    user: { findFirst: async () => ({ id: actor.userId, role: 'USER' }) },
    organizationFeature: { findFirst: async () => ({ id: 'enabled' }) },
    mailboxConnection: { findFirst: async () => ({ enabled: true, provider: 'GOOGLE', scope: 'https://www.googleapis.com/auth/gmail.readonly', accessTokenEncrypted: 'supply-v1.fixture' }) },
    $executeRaw: async () => 1,
    supplySource: {
      findFirst: async () => source,
      update: async ({ data }: { data: { extractedFacts: Record<string, unknown> } }) => { source.extractedFacts = data.extractedFacts; },
    },
    supplyOrderSource: {
      findMany: async () => links,
      upsert: async ({ create }: { create: { orderId: string } }) => { links.push({ orderId: create.orderId }); },
    },
    supplyAudit: { create: async ({ data }: { data: { action: string } }) => { auditActions.push(data.action); } },
    supplyOrder: { findMany: async () => [order], findFirst: async () => order, updateMany: async () => ({ count: 1 }) },
    supplyCatalogItem: { findMany: async () => [] },
    supplyNeed: { findMany: async () => [{
      id: 'fixture-need', description: 'Fixture glass bottles', unit: 'pallet', location: 'Location unknown',
      createdAt: messageDate, warnings: [], allocations: [], audits: [],
    }] },
  };
  // No shipment or receipt methods are supplied. The correction must never use them.
  const db = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient;
  const input = { source: { ...source, ...provenance, messageDate: messageDate.toISOString() }, evidence: { ...notice, supplier: 'Changed by re-extraction', paymentReceived: true } };
  return { db, source, input, auditActions, links };
}

test('exact lifecycle correction keeps raw normalized facts and attaches an unlinked reply without creating a shipment', async () => {
  const { db, source, input, auditActions, links } = retainedReplyFixture(false);
  const prior = structuredClone(source.extractedFacts);
  const result = await ingestEvidence(actor, input, db, { refreshLifecycle: true, reconcile: false });
  assert.equal(result.orderId, order.id);
  assert.deepEqual(links, [{ orderId: order.id }]);
  const { paymentReceived, billOfLadingPromised, _provenance, ...original } = source.extractedFacts;
  assert.deepEqual(original, { kind: prior.kind, supplier: prior.supplier, lines: prior.lines, shipments: prior.shipments, orderDeliveryComplete: true });
  assert.equal(paymentReceived, true);
  assert.equal(billOfLadingPromised, true);
  assert.equal(readSupplySourceProvenance(source.extractedFacts).lifecycleOnly, true);
  assert.deepEqual(auditActions, ['SOURCE_LIFECYCLE_REPLY_LINKED', 'SOURCE_LIFECYCLE_FACTS_CORRECTED']);
  await ingestEvidence(actor, input, db, { refreshLifecycle: true, reconcile: false });
  assert.equal(auditActions.length, 2);
  assert.equal(links.length, 1);
});

test('lifecycle correction rejects changed identity, unsafe sender, and foreign mailbox owner', async () => {
  const { db, input, source, auditActions } = retainedReplyFixture(true);
  for (const patch of [{ contentHash: 'different-hash' }, { senderAuthenticated: false }, { messageDate: '2026-11-21T15:00:00Z' }]) {
    await assert.rejects(ingestEvidence(actor, { ...input, source: { ...input.source, ...patch } }, db, { refreshLifecycle: true, reconcile: false }), /original authenticated/);
  }
  source.userId = 'other-owner';
  await assert.rejects(ingestEvidence(actor, input, db, { refreshLifecycle: true, reconcile: false }), /original authenticated/);
  assert.deepEqual(auditActions, []);
});

test('strict extraction keeps payment receipt and the promised bill separate from shipment records', async () => {
  const result = await extractSupplyMessage({ subject: 'Re: Production order', text: 'We received your payment. We will send the BOL today.', messageDate, timezone: 'America/New_York' }, {
    env: { NODE_ENV: 'test', SUPPLY_MAIL_INGESTION_ENABLED: 'true', OPENAI_API_KEY: 'fixture-key' },
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.ok(request.text.format.schema.required.includes('paymentReceived'));
      assert.ok(request.text.format.schema.required.includes('billOfLadingPromised'));
      assert.match(request.instructions, /does not create a shipment reference/);
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        ...notice, orderReference: null, orderStatus: null, orderedAt: null, invoiceDate: null, paymentDate: null,
        estimatedShipDate: null, destination: null, warning: null, warningSource: null, explanation: 'Payment received, document promised',
        paymentReceived: true,
      }) }] }] });
    },
  });
  assert.equal(result.paymentReceived, true);
  assert.equal(result.billOfLadingPromised, true);
  assert.deepEqual(result.shipments, []);
});

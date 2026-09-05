import assert from 'node:assert/strict';
import { it } from 'node:test';
import { pricePer750, getPriceEvidence, compareWithBuyers, type AffinityProduct, type AffinityPurchase } from '../lib/opportunityAffinity';
import { normalizeOpportunityCategory } from '../lib/opportunityConfig';
import { buildDailyPurchaseEvents } from '../lib/opportunitySalesLedger';
import { trainOutcomeModel, learnedAdjustment, labelMatureOutcome, type OutcomeExample } from '../lib/opportunityLearning';
import { getTenantConfig } from '../lib/tenantConfig';

const rum: AffinityProduct = { itemCode: 'premium', name: 'Premium rum', category: 'RUM', price750: 30, isLocal: true, priority: 1 };
const purchase = (overrides: Partial<AffinityPurchase> = {}): AffinityPurchase => ({ itemCode: 'other', category: 'RUM', price750: 30, liters: .75, bottles90: 36, isEcho: false, isLocal: false, ...overrides });

it('compares 750ml prices rather than treating a $35 handle as a premium bottle', () => {
  assert.equal(pricePer750(8.99, 33.8), 8.99 * .75);
  assert.equal(pricePer750(35, 59.2), 15);
  assert.equal(pricePer750(40, 25.4), 40);
  assert.equal(pricePer750(40, null), null);
});
it('trusts catalog categories and uses whole words for whiskey subcategories', () => {
  assert.equal(normalizeOpportunityCategory('Cordial', 'RUMPLE MINZE'), 'CORDIAL');
  assert.equal(normalizeOpportunityCategory(null, 'RUMPLE MINZE'), null);
  assert.equal(normalizeOpportunityCategory('American Whiskey', 'Bourbon'), 'BOURBON');
  assert.equal(normalizeOpportunityCategory('Irish', 'Irish whiskey'), 'IRISH');
});
it('cheap Ohio vodka cannot provide category or price affinity for premium rum', () => {
  const evidence = getPriceEvidence([purchase({ price750: 6 }), purchase({ category: 'VODKA', price750: 6.74, bottles90: 2000, isLocal: true })], rum);
  assert.equal(evidence.localScore, 2);
  assert.equal(evidence.priceScore, 0);
  assert.equal(evidence.mismatch, true);
});
it('regular comparable buying matters and comparable Ohio buying adds a bounded bonus', () => {
  const ordinary = getPriceEvidence([purchase()], rum);
  const local = getPriceEvidence([purchase({ isLocal: true })], rum);
  assert.equal(ordinary.priceScore, 35);
  assert.equal(local.localScore, 10);
  assert.ok(ordinary.priceScore > local.localScore);
});
it('a cheap-volume account with a real premium niche is not categorically disqualified', () => {
  const evidence = getPriceEvidence([purchase({ bottles90: 1000, price750: 5 }), purchase({ bottles90: 24, price750: 35 })], rum);
  assert.equal(evidence.mismatch, false);
  assert.ok(evidence.priceScore >= 15);
});
it('missing prices are uncertainty, not evidence of low spending', () => {
  const evidence = getPriceEvidence([purchase({ price750: null })], rum);
  assert.equal(evidence.coverage, 0);
  assert.equal(evidence.mismatch, false);
});
it('the same buyer fits a budget tenant differently from a premium tenant', () => {
  const purchases = [purchase({ price750: 7 })];
  assert.equal(getPriceEvidence(purchases, rum).mismatch, true);
  assert.equal(getPriceEvidence(purchases, { ...rum, price750: 8 }).priceScore, 35);
});
it('peer evidence excludes the account itself and unrelated tenant products', () => {
  const baskets = Array.from({ length: 10 }, (_,i) => ({ accountId: String(i), purchases: [purchase({ itemCode: 'premium', isEcho: true }), purchase()] }));
  assert.equal(compareWithBuyers('0', [purchase()], rum, baskets).buyers, 9);
  assert.equal(compareWithBuyers('0', [purchase()], rum, baskets).score, 0);
  assert.equal(compareWithBuyers('outside', [purchase()], rum, baskets).score, 5);
  assert.equal(compareWithBuyers('outside', [purchase()], { ...rum, itemCode: 'other-premium' }, baskets).buyers, 0);
});
it('daily capture retains consecutive equal purchases and classifies by tenant', () => {
  const config = getTenantConfig({ NODE_ENV: 'test', TENANT_ID: 'tenant-a', TENANT_PRODUCT_FILTER_MODE: 'item-list', TENANT_ITEM_CODES: 'A' });
  const rows = [1,2].map(day => ({ reportDate: new Date(`2026-08-0${day}T00:00:00Z`), permitNumber: '2485275', agencyId: '1', vendor: 'V', brand: 'A', wholesaleBottlesSold: 12 }));
  const identities = [{ id: 'account', licenseeId: '02485275-1', licenseeIds: [{ licenseeId: '2485275' }] }];
  const catalog = [{ itemCode: 'A', name: 'Tenant vodka', category: 'Vodka' }];
  const events = buildDailyPurchaseEvents(rows, identities, catalog, config);
  assert.equal(events.reduce((n,e) => n+e.bottles,0), 24);
  assert.equal(new Set(events.map(e => e.sourceKey)).size, 2);
  assert.equal(events[0].isTenantProduct, true);
  const other = buildDailyPurchaseEvents(rows, identities, catalog, { ...config, id: 'tenant-b', productFilter: { ...config.productFilter, itemCodes: ['B'] } });
  assert.equal(other[0].isTenantProduct, false);
  assert.notEqual(other[0].sourceKey, events[0].sourceKey);
  assert.deepEqual(buildDailyPurchaseEvents(rows, [...identities, { ...identities[0], id: 'ambiguous' }], catalog, config), []);
});
it('four outcomes cannot activate learning; repeated account cycles cannot inflate evidence', () => {
  const examples: OutcomeExample[] = Array.from({ length: 200 }, (_,i) => ({ accountId: String(i % 4), detectedAt: `2026-01-${String(i % 28+1).padStart(2,'0')}`, converted: true, key: 'one' }));
  const model = trainOutcomeModel(examples);
  assert.equal(model.active, false);
  assert.ok(model.trainingCount + model.holdoutCount <= 4);
  assert.equal(learnedAdjustment(model, 'one'), 0);
});
it('validated independent outcomes can influence future scores without exceeding the cap', () => {
  const examples: OutcomeExample[] = Array.from({ length: 200 }, (_,i) => ({ accountId: String(i), detectedAt: new Date(Date.UTC(2025,0,i+1)).toISOString(), converted: i % 2 === 0, key: i % 2 === 0 ? 'fit' : 'poor' }));
  const model = trainOutcomeModel(examples);
  assert.equal(model.active, true);
  assert.ok(learnedAdjustment(model, 'fit') > 0);
  assert.ok(learnedAdjustment(model, 'poor') < 0);
  assert.ok(Math.abs(learnedAdjustment(model, 'fit')) <= 10);
});

it('outcome labels wait for 90 observed days and include purchases after a dismissal', () => {
  const detected = new Date('2026-01-01T00:00:00Z');
  const end = new Date(detected.getTime() + 90*86400000);
  const dates = new Set(Array.from({ length: 90 }, (_,i) => new Date(detected.getTime()+(i+1)*86400000).toISOString().slice(0,10)));
  assert.equal(labelMatureOutcome(detected, end, dates, []), false);
  assert.equal(labelMatureOutcome(detected, end, dates, [new Date('2026-02-01')]), true);
  assert.equal(labelMatureOutcome(detected, new Date('2026-02-01'), dates, []), null);
  dates.delete('2026-02-01');
  assert.equal(labelMatureOutcome(detected, end, dates, []), null);
});

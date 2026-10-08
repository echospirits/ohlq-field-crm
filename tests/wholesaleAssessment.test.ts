import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWholesaleAccount, type AssessmentInput, type AssessmentProduct, type AssessmentPurchase, type UseEvidence } from '../lib/wholesaleAssessment';
import { sourceCoverage, windowDates, identityCoverage, reportRevision } from '../lib/wholesaleAssessmentCoverage';
import { marketPortfolio } from '../lib/wholesaleAssessmentInputs';
import { summarizePurchaseOutcome } from '../lib/wholesaleAssessmentOutcomes';
import type { OrganizationProduct, OhlqBrandMasterItem } from '@prisma/client';

import { product, purchase, use, input } from './fixtures/wholesaleAssessment';
test('small compatible purchases alone cannot create high priority; zero is not white space', () => {
  for (const volume of [0,2,6,12]) assert.ok(assessWholesaleAccount(input({ purchases: [purchase(volume)] })).priority < 40);
  assert.equal(assessWholesaleAccount(input({ purchases: [] })).candidates.length, 0);
});
test('60 and 600 equal-fit bottles remain commercially distinct without inventing upside', () => {
  const a = assessWholesaleAccount(input()), b = assessWholesaleAccount(input({ purchases: [purchase(600)] }));
  assert.ok(b.priority-a.priority > 40);
  assert.equal(b.candidates[0].observedCompatible750, 600);
  assert.equal(b.candidates[0].estimatedAdditional750, null); assert.equal(b.candidates[0].contribution, null);
});
test('low rum purchases need corroboration for development, which is not capped by category buying', () => {
  const result = assessWholesaleAccount(input({ purchases: [purchase(2)], uses: [use()] }));
  assert.equal(result.candidates[0].path, 'DEVELOP'); assert.ok(result.priority >= 70);
  assert.equal(result.candidates[0].estimatedAdditional750, null);
});
test('existing tenant buyers can deepen a supported placement', () => {
  const result = assessWholesaleAccount(input({ purchases: [purchase(80, { itemCode: 'R', tenant: true })], uses: [use({ kind: 'PLACEMENT' })] }));
  assert.equal(result.candidates[0].path, 'DEEPEN');
});
test('focus changes attention only and compelling opportunistic vodka can outrank weak focus rum', () => {
  const a = assessWholesaleAccount(input()), b = assessWholesaleAccount(input({ products: [product({ role: 'FOCUS' })] }));
  assert.ok(b.priority > a.priority); assert.deepEqual(a.observed, b.observed);
  const result = assessWholesaleAccount(input({ products: [product({ role: 'FOCUS' }), product({ itemCode: 'V', name: 'Vodka', category: 'VODKA', subtype: 'plain', role: 'OPPORTUNISTIC' })], purchases: [purchase(12), purchase(600, { category: 'VODKA', subtype: 'plain', name: 'Other vodka' })] }));
  assert.equal(result.candidates[0].product.itemCode, 'V');
});
test('normalized bottle sizes agree and generic cordials or incompatible rum styles do not qualify', () => {
  assert.equal(assessWholesaleAccount(input({ purchases: [purchase(30, { liters: 1.5 })] })).priority, assessWholesaleAccount(input()).priority);
  assert.equal(assessWholesaleAccount(input({ purchases: [purchase(600, { subtype: 'spiced' })] })).candidates.length, 0);
  assert.equal(assessWholesaleAccount(input({ products: [product({ category: 'CORDIAL', name: 'Elusive', subtype: null })], purchases: [purchase(600,{ category: 'CORDIAL', subtype: null })] })).candidates.length,0);
});
test('strong non-Ohio research can have high research priority and unverified distribution requires qualification', () => {
  const result = assessWholesaleAccount(input({ coverage: sourceCoverage({ asOf: new Date('2026-09-28'), completeDates: new Set(), identity: 'UNAVAILABLE', hasPurchases: false, through: null }), purchases: [], uses: [use()], products: [product({ availability: 'UNVERIFIED' })] }));
  assert.ok(result.priority >= 70); assert.equal(result.evidenceMode, 'RESEARCH_ONLY'); assert.equal(result.effort, 'QUALIFY');
  assert.equal(result.observed.bottles90, null); assert.equal(result.candidates[0].observedCompatible750, null);
});
test('wrong-location, stale and weak research cannot produce confident high research priority', () => {
  for (const overrides of [{ researchIdentityValid: false, uses: [] }, { researchAt: '2025-01-01', uses: [use({ observedAt: '2025-01-01' })] }, { researchConfidence: 'LOW', uses: [use()] }]) {
    const result = assessWholesaleAccount(input({ purchases: [], ...overrides })); assert.ok(result.priority < 70);
  }
});
test('review/amenity proxies and a generic cocktail program do not invent demand', () => {
  const result = assessWholesaleAccount(input({ purchases: [], scaleEvidence: null, uses: [] }));
  assert.equal(result.priority, 0); assert.equal(result.state, 'NEEDS_QUALIFICATION');
});
test('market fallback is unverified outside Ohio, exact market exclusion remains authoritative', () => {
  const p = { externalItemCode: 'R', market: 'OH', active: true, discontinued: false, status: 'OWNED', displayName: 'Rum', category: 'RUM', subcategory: 'light', strategicPriority: null, opportunityRole: null, distributionStatus: null } as OrganizationProduct;
  const inventory = { trusted: true, available: new Set<string>(), distilleryOnly: new Set<string>() };
  const catalog = new Map<string, OhlqBrandMasterItem>();
  assert.equal(marketPortfolio([p], catalog, 'KY', inventory)[0].availability, 'UNVERIFIED');
  assert.equal(marketPortfolio([p,{ ...p, market: 'KY', status: 'EXCLUDED' }], catalog, 'KY', inventory).length,0);
});
test('coverage distinguishes completed zero, missing day, ambiguous identity and corrected revision', () => {
  const asOf = new Date('2026-09-28'), completeDates = new Set(windowDates(asOf));
  assert.equal(sourceCoverage({ asOf, completeDates, identity: 'MATCHED', hasPurchases: false, through: '2026-09-28' }).verifiedZero,true);
  completeDates.delete('2026-09-27');
  assert.equal(sourceCoverage({ asOf, completeDates, identity: 'MATCHED', hasPurchases: false, through: '2026-09-28' }).mode,'PARTIAL_SALES');
  assert.equal(sourceCoverage({ asOf, completeDates, identity: 'AMBIGUOUS', hasPurchases: false, through: '2026-09-28' }).verifiedZero,false);
  const identities = identityCoverage([{id:'a',licenseeId:'12345',licenseeIds:[]},{id:'b',licenseeId:'12345',licenseeIds:[]}]);
  assert.equal(identities.get('a'),'AMBIGUOUS');
  assert.notEqual(reportRevision({updatedAt:asOf,rowCount:2}),reportRevision({updatedAt:new Date(asOf.getTime()+1),rowCount:2}));
});
test('local incumbent policy applies to capture, but not a corroborated additional use', () => {
  assert.equal(assessWholesaleAccount(input({ purchases: [purchase(600,{local:true})] })).candidates.length,0);
  assert.equal(assessWholesaleAccount(input({ purchases: [purchase(600,{local:true})],uses:[use()] })).candidates[0].path,'DEVELOP');
});
test('outcomes count dates not lines, do not invent nonconversion, and remain shadow', () => {
  const outcome = summarizePurchaseOutcome({ detectedAt:new Date('2026-06-01'), asOf:new Date('2026-09-01'), purchaseDates:[new Date('2026-06-02'),new Date('2026-06-02')],completeDates:new Set(),baseline750:null,observed750:null,placementStatuses:['PROMISED'] });
  assert.equal(outcome.distinctPurchaseDates,1);assert.equal(outcome.repeatPurchaseDates,0);assert.equal(outcome.sustained90Days,null);assert.equal(outcome.learningMode,'SHADOW');assert.equal(outcome.nonConversionLabel,null);
});

test('restricted buying keeps its policy cap and positive priorities change attention without changing volume',()=>{
  const baseline=assessWholesaleAccount(input({purchases:[purchase(600)],products:[product({priority:1})]}));
  const prioritized=assessWholesaleAccount(input({purchases:[purchase(600)],products:[product({priority:9})]}));
  assert.ok(prioritized.priority>baseline.priority);assert.deepEqual(prioritized.observed,baseline.observed);
  assert.ok(assessWholesaleAccount(input({nationalChain:true,purchases:[purchase(10000)],products:[product({role:'FOCUS'})]})).priority<=20);
  assert.equal(assessWholesaleAccount(input({purchases:[],uses:[use()],operatingStatus:'Unknown'})).priority<=60,true);
});

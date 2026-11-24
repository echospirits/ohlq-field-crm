import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWholesaleAccount, priceCompatible, readAssessment } from '../lib/wholesaleAssessment';
import { marketPortfolio, aggregatePurchases, restaurantAnalysisExcludedItemCodes, storedResearchSignals } from '../lib/wholesaleAssessmentInputs';
import { summarizePurchaseOutcome } from '../lib/wholesaleAssessmentOutcomes';
import type { OrganizationProduct, OhlqBrandMasterItem } from '@prisma/client';
import { product, purchase, input } from './fixtures/wholesaleAssessment';

test('whole commercial tiers use absolute depth and price-compatible core, not legacy score conversion', () => {
  for (const [monthly, rating] of [[0,0],[6,0],[12,1],[24,2],[60,3],[120,4],[240,5]]) {
    const a = assessWholesaleAccount(input({ purchases: [purchase(monthly * 3)] }));
    assert.equal(a.rating, rating); assert.equal(a.priority, rating); assert.deepEqual(a.candidates, []);
    assert.equal(a.commercial.leadingProduct750Per30, monthly);
  }
});
test('equivalent sizes, duplicate tenant products and tenant/local ownership preserve rating', () => {
  const base = assessWholesaleAccount(input({ purchases: [purchase(720)] }));
  for (const change of [
    { purchases: [purchase(360,{liters:1.5})] },
    { products: [product(),product({itemCode:'DUPLICATE',role:'MAINTENANCE',priority:2})] },
    { purchases: [purchase(720,{tenant:true,local:true,itemCode:'R'})] },
    { products: [product({availability:'UNAVAILABLE',role:'MAINTENANCE',priority:7})] },
  ]) assert.equal(assessWholesaleAccount(input({purchases:[purchase(720)],...change})).rating,base.rating);
});
test('price boundaries compare like bases and separate mismatch from missing attributes', () => {
  assert.equal(priceCompatible({price750:25},{price750:20})?.compatible,true);
  assert.equal(priceCompatible({price750:25.01},{price750:20})?.compatible,false);
  assert.equal(priceCompatible({price750:12},{price750:20})?.compatible,true);
  assert.equal(priceCompatible({price750:11.99},{price750:20})?.compatible,false);
  assert.equal(priceCompatible({price750:25,priceBasis:'PUBLISHED_WHOLESALE'},{price750:25,priceBasis:'CATALOG_RETAIL_PROXY'}),null);
  assert.equal(assessWholesaleAccount(input({ purchases:[purchase(720,{price750:5})] })).rating,0);
  assert.equal(assessWholesaleAccount(input({ purchases:[purchase(720,{price750:null})] })).rating,null);
  assert.equal(assessWholesaleAccount(input({ products:[product({subtype:null,name:'Unknown Rum'})] })).rating,null);
});
test('materially different rum/cordial/whiskey styles do not become generic matches', () => {
  assert.equal(assessWholesaleAccount(input({ purchases:[purchase(720,{subtype:'spiced'})] })).rating,0);
  assert.equal(assessWholesaleAccount(input({ products:[product({category:'CORDIAL',subtype:null})],purchases:[purchase(720,{category:'CORDIAL',subtype:null})] })).rating,null);
  assert.equal(assessWholesaleAccount(input({ products:[product({category:'BOURBON',subtype:null})],purchases:[purchase(720,{category:'RYE',subtype:null})] })).rating,0);
  assert.equal(assessWholesaleAccount(input({ products:[product({name:'Straight Bourbon',category:'BOURBON',subtype:null})],purchases:[purchase(720,{name:'Honey Bourbon',category:'BOURBON',subtype:null})] })).rating,0);
  assert.equal(assessWholesaleAccount(input({ products:[product({itemCode:'CORDIAL',name:'Exact Cordial',category:'CORDIAL',subtype:null})],purchases:[purchase(720,{itemCode:'CORDIAL',name:'Exact Cordial',category:'CORDIAL',subtype:null,tenant:true})] })).rating,5);
});
test('contacts, chain identity, suppression, visits, strategy and saved buyer plans cannot change stars', () => {
  const normal=assessWholesaleAccount(input({purchases:[purchase(720)]}));
  const changed=assessWholesaleAccount(input({purchases:[purchase(720)],buyerStructure:'Restricted corporate buyer',nationalChain:true,suppressed:true,plannedWork:true,lastVisitAt:'2026-09-28',researchAt:null,products:[product({role:'MAINTENANCE',priority:7})]}));
  assert.equal(changed.rating,normal.rating);assert.equal(changed.state,'READY');
  assert.equal(assessWholesaleAccount(input({closed:true})).state,'INELIGIBLE');
  assert.equal(assessWholesaleAccount(input({closed:true})).rating,null);
});
test('only distinct purchase dates spanning a week support persistence; extraordinary depth still matters', () => {
  const repeatedLines=assessWholesaleAccount(input({purchases:[purchase(720,{orderDates:['2026-09-15','2026-09-15','2026-09-15']})]}));
  assert.equal(repeatedLines.rating,4);assert.equal(repeatedLines.commercial.recurringCore750Per30,0);
  assert.equal(assessWholesaleAccount(input({purchases:[purchase(1440,{orderDates:[]})]})).rating,5);
  assert.equal(assessWholesaleAccount(input({purchases:[purchase(9,{orderDates:['2026-07-15','2026-08-15','2026-09-15']})]})).rating,0);
});
test('complete thirty-day and ninety-day purchasing rates agree without a coverage ceiling', () => {
  const full=assessWholesaleAccount(input({purchases:[purchase(720)]}));
  const thirty=input({purchases:[purchase(240,{bottles30:240,bottles60:240,orderDates:['2026-09-03','2026-09-15']})]});
  thirty.coverage={...thirty.coverage,completeDays:30,expectedDays:30,representedDays:30,representedFrom:'2026-08-30'};
  assert.equal(assessWholesaleAccount(thirty).rating,full.rating);
  assert.equal(assessWholesaleAccount(thirty).commercial.compatible750,240);
});
test('zero and unrated serialize distinctly and old versions do not leak into current ratings',()=>{
  const zero=assessWholesaleAccount(input({purchases:[]}));
  const unrated=assessWholesaleAccount(input({products:[]}));
  assert.equal(zero.rating,0);assert.equal(zero.state,'READY');assert.equal(unrated.rating,null);
  assert.equal(readAssessment(JSON.parse(JSON.stringify(zero)))?.rating,0);
  assert.equal(readAssessment(JSON.parse(JSON.stringify(unrated)))?.rating,null);
  assert.equal(readAssessment({version:'WHOLESALE_ASSESSMENT_V1',priority:100}),null);
});
test('market inclusion and catalog price provenance survive temporary Ohio inventory shortage', () => {
  const p = { externalItemCode:'R', market:'OH',active:true,discontinued:false,status:'OWNED',displayName:'Rum',category:'RUM',subcategory:'light',strategicPriority:null,opportunityRole:null,distributionStatus:null } as OrganizationProduct;
  const inventory = { trusted: true, available: new Set<string>() };
  const master={itemCode:'R',name:'Rum',category:'RUM',productVolume:25.36,retailPrice:25,wholesalePrice:23,solItemStatusCode:'70'} as unknown as OhlqBrandMasterItem;
  const catalog=new Map([['R',master]]);
  const restrictions = new Set<string>();
  assert.equal(marketPortfolio([p], catalog, 'OH', inventory, restrictions).products[0].priceBasis, 'PUBLISHED_WHOLESALE');
  assert.equal(marketPortfolio([p], catalog, 'KY', inventory, restrictions).products[0].priceBasis, 'CATALOG_RETAIL_PROXY');
  assert.equal(marketPortfolio([p, { ...p, market: 'KY', status: 'EXCLUDED' }], catalog, 'KY', inventory, restrictions).products.length, 0);
  assert.equal(marketPortfolio([{ ...p, discontinued: true }], catalog, 'OH', inventory, restrictions).products.length, 0);
  assert.equal(marketPortfolio([p], new Map([['R', { ...master, solItemStatusCode: '50' }]]), 'OH', inventory, restrictions).products.length, 0);
  assert.equal(marketPortfolio([p], catalog, 'KY', inventory, new Set(['R'])).products.length, 0);
});
test('the exact market strategy overrides the all-market record before excluding an item from analysis', () => {
  const all = { externalItemCode: 'R', market: 'ALL', active: true, discontinued: false, status: 'OWNED', strategicPriority: 3 } as OrganizationProduct;
  const decisions = [all, { ...all, market: 'KY', strategicPriority: 0 }];
  const restrictions = new Set(['DELISTED', 'DISTILLERY']);
  const inventory = { trusted: false, available: new Set<string>() };
  const ky = marketPortfolio(decisions, new Map(), 'Kentucky', inventory, restrictions);
  assert.deepEqual(ky.products, []);
  assert.deepEqual(ky.excludedItemCodes, new Set(['DELISTED', 'DISTILLERY', 'R']));
  assert.deepEqual(ky.excludedItemCodes, restaurantAnalysisExcludedItemCodes(decisions, 'KY', restrictions));
  assert.deepEqual(marketPortfolio(decisions, new Map(), 'OH', inventory, restrictions).products.map(product => product.itemCode), ['R']);
});
test('aggregation retains catalog identity, quantity and unique positive purchase dates',()=>{
  const rows=[{itemCode:'R',itemName:'Wrong name',category:'VODKA',bottles:6,reportDate:new Date('2026-09-15')},{itemCode:'R',itemName:'Wrong name',category:'VODKA',bottles:4,reportDate:new Date('2026-09-15')}];
  const catalog=new Map([['R',{itemCode:'R',name:'Catalog Light Rum',category:'RUM',productVolume:25.36,retailPrice:25,wholesalePrice:23} as unknown as OhlqBrandMasterItem]]);
  const [p]=aggregatePurchases(rows,catalog,new Set(['R']),new Date('2026-09-28'));
  assert.equal(p.name,'Catalog Light Rum');assert.equal(p.category,'RUM');assert.equal(p.bottles90,10);assert.equal(p.orderDates.length,1);assert.equal(p.priceBasis,'PUBLISHED_WHOLESALE');
});
test('stored research resolves exact menu identities and does not invent review counts',()=>{
  const catalog=new Map([['R',{itemCode:'R',name:'Catalog Light Rum',category:'RUM',productVolume:25.36,retailPrice:25,wholesalePrice:23} as unknown as OhlqBrandMasterItem]]);
  const signals=storedResearchSignals({lastRefreshedAt:new Date('2026-09-15'),identitySnapshot:{researchEvidence:[{field:'cocktailMenu',claim:'Catalog Light Rum on menu.',sourceUrl:'https://example.test/menu',exactLocation:true}],publicRatings:[{rating:4.5,reviewCount:1200,sourceUrl:'https://example.test/reviews'}]}},catalog);
  assert.equal(signals.comparables.length,1);assert.equal(signals.comparables[0].priceBasis,'CATALOG_RETAIL_PROXY');assert.equal(signals.publicRatings[0].reviewCount,1200);
  assert.equal(storedResearchSignals({lastRefreshedAt:new Date('2026-09-15'),identitySnapshot:{researchEvidence:[{field:'cocktailMenu',claim:'Catalog Light Rum is no longer on the menu.',sourceUrl:'https://example.test/menu',exactLocation:true}]}},catalog).comparables.length,0);
});
test('restricted exact menu products do not become comparables while eligible peer evidence is kept', () => {
  const menu = [
    { itemCode: 'ACTIVE', name: 'Active Light Rum' },
    { itemCode: 'DELISTED', name: 'Delisted Light Rum' },
    { itemCode: 'DISTILLERY', name: 'Distillery Light Rum' },
    { itemCode: 'MANUAL', name: 'Manual Light Rum' },
  ];
  const catalog = new Map(menu.map(row => [row.itemCode, { ...row, category: 'RUM', productVolume: 25.4, retailPrice: 25 } as unknown as OhlqBrandMasterItem]));
  const research = {
    lastRefreshedAt: new Date('2026-09-15'),
    identitySnapshot: { researchEvidence: menu.map(row => ({
      field: 'cocktailMenu', claim: row.name + ' on menu.', sourceUrl: 'https://example.test/menu', exactLocation: true,
    })) },
  };
  const signals = storedResearchSignals(research, catalog, new Set(['DELISTED', 'DISTILLERY', 'MANUAL']));
  assert.deepEqual(signals.comparables.map(product => product.itemCode), ['ACTIVE']);
  assert.equal(signals.evidence.length, menu.length);
});
test('restricted menu names cannot create a shorter eligible product match', () => {
  const catalog = new Map([
    ['SUFFIX', 'Distillery Exclusive'],
    ['ELIGIBLE', 'Echo Light Rum'],
    ['RESTRICTED', 'Echo Light Rum Distillery Exclusive'],
    ['SAME_NAME', 'Echo Light Rum'],
  ].map(([itemCode, name]) => [itemCode, { itemCode, name, category: 'RUM', productVolume: 25.4, retailPrice: 25 } as unknown as OhlqBrandMasterItem]));
  const sourceUrl = 'https://example.test/menu';
  const observedAt = '2026-09-15T00:00:00.000Z';
  const signalsFor = (claim: string, restrictions: string[], productUses: unknown[] = []) => storedResearchSignals({
    lastRefreshedAt: observedAt,
    identitySnapshot: { researchEvidence: [{ field: 'cocktailMenu', claim, sourceUrl, exactLocation: true }], productUses },
  }, catalog, new Set(restrictions));
  const restrictedClaim = 'Featured Echo Light Rum Distillery Exclusive cocktails';
  const restricted = signalsFor(restrictedClaim, ['SUFFIX', 'RESTRICTED']);
  assert.deepEqual(restricted.comparables, []);
  assert.equal(restricted.evidence[0].claim, restrictedClaim);
  const mixed = signalsFor(restrictedClaim + ' and pours of Echo Light Rum', ['SUFFIX', 'RESTRICTED']);
  assert.deepEqual(mixed.comparables.map(product => product.itemCode), ['ELIGIBLE', 'SAME_NAME']);
  const structured = signalsFor('Full cocktail menu', ['SAME_NAME'], [{
    kind: 'MENU', productCode: 'ELIGIBLE', pouredProduct: 'Echo Light Rum', exactLocation: true,
    claim: 'Light rum pour', source: sourceUrl, observedAt,
  }]);
  assert.deepEqual(structured.comparables.map(product => product.itemCode), ['ELIGIBLE']);
});
test('outcomes remain shadow evidence and count dates rather than invoice lines',()=>{
  const outcome=summarizePurchaseOutcome({detectedAt:new Date('2026-06-01'),asOf:new Date('2026-09-01'),purchaseDates:[new Date('2026-06-02'),new Date('2026-06-02')],completeDates:new Set(),baseline750:null,observed750:null,placementStatuses:['PROMISED']});
  assert.equal(outcome.distinctPurchaseDates,1);assert.equal(outcome.repeatPurchaseDates,0);assert.equal(outcome.learningMode,'SHADOW');assert.equal(outcome.nonConversionLabel,null);
});

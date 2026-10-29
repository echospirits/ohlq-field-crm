import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('agency intelligence uses one gated account tab and retains its supporting section order', () => {
  const page = readFileSync('app/agencies/[id]/page.tsx', 'utf8');
  assert.match(page, /hasAgencyIntelligence \|\| hasWholesaleOpportunities/);
  const panel = page.indexOf("id: 'intelligence', label: 'Intelligence'");
  assert.ok(panel > page.indexOf("id: 'overview'"));
  assert.ok(page.indexOf('<AgencyIntelligencePanel', panel) < page.indexOf('<AgencyRetailMarketIntelligence', panel));
  assert.ok(page.indexOf('<AgencyRetailMarketIntelligence', panel) < page.indexOf('<AgencyStoreIntelligence', panel));
  assert.doesNotMatch(page, /summary="Retail Intelligence"/);
});

test('intelligence children retain anchors without duplicate top-level disclosures or IDs', () => {
  const store = readFileSync('app/agencies/AgencyStoreIntelligence.tsx', 'utf8');
  const actions = readFileSync('app/agencies/AgencyIntelligencePanel.tsx', 'utf8');
  assert.match(store, /<section id="store-intelligence"/);
  assert.match(store, /<section id="retail-market"/);
  assert.doesNotMatch(store, /AnchoredDetails/);
  assert.match(store, /fits=\{fits\.slice\(0, 5\)\}/);
  assert.match(store, /<details className="store-fit-more"><summary>More products/);
  assert.match(store, /fits=\{fits\.slice\(5\)\}/);
  assert.doesNotMatch(actions, /id="intelligence"/);
  const details = readFileSync('app/components/AnchoredDetails.tsx', 'utf8');
  assert.match(details, /ref\.current\?\.contains\(target\)/);
  assert.match(details, /containsAnchor\(link\.hash\)/);
});

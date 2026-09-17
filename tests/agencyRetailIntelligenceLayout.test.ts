import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('agency retail intelligence is one default-open panel after activity', () => {
  const page = readFileSync('app/agencies/[id]/page.tsx', 'utf8');
  assert.match(page, /id="intelligence" initialOpen summary="Retail Intelligence"/);
  const panel = page.indexOf('initialOpen summary="Retail Intelligence"');
  assert.ok(panel > page.indexOf('id="activity"'));
  assert.ok(page.indexOf('<AgencyIntelligencePanel', panel) < page.indexOf('<AgencyRetailMarketIntelligence', panel));
  assert.ok(page.indexOf('<AgencyRetailMarketIntelligence', panel) < page.indexOf('<AgencyStoreIntelligence', panel));
  assert.match(page.slice(panel), /<\/AnchoredDetails> : null}\s*<\/>/);
});

test('intelligence children retain anchors without duplicate top-level disclosures or IDs', () => {
  const store = readFileSync('app/agencies/AgencyStoreIntelligence.tsx', 'utf8');
  const actions = readFileSync('app/agencies/AgencyIntelligencePanel.tsx', 'utf8');
  assert.match(store, /<section id="store-intelligence"/);
  assert.match(store, /<section id="retail-market"/);
  assert.doesNotMatch(store, /AnchoredDetails/);
  assert.doesNotMatch(actions, /id="intelligence"/);
  const details = readFileSync('app/components/AnchoredDetails.tsx', 'utf8');
  assert.match(details, /ref\.current\?\.contains\(target\)/);
  assert.match(details, /containsAnchor\(link\.hash\)/);
});

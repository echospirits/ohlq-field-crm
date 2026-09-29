import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { opportunityEvidence, parseOpportunityScoreComponents } from '../lib/opportunityPresentation';

test('parses stored opportunity component math including penalties', () => {
  const factors = [
    'Strong category volume',
    'Score components: demand 15.0, price 8.5, Ohio affinity 2.0, public fit 6.0, relationship 0.0, urgency 0.0, peers 3.0, learning -2.0, worklist -1.5; no baseline points',
    'National chain with likely centralized brand contracts; 20-point penalty and priority capped at 35',
  ];

  assert.deepEqual(parseOpportunityScoreComponents(factors), [
    { key: 'demand', label: 'Category demand', points: 15 },
    { key: 'price', label: 'Price fit', points: 8.5 },
    { key: 'Ohio affinity', label: 'Ohio-brand affinity', points: 2 },
    { key: 'public fit', label: 'Public fit', points: 6 },
    { key: 'relationship', label: 'Relationship', points: 0 },
    { key: 'urgency', label: 'Urgency', points: 0 },
    { key: 'peers', label: 'Similar buyers', points: 3 },
    { key: 'learning', label: 'Learned outcomes', points: -2 },
    { key: 'worklist', label: 'Open-work penalty', points: -1.5 },
  ]);
  assert.deepEqual(opportunityEvidence(factors), [factors[0], factors[2]]);
});

test('returns no component chart for older explanations without stored component math', () => {
  assert.deepEqual(parseOpportunityScoreComponents(['Review current sales']), []);
});

test('wholesale opportunities use the compact intelligence row and live search pattern', () => {
  const page = readFileSync('app/opportunities/page.tsx', 'utf8');
  const search = readFileSync('app/opportunities/OpportunitySearch.tsx', 'utf8');
  assert.match(page, /className="opportunity-results"/);
  assert.match(page, /className="opportunity-row"/);
  assert.match(page, /className="opportunity-row-reasons"/);
  assert.doesNotMatch(page, /className="card opportunity-card"/);
  assert.match(page, /scoringVersion\.startsWith\('RESEARCH_FIT_'\)/);
  assert.match(search, /LiveFilterForm/);
});

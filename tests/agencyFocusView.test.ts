import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { agencyFocusHref } from '../lib/agencyFocusView';

test('agency action filter URLs retain account and search context with safe encoding', () => {
  const query = { agencyId: 'agency-1', q: 'Rum & rye', state: 'RESTOCK' };
  const filtered = new URL(agencyFocusHref(query), 'https://example.com');
  assert.equal(filtered.searchParams.get('agencyId'), 'agency-1');
  assert.equal(filtered.searchParams.get('q'), 'Rum & rye');
  assert.equal(filtered.searchParams.get('state'), 'RESTOCK');
  assert.equal(agencyFocusHref({ ...query, state: undefined }), '/agency-focus?agencyId=agency-1&q=Rum+%26+rye');
  assert.equal(agencyFocusHref({ q: ' ' }), '/agency-focus');
});

test('agency focus exposes decision metrics and reasons without evidence dropdowns', () => {
  const source = readFileSync('app/agency-focus/page.tsx', 'utf8');
  assert.match(source, /requireFeatureForUser\(currentUser, 'AGENCY_INTELLIGENCE'\)/);
  assert.match(source, /className="agency-focus-metrics"/);
  for (const label of ['On hand', 'Minimum', 'Sales / 7d', 'Sales / 30d', 'Fit score', 'Peer carry']) {
    assert.ok(source.includes(`<dt>${label}</dt>`));
  }
  assert.match(source, /aria-label="Recommendation evidence"/);
  assert.doesNotMatch(source, /View evidence|opportunity-evidence/);
  assert.match(source, /reason: stringList\(item.reasons\).join\(' '\), returnTo,/);
  assert.match(source, /take: 251/);
  assert.match(source, /Top 250 matching actions/);
  assert.match(source, /AgencyFocusSearch value=\{search\}/);
  assert.match(readFileSync('app/agency-focus/AgencyFocusSearch.tsx', 'utf8'), /LiveFilterForm/);
  assert.match(source, /No matching agency actions/);
});

test('shared Intelligence submenu appears on desktop and mobile without replacing primary tabs', () => {
  const source = readFileSync('app/components/AppNavigation.tsx', 'utf8');
  assert.equal((source.match(/<IntelligenceMenu /g) ?? []).length, 2);
  assert.match(source, /app-intelligence-menu/);
  assert.match(source, /event.currentTarget.open = false/);
  assert.match(source, /prefix: '\/agency-focus'.*label: 'Agency Intelligence'/);
});

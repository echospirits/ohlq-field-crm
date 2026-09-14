import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createVisitDiagnostics } from '../lib/visitDiagnostics';

test('visit failures identify the committed record and stage without recording submitted data', async () => {
  const records: Record<string, any>[] = [];
  const info = console.info;
  const error = console.error;
  console.info = console.error = (line: string) => { records.push(JSON.parse(line)); };
  try {
    const diagnostics = createVisitDiagnostics('create');
    diagnostics.mark('transaction', { userId: 'rep', organizationId: 'tenant' });
    diagnostics.mark('committed', { visitId: 'saved-visit', committed: true });
    const failure = Object.assign(new Error('private notes and credentials'), { code: 'P2024' });
    await diagnostics.bestEffort('calendar_sync', async () => { throw failure; });
    diagnostics.mark('confirmation');
    assert.equal(records.at(-1)?.stage, 'confirmation');
    const failed = records.find(record => record.event === 'visit.follow_up_failed')!;
    assert.equal(failed.committed, true);
    assert.equal(failed.visitId, 'saved-visit');
    assert.equal(failed.userId, 'rep');
    assert.equal(failed.organizationId, 'tenant');
    assert.equal(failed.error.code, 'P2024');
    assert.ok(failed.rssBytes > 0);
    assert.ok(failed.elapsedMs >= 0);
    assert.equal(new Set(records.map(record => record.operationId)).size, 1);
    assert.ok(!JSON.stringify(records).includes('private notes'));
  } finally {
    console.info = info;
    console.error = error;
  }
});

test('a failed transaction is distinguishable from a saved visit and attempts have unique IDs', () => {
  const records: Record<string, any>[] = [];
  const info = console.info;
  const error = console.error;
  console.info = console.error = (line: string) => { records.push(JSON.parse(line)); };
  try {
    const diagnostics = createVisitDiagnostics('update');
    diagnostics.mark('transaction', { visitId: 'existing' });
    diagnostics.failure(new Error('database unavailable'));
    createVisitDiagnostics('update').mark('authentication');
    assert.equal(records[1].event, 'visit.failed');
    assert.equal(records[1].committed, false);
    assert.equal(records[1].stage, 'transaction');
    assert.notEqual(records[1].operationId, records[2].operationId);
  } finally {
    console.info = info;
    console.error = error;
  }
});

test('interactive visit actions cannot invoke the statewide opportunity engine', () => {
  const actions = readFileSync(new URL('../app/visits/actions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(actions, /opportunityEngine|evaluateOpportunityIntelligence/);
  // Recalculation still has an owner outside the interactive request.
  const imports = readFileSync(new URL('../lib/ohlqAnnualSalesWorkflow.ts', import.meta.url), 'utf8');
  assert.match(imports, /await runOpportunityIntelligenceAfterImport/);
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reportOpenDockLookupWarning } from '../lib/productionForecasting/operationalSignals/warnings';
import type { DeliveryAvailabilityResult } from '../lib/productionForecasting/operationalSignals/types';

test('temporary OpenDock failures produce safe GitHub warning annotations and a retained-data summary', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'opendock-warning-'));
  try {
    const summary = path.join(directory, 'summary.md');
    const result: DeliveryAvailabilityResult = { market: 'OH', locationCode: 'GRN', locationName: 'private setting\n::error::injected', warehouseId: 'private-id', loadTypeId: 'private-id', timezone: 'America/New_York', source: 'OPENDOCK', observedAt: '2026-11-09T12:00:00Z', status: 'UNAVAILABLE', diagnosticCode: 'OPENDOCK_RATE_LIMITED', earliestAvailableAt: null, calendarDays: null, businessDays: null, businessDayMethod: null, checkedThrough: null };
    const logs: string[] = [];
    reportOpenDockLookupWarning(result, message => logs.push(message), { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^::warning::OpenDock Green/);
    assert.match(logs[0], /OPENDOCK_RATE_LIMITED/);
    assert.equal(/private|::error::|\n/.test(logs[0]), false);
    assert.match(readFileSync(summary, 'utf8'), /Previous successful observations retained; current availability is unknown/);
    assert.throws(() => reportOpenDockLookupWarning({ ...result, diagnosticCode: 'INGESTION_FAILED' }, () => {}, {}), /Only temporary/);
    assert.throws(() => reportOpenDockLookupWarning({ ...result, status: 'AUTH_FAILED' }, () => {}, {}), /Only temporary/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

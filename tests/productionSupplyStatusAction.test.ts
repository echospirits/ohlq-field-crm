import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';

function loadAction(options: { denied?: boolean; failure?: Error } = {}) {
  const events: unknown[] = [];
  const actor = { organizationId: 'authorized-tenant', userId: 'current-manager' };
  const exports: { dismissSupplyStatusAction?: (form: FormData) => Promise<unknown> } = {};
  const dependencies: Record<string, unknown> = {
    'next/cache': { revalidatePath: (path: string) => events.push(['revalidate', path]) },
    zod: { z },
    '../../lib/productionSupplies/access': { requireSupplyActor: async (manage: boolean) => { events.push(['authorize', manage]); if (options.denied) throw Error('not-authorized'); return { actor }; } },
    '../../lib/productionSupplies/status': { dismissSupplyStatusCard: async (trusted: typeof actor, input: unknown) => { events.push(['dismiss', trusted, input]); if (options.failure) throw options.failure; } },
  };
  const source = ts.transpileModule(readFileSync('app/production-supplies/statusActions.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(source, { exports, require: (name: string) => dependencies[name] });
  return { action: exports.dismissSupplyStatusAction!, events };
}

function form() {
  const value = new FormData();
  value.set('needId', 'current-card'); value.set('cycleKey', 'current-cycle');
  value.set('organizationId', 'forged-tenant'); value.set('userId', 'forged-manager');
  return value;
}

test('dismiss authorizes management before any domain mutation', async () => {
  const current = loadAction({ denied: true });
  await assert.rejects(() => current.action(form()), /not-authorized/);
  assert.equal(JSON.stringify(current.events), JSON.stringify([['authorize', true]]));
});

test('dismiss uses server identity and ignores forged tenant and user fields', async () => {
  const current = loadAction();
  const result = await current.action(form());
  assert.equal(JSON.stringify(result), JSON.stringify({ success: 'Supply dismissed.' }));
  assert.equal(JSON.stringify(current.events), JSON.stringify([
    ['authorize', true],
    ['dismiss', { organizationId: 'authorized-tenant', userId: 'current-manager' }, { needId: 'current-card', cycleKey: 'current-cycle' }],
    ['revalidate', '/production-supplies'],
  ]));
});

test('failed dismissal reports recovery without publishing success or internal errors', async () => {
  const current = loadAction({ failure: Error('internal-provider-detail') });
  const result = await current.action(form());
  assert.equal(JSON.stringify(result), JSON.stringify({ error: 'Could not dismiss this supply. Try again.' }));
  assert.equal(current.events.some(event => Array.isArray(event) && event[0] === 'revalidate'), false);
});

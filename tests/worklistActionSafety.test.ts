import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { WorklistStatus } from '@prisma/client';

for (const page of ['alerts', 'my-week']) {
  const source = readFileSync(new URL(`../app/${page}/page.tsx`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const action = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateWorklistStatus')!;
  function load(owned: boolean) {
    const calls: string[] = [];
    const code = ts.transpileModule(`${action.getText(ast)}\nresult = updateWorklistStatus;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = {
      result: undefined as unknown,
      WorklistStatus,
      requireUser: async () => ({ id: 'rep' }),
      requireOrganizationContext: async () => ({ organizationId: 'tenant' }),
      toOptional: (value: unknown) => value || null,
      toWorklistStatus: (value: unknown) => value,
      prisma: { worklistItem: {
        findFirst: async ({ where }: any) => { assert.equal(where.organizationId, 'tenant'); return owned ? { id: 'task' } : null; },
        update: async ({ data }: any) => { calls.push('save'); assert.equal(data.status, 'COMPLETED'); assert.equal(data.completedByUserId, 'rep'); return { wholesaleAccountId: 'wholesale' }; },
      } },
      scheduleWorklistSync: () => calls.push('schedule-calendar'),
      revalidatePath: (path: string) => calls.push(path),
    };
    runInNewContext(code, context);
    return { calls, run: context.result as (data: FormData) => Promise<{ success?: string; error?: string }> };
  }

  test(`${page}: completing a wholesale task saves and responds without statewide recalculation`, async () => {
    assert.doesNotMatch(source, /opportunityEngine|evaluateOpportunityIntelligence|await syncWorklistItemCalendar/);
    const { run, calls } = load(true);
    const data = new FormData(); data.set('id', 'task'); data.set('status', 'COMPLETED');
    assert.equal((await run(data)).success, 'Task completed.');
    assert.equal(calls[0], 'save');
    assert.ok(calls.includes('schedule-calendar'));
    assert.ok(calls.includes('/alerts'));
    assert.ok(calls.includes('/my-week'));
  });

  test(`${page}: missing or inaccessible tasks produce a visible error without writes`, async () => {
    const { run, calls } = load(false);
    const data = new FormData(); data.set('status', 'COMPLETED');
    assert.ok((await run(data)).error);
    data.set('id', 'other-tenant-task');
    assert.ok((await run(data)).error);
    assert.equal(calls.length, 0);
  });
}

test('post-save calendar sync waits until after the response and contains failures', async () => {
  const source = readFileSync(new URL('../lib/calendar/scheduleWorklistSync.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('sync.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(ts.isFunctionDeclaration)!;
  const code = ts.transpileModule(fn.getText(ast).replace('export ', '') + '\nresult = scheduleWorklistSync;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let deferred: (() => Promise<void>) | undefined;
  let syncs = 0;
  let errors = 0;
  const context = { result: undefined as unknown, after: (callback: () => Promise<void>) => { deferred = callback; }, syncWorklistItemCalendar: async () => { syncs++; throw new Error('unavailable'); }, console: { error: () => { errors++; } } };
  runInNewContext(code, context);
  (context.result as (id: string) => void)('saved-task');
  assert.equal(syncs, 0);
  await deferred!();
  assert.equal(syncs, 1);
  assert.equal(errors, 1);
});

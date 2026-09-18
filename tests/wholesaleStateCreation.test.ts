import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { normalizeUsState, stateScopedLicenseeIds } from '../lib/usStates';
import { parseWholesaleLicenseeIds, getPrimaryWholesaleLicenseeId, getWholesaleLicenseeIdCreateData } from '../lib/wholesaleAccounts';

function loadCreate() {
  const source = readFileSync(new URL('../app/wholesale/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const action = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createWholesale')!;
  const code = ts.transpileModule(`${action.getText(ast)}\nresult = createWholesale;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const writes: Array<any> = [];
  let officialLookups = 0;
  const context = {
    result: undefined as unknown,
    requireUser: async () => ({ id: 'rep' }), requireOrganizationContext: async () => ({ organizationId: 'tenant' }),
    normalizeUsState, stateScopedLicenseeIds, parseWholesaleLicenseeIds, getPrimaryWholesaleLicenseeId, getWholesaleLicenseeIdCreateData,
    randomUUID: () => 'unique-test', getSelectedTagIds: () => [], getWholesaleLicenseeIdConflictWhere: (ids: string[]) => ({ ids }),
    AccountType: { BAR_RESTAURANT: 'BAR_RESTAURANT' }, toOptional: (value: string) => value.trim() || null,
    prisma: {
      wholesaleAccount: { findMany: async () => [] },
      account: { findFirst: async () => { officialLookups++; return null; } },
      $transaction: async (fn: any) => fn({ wholesaleAccount: { create: async ({ data }: any) => { writes.push(data); return { id: 'new' }; } } }),
    },
    revalidatePath: () => {}, redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  };
  runInNewContext(code, context);
  return { run: context.result as (data: FormData) => Promise<any>, writes, officialLookups: () => officialLookups };
}

test('manual wholesale creation stores the state without matching an Ohio permit and allows no permit ID', async () => {
  for (const permit of ['', '12345']) {
    const { run, writes, officialLookups } = loadCreate();
    const data = new FormData();
    for (const [key, value] of Object.entries({ name: 'QA prospect', state: 'Kentucky', city: 'Louisville', address: '1 Main St', zip: '40202', licenseeIds: permit })) data.set(key, value);
    await assert.rejects(run(data), /REDIRECT:\/wholesale\?status=saved/);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].state, 'KY');
    assert.equal(writes[0].licenseeId, permit ? 'KY:12345' : 'MANUAL-unique-test');
    assert.equal(officialLookups(), 0);
  }
});

test('invalid states fail without writes and existing forms retain Ohio as the default', async () => {
  const { run, writes, officialLookups } = loadCreate();
  const data = new FormData(); data.set('name', 'QA prospect'); data.set('state', 'invalid');
  assert.match((await run(data)).error, /valid US state/);
  assert.equal(writes.length, 0);
  data.delete('state');
  await assert.rejects(run(data), /REDIRECT/);
  assert.equal(writes[0].state, 'OH');
  assert.equal(officialLookups(), 1);
});

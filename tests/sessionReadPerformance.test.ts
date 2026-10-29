import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function fixture() {
  const filename = resolve('lib/auth.ts'), require = createRequire(filename), exports: any = {};
  let token = 'first', reads = 0, active = true;
  let store = { get: () => ({ value: token }) };
  const mocks: Record<string, unknown> = {
    './prisma': { prisma: { userSession: { findFirst: async () => { reads++; return active ? { user: { id: 'rep', isActive: true } } : null; } } } },
    './userActivity': {},
    'next/headers': { cookies: async () => store },
    'next/navigation': { redirect: () => { throw Error('redirect'); } },
  };
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, Date, Buffer, process, console, require: (name: string) => name in mocks ? mocks[name] : require(name) });
  return { auth: exports, reads: () => reads, token: (value: string) => { token = value; }, revoke: () => { active = false; }, nextRequest: () => { store = { get: () => ({ value: token }) }; } };
}

test('layout and page share one in-flight session read inside a request', async () => {
  const f = fixture();
  const [layout, page] = await Promise.all([f.auth.getCurrentUser(), f.auth.requireUser()]);
  assert.equal(layout.id, 'rep'); assert.equal(page.id, 'rep'); assert.equal(f.reads(), 1);
});

test('a later request revalidates revoked access, and a changed cookie cannot reuse another session', async () => {
  const f = fixture();
  await f.auth.getCurrentSession();
  f.token('second'); await f.auth.getCurrentSession(); assert.equal(f.reads(), 2);
  f.revoke(); f.nextRequest();
  assert.equal(await f.auth.getCurrentSession(), null); assert.equal(f.reads(), 3);
});

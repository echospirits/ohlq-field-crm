import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadEnvironmentFile, parseEnvironmentFile } from '../lib/environmentFile';

test('parseEnvironmentFile ignores comments and invalid lines while preserving supported values', () => {
  assert.deepEqual(
    parseEnvironmentFile(`
      # ignored
      PLAIN = value
      DOUBLE="quoted value"
      SINGLE='another value'
      EMPTY=
      not a setting
    `),
    [
      ['PLAIN', 'value'],
      ['DOUBLE', 'quoted value'],
      ['SINGLE', 'another value'],
      ['EMPTY', ''],
    ],
  );
});

test('parseEnvironmentFile expands escaped newlines only when requested', () => {
  assert.deepEqual(parseEnvironmentFile('PRIVATE_KEY="first\\nsecond"'), [['PRIVATE_KEY', 'first\\nsecond']]);
  assert.deepEqual(
    parseEnvironmentFile('PRIVATE_KEY="first\\nsecond"', { expandEscapedNewlines: true }),
    [['PRIVATE_KEY', 'first\nsecond']],
  );
});

test('loadEnvironmentFile preserves defined values and can replace only empty values', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'neat-env-file-'));
  const file = path.join(directory, '.env');
  writeFileSync(file, 'EXISTING=file\nEMPTY=replaced\nNEW=value\n', 'utf8');

  try {
    const preserveDefined = { EXISTING: 'runtime', EMPTY: '' };
    loadEnvironmentFile(file, { environment: preserveDefined });
    assert.deepEqual(preserveDefined, { EXISTING: 'runtime', EMPTY: '', NEW: 'value' });

    const preserveNonEmpty = { EXISTING: 'runtime', EMPTY: '' };
    loadEnvironmentFile(file, { environment: preserveNonEmpty, preserveExisting: 'non-empty' });
    assert.deepEqual(preserveNonEmpty, { EXISTING: 'runtime', EMPTY: 'replaced', NEW: 'value' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

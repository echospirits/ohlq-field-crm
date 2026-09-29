import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import packageMetadata from '../package.json';
import { APP_VERSION } from '../lib/appVersion';

test('application version comes from package.json and is shown in protected diagnostics', () => {
  assert.equal(APP_VERSION, packageMetadata.version);
  assert.match(APP_VERSION, /^0\.\d+\.\d+(?:-dev)?$/);

  const diagnostics = readFileSync('app/admin/environment/page.tsx', 'utf8');
  assert.match(diagnostics, /requireAdmin\(\)/);
  assert.match(diagnostics, /Application version/);
  assert.match(diagnostics, /APP_VERSION/);
});

test('release instructions point to valid operational files and commands', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');
  assert.match(agents, /docs\/RELEASE_PROCESS\.md/);
  assert.match(agents, /docs\/releases\/UNRELEASED\.md/);
  assert.match(agents, /docs\/releases\/RELEASE_CHECKLIST\.md/);
  assert.match(packageJson, /"release:check": "tsx scripts\/release-check\.ts"/);
  assert.match(packageJson, /"typecheck": "tsc --noEmit"/);
});

import { execFileSync } from 'node:child_process';

type Options = {
  productionRef: string;
  tstRef: string;
};

const DEFAULTS: Options = {
  productionRef: 'origin/main',
  tstRef: 'staging/tst',
};

function git(args: string[], allowFailure = false) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(' ')} failed: ${message}`);
  }
}

export function parseOptions(args: string[]): Options {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--production-ref' && args[index + 1]) options.productionRef = args[++index];
    else if (argument === '--tst-ref' && args[index + 1]) options.tstRef = args[++index];
    else if (argument === '--help') {
      console.log('Usage: npm run release:check -- [--production-ref <ref>] [--tst-ref <ref>]');
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return options;
}

function verifyRef(ref: string) {
  git(['rev-parse', '--verify', `${ref}^{commit}`]);
}

function versionAt(ref: string) {
  const packageJson = git(['show', `${ref}:package.json`]);
  const parsed = JSON.parse(packageJson) as { version?: unknown };
  if (typeof parsed.version !== 'string' || !/^0\.\d+\.\d+(?:-dev)?$/.test(parsed.version)) {
    throw new Error(`${ref}:package.json does not contain a valid pre-1.0 version.`);
  }
  return parsed.version;
}

function lines(value: string) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function section(title: string, values: string[], empty: string) {
  console.log(`\n${title}`);
  if (!values.length) console.log(`  ${empty}`);
  else values.forEach((value) => console.log(`  ${value}`));
}

function environmentNamesAt(ref: string) {
  const names = new Set<string>();
  const sourceMatches = git([
    'grep', '-h', '-o', '-E', 'process\\.env\\.[A-Z][A-Z0-9_]*', ref, '--',
    '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs',
  ], true);
  for (const match of sourceMatches.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);

  const example = git(['show', `${ref}:.env.example`], true);
  for (const match of example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) names.add(match[1]);
  return names;
}

function featureKeysAt(ref: string) {
  const source = git(['show', `${ref}:lib/featureRegistry.ts`], true);
  const block = source.match(/export const FEATURE_KEYS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  return new Set([...block.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1]));
}

function latestReleaseTag(ref: string) {
  return lines(git(['tag', '--merged', ref, '--sort=-version:refname'], true))
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag)) ?? null;
}

export function runReleaseCheck(options: Options) {
  verifyRef(options.productionRef);
  verifyRef(options.tstRef);

  const productionSha = git(['rev-parse', options.productionRef]);
  const tstSha = git(['rev-parse', options.tstRef]);
  const releaseTag = latestReleaseTag(options.productionRef);
  const comparisonBase = releaseTag ?? options.productionRef;
  const worktree = lines(git(['status', '--short']));
  const commits = lines(git(['log', '--format=%h %s', `${comparisonBase}..${options.tstRef}`]));
  const changedFiles = lines(git(['diff', '--name-status', comparisonBase, options.tstRef]));
  const migrations = lines(git(['diff', '--name-status', comparisonBase, options.tstRef, '--', 'prisma/migrations']));

  const productionEnvironmentNames = environmentNamesAt(comparisonBase);
  const tstEnvironmentNames = environmentNamesAt(options.tstRef);
  const newEnvironmentNames = [...tstEnvironmentNames].filter((name) => !productionEnvironmentNames.has(name)).sort();

  const productionFlags = featureKeysAt(comparisonBase);
  const tstFlags = featureKeysAt(options.tstRef);
  const flagDiff = [
    ...[...tstFlags].filter((key) => !productionFlags.has(key)).map((key) => `ADDED ${key}`),
    ...[...productionFlags].filter((key) => !tstFlags.has(key)).map((key) => `REMOVED ${key}`),
  ];
  const registryChanged = git(['diff', '--name-only', comparisonBase, options.tstRef, '--', 'lib/featureRegistry.ts'], true) !== '';
  if (registryChanged && flagDiff.length === 0) flagDiff.push('Feature registry changed; review defaults, dependencies, and entitlement behavior.');

  console.log('Neat release audit (read-only)');
  console.log(`Production: ${options.productionRef} @ ${productionSha.slice(0, 12)} (version ${versionAt(options.productionRef)})`);
  console.log(`TST:        ${options.tstRef} @ ${tstSha.slice(0, 12)} (version ${versionAt(options.tstRef)})`);
  console.log(`Release base: ${releaseTag ?? `${options.productionRef} (no strict vX.Y.Z production tag found)`}`);
  console.log(`Working tree: ${worktree.length ? `DIRTY (${worktree.length} entries)` : 'clean'}`);
  console.log(`Pending commits: ${commits.length}; changed paths: ${changedFiles.length}`);

  section('Commits since release base', commits, 'None');
  section('Changed paths', changedFiles, 'None');
  section('Migration changes', migrations, 'None');
  section('Potentially new environment variable names', newEnvironmentNames, 'None');
  section('Feature flag/registry changes', flagDiff, 'None');

  console.log('\nManifest: docs/releases/UNRELEASED.md');
  console.log('This command reports repository state only. It does not deploy, migrate, tag, or modify files.');
}

runReleaseCheck(parseOptions(process.argv.slice(2)));

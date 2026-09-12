import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Environment = Record<string, string | undefined>;

export type LoadEnvironmentFileOptions = {
  environment?: Environment;
  expandEscapedNewlines?: boolean;
  preserveExisting?: 'defined' | 'non-empty';
};

export const parseEnvironmentFile = (contents: string, { expandEscapedNewlines = false } = {}) => {
  const entries: Array<[string, string]> = [];

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.push([match[1], expandEscapedNewlines ? value.replace(/\\n/g, '\n') : value]);
  }

  return entries;
};

export function loadEnvironmentFile(filePath: string, options: LoadEnvironmentFileOptions = {}) {
  if (!existsSync(filePath)) return;

  const environment = options.environment ?? process.env;
  const preserveExisting = options.preserveExisting ?? 'defined';
  const entries = parseEnvironmentFile(readFileSync(filePath, 'utf8'), options);

  for (const [key, value] of entries) {
    const existingValue = environment[key];
    const shouldPreserve = preserveExisting === 'non-empty'
      ? Boolean(existingValue?.trim())
      : existingValue !== undefined;
    if (!shouldPreserve) environment[key] = value;
  }
}

export const loadLocalEnvironmentFile = (fileName: string, options: LoadEnvironmentFileOptions = {}) =>
  loadEnvironmentFile(path.join(process.cwd(), fileName), options);

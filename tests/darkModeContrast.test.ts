import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync('app/theme.css', 'utf8');
const colors = new Map([...stylesheet.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim().replace(/\s*!important$/, '')]));
function color(name: string): string {
  if (name.startsWith('#')) return name;
  const value = colors.get(name);
  assert.ok(value, `Missing palette color ${name}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? color(reference[1]) : value;
}
function luminance(name: string) {
  const hex = color(name).slice(1);
  assert.equal(hex.length, 6);
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground: string, background: string, minimum: number) {
  const a = luminance(foreground), b = luminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(ratio >= minimum, `${foreground} on ${background}: ${ratio.toFixed(2)} must meet ${minimum}:1`);
}

test('dark mode text, links, actions, and semantic statuses meet normal-text WCAG AA contrast', () => {
  for (const background of ['--bg', '--panel', '--panel-2', '--panel-3', '--sage']) {
    for (const foreground of ['--text', '--muted', '--accent', '--accent-hover']) contrast(foreground, background, 4.5);
  }
  for (const background of ['--action', '--action-hover']) contrast('#ffffff', background, 4.5);
  for (const status of ['success', 'warning', 'danger', 'info', 'teal', 'purple']) {
    contrast(`--theme-${status}-ink`, `--theme-${status}-surface`, 4.5);
    contrast('#ffffff', `--theme-${status}-fill`, 4.5);
  }
});

test('dark mode input boundaries and focus indicators meet non-text contrast', () => {
  for (const background of ['--bg', '--panel', '--panel-2']) {
    contrast('--line-strong', background, 3);
    contrast('--accent', background, 3);
  }
});

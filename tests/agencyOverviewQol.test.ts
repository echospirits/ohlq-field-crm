import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { PrismaClient } from '@prisma/client';
import { AgencyCurrentInventoryView, type CurrentInventoryProduct } from '../app/agencies/AgencyCurrentInventoryView';
import { OhioAgencyNumber } from '../app/agencies/OhioAgencyNumber';
import { getCurrentAgencyInventory } from '../lib/ohlqAgencyInventory';
import { getTenantConfig } from '../lib/tenantConfig';

test('Ohio agency identity preserves the authoritative text identifier directly below the name', () => {
  const number = renderToStaticMarkup(createElement(OhioAgencyNumber, { agencyId: '030712', state: 'OH' }));
  assert.equal(number, '<p class="account-kind muted">Agency #030712</p>');
  const page = readFileSync('app/agencies/[id]/page.tsx', 'utf8');
  assert.match(page, /<h1>\{agency\.name\}<\/h1><OhioAgencyNumber agencyId=\{agency\.agencyId\} state=\{agency\.state\}/);
  assert.match(page, /agency\.state !== 'OH' \? <p><strong>Retail ID/);
});

test('non-Ohio and missing identifiers render no agency-number placeholder', () => {
  for (const props of [{ agencyId: 'ABC-FL-003', state: 'FL' }, { agencyId: '30712', state: null }, { agencyId: '', state: 'OH' }]) {
    assert.equal(renderToStaticMarkup(createElement(OhioAgencyNumber, props)), '');
  }
});

const product: CurrentInventoryProduct = {
  itemCode: '2847B', itemName: 'Example product with a long descriptive name', status: 'Active', coverageGroup: 'Group 1',
  onHand: 0, minimum: null, snapshotDate: new Date('2026-11-03T00:00:00Z'),
};

test('current inventory retains stock, minimum, source status and freshness while distinguishing unknown from zero', () => {
  const html = renderToStaticMarkup(createElement(AgencyCurrentInventoryView, { products: [product] }));
  assert.match(html, /<h2 id="current-inventory-heading">Current Inventory<\/h2>/);
  assert.match(html, /Example product with a long descriptive name/);
  assert.match(html, /2847B · Active · Group 1/);
  assert.match(html, /<td class="numeric">0<\/td><td class="numeric">Unknown<\/td>/);
  assert.match(html, /As of Nov 3, 2026/);
  assert.match(html, /role="region" aria-label="Current inventory comparison" tabindex="0"/);
});

test('missing inventory and failed inventory reads are distinct from zero stock', () => {
  const empty = renderToStaticMarkup(createElement(AgencyCurrentInventoryView, { products: [] }));
  assert.match(empty, /No current inventory is recorded for this agency/);
  assert.match(empty, /No data/);
  assert.doesNotMatch(empty, /<td/);
  const error = renderToStaticMarkup(createElement(AgencyCurrentInventoryView, { products: [], unavailable: true }));
  assert.match(error, /role="status">Current inventory could not be loaded\. Refresh to try again/);
  assert.doesNotMatch(error, /No current inventory is recorded/);
});

test('current inventory uses the oldest row source date when input dates differ', () => {
  const html = renderToStaticMarkup(createElement(AgencyCurrentInventoryView, { products: [product, {
    ...product, itemCode: 'OTHER', snapshotDate: new Date('2026-10-01T00:00:00Z'),
  }] }));
  assert.match(html, /As of Oct 1, 2026/);
  assert.match(html, /freshness-stale/);
});

test('current inventory query uses each organization product filter and the existing current table', async () => {
  const calls: Array<{ where: { agencyNumber: string; AND: Array<Record<string, unknown>> } }> = [];
  const db = { ohlqAgencyInventoryCurrent: { findMany: async (args: typeof calls[number]) => {
    calls.push(args);
    return [];
  } } } as unknown as PrismaClient;
  const otherConfig = getTenantConfig({ NODE_ENV: 'test', TENANT_ID: 'another-tenant', TENANT_PRODUCT_FILTER_MODE: 'item-list', TENANT_ITEM_CODES: 'OTHER-1' });
  const echoConfig = getTenantConfig({ NODE_ENV: 'test', TENANT_ID: 'echo', TENANT_PRODUCT_FILTER_MODE: 'item-list', TENANT_ITEM_CODES: '2847B' });
  await getCurrentAgencyInventory({ agencyNumber: '030712', config: otherConfig, db, organizationId: 'org-other' });
  await getCurrentAgencyInventory({ agencyNumber: '030712', config: echoConfig, db, organizationId: 'org-echo' });
  assert.equal(calls[0].where.agencyNumber, '030712');
  assert.deepEqual(calls[0].where.AND[0], { organizationId: 'org-other' });
  assert.deepEqual(calls[0].where.AND[1], { itemCode: { in: ['OTHER-1'] } });
  assert.deepEqual(calls[1].where.AND[0], { organizationId: 'org-echo' });
  assert.deepEqual(calls[1].where.AND[1], { itemCode: { in: ['2847B'] } });
  assert.match(JSON.stringify(calls[0].where.AND[2]), /A3A DISTILLERY ONLY/);
});

test('Overview inventory loader reuses the existing service and returns a recoverable error state', async () => {
  const filename = resolve('app/agencies/AgencyCurrentInventory.tsx');
  const require = createRequire(filename);
  const exports: Record<string, any> = {};
  const config = getTenantConfig({ NODE_ENV: 'test', TENANT_ID: 'other' });
  let fail = false;
  const calls: unknown[] = [];
  const mocks: Record<string, unknown> = {
    '../../lib/ohlqAgencyInventory': { getCurrentAgencyInventory: async (args: unknown) => {
      calls.push(args);
      if (fail) throw new Error('database unavailable');
      return [product];
    } },
    './AgencyCurrentInventoryView': { AgencyCurrentInventoryView },
    './agency-current-inventory.css': {},
  };
  runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => name in mocks ? mocks[name] : require(name) });
  const props = { agencyNumber: '030712', config, organizationId: 'org-other' };
  assert.match(renderToStaticMarkup(await exports.AgencyCurrentInventory(props)), /2847B/);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(props));
  fail = true;
  assert.match(renderToStaticMarkup(await exports.AgencyCurrentInventory(props)), /could not be loaded/);
});

test('inventory appears once near the top of Ohio Overview without an Intelligence entitlement', () => {
  const page = readFileSync('app/agencies/[id]/page.tsx', 'utf8');
  const overview = page.indexOf("id: 'overview'");
  const inventory = page.indexOf('<AgencyCurrentInventory ', overview);
  assert.ok(inventory > overview && inventory < page.indexOf('<AccountMemoryPanel', overview));
  assert.equal(page.match(/<AgencyCurrentInventory /g)?.length, 1);
  assert.match(page.slice(overview, inventory), /agency\.state === 'OH'/);
  assert.doesNotMatch(page.slice(overview, inventory), /hasAgencyIntelligence/);
  assert.doesNotMatch(readFileSync('app/agencies/AgencyIntelligencePanel.tsx', 'utf8'), /id="current-inventory"/);
});

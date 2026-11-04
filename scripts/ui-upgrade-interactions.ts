// Hydrated acceptance of actual filter/picker components, with local React UMD.
// Synthetic records only. No Next server, credentials, actions or provider calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright';
import ts from 'typescript';

export async function runTimelineFilterAcceptance(page: Page, css: string) {
  const require = createRequire(import.meta.url);
  const react = readFileSync(join(dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
  const dom = readFileSync(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
  const compile = (path: string) => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const pickerCode = compile('app/components/RecordPicker.tsx');
  const filterCode = compile('app/visits/ActivityTimelineFilter.tsx');
  const escape = (code: string) => code.replace(/<\/script/gi, '<\\/script');
  const mount = `
    const picker = {}, filter = {};
    new Function('require','exports', ${JSON.stringify(pickerCode)})(name => { if(name==='react')return React; throw Error(name); }, picker);
    new Function('require','exports', ${JSON.stringify(filterCode)})(name => { if(name==='react')return React;if(name==='../components/RecordPicker')return picker;throw Error(name); }, filter);
    const entries = [
      {id:'one',type:'visit',source:'manual',staff:'Sam Walker',contacts:['buyer'],opportunity:'Winter menu',at:'2026-11-04T12:00:00Z'},
      {id:'two',type:'call',source:'worklist',staff:'Alex Reynolds',contacts:['manager'],opportunity:'Spring menu',at:'2026-11-03T12:00:00Z'},
      {id:'three',type:'visit',source:'manual',staff:'Sam Walker',contacts:[],opportunity:'',at:'2026-11-02T12:00:00Z'}
    ];
    ReactDOM.createRoot(document.getElementById('filter-fixture')).render(React.createElement(filter.ActivityTimelineFilter,{entries,contacts:{buyer:'Taylor Buyer',manager:'Morgan Manager'}},entries.map(e=>React.createElement('article',{key:e.id},e.id+' synthetic activity'))));
  `;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main><h1>History interaction fixture</h1><div id="filter-fixture"></div></main><script>${escape(react)}</script><script>${escape(dom)}</script><script>${escape(mount)}</script></body></html>`);
  await page.getByText('3 of 3 loaded records', { exact: false }).waitFor();
  await page.locator('.compact-details > summary').first().click();
  const choose = async (name: string, label: string) => {
    const picker = page.locator('.record-picker').filter({ has: page.locator(`input[name="${name}"]`) });
    await picker.locator('summary').click();
    await picker.getByRole('button', { name: label, exact: true }).click();
  };
  await choose('historyType', 'visit');
  await choose('historySource', 'manual');
  await choose('historyStaff', 'Sam Walker');
  await choose('historyContact', 'Taylor Buyer');
  await choose('historyOpportunity', 'Winter menu');
  await page.getByLabel('From date (UTC)', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Through date (UTC)', { exact: true }).fill('2026-11-05');
  await page.getByText('1 of 3 loaded records', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByText('3 of 3 loaded records', { exact: false }).waitFor();
  assert.deepEqual(await page.locator('.record-picker input[type="hidden"]').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value)), ['', '', '', '', '']);
  assert.equal(await page.getByLabel('From date (UTC)', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Through date (UTC)', { exact: true }).inputValue(), '');
  for (const label of ['All types', 'All sources', 'All staff', 'All contacts', 'All opportunities']) assert.ok(await page.getByText(label, { exact: true }).first().isVisible());
  await choose('historyType', 'call');
  await page.getByText('1 of 3 loaded records', { exact: false }).waitFor();
  const firstPicker = page.locator('.record-picker').first();
  await firstPicker.locator('summary').click();
  await firstPicker.getByRole('searchbox').press('Escape');
  assert.equal(await firstPicker.locator('details').getAttribute('open'), null);
  assert.ok(await firstPicker.locator('summary').evaluate(node => node === document.activeElement));
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByText('3 of 3 loaded records', { exact: false }).waitFor();
  return { hydrated: true, pickerSelectionsReset: 5, dateFiltersReset: 2, recordsRestored: 3, reselection: 'passed', escapeFocusReturn: 'passed' };
}

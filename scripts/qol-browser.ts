// Actual hydrated components with synthetic data and deterministic action adapters.
// No application server, provider calls, credentials, or live CRM writes.
// Run: npx tsx scripts/qol-browser.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const output = resolve('output/playwright/qol-20261104');
const cssPaths = ['app/styles.css', 'app/crm/crm.css', 'app/redesign.css', 'app/theme.css', 'app/field-workspace.css', 'app/workspace-foundation.css', 'app/field-data.css', 'app/daily-work.css'];

async function bundleFixture() {
  return build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', outfile: 'qol-fixture.js',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AppSidebarNavigation, MobileTabbar } from './app/components/AppNavigation';
      import { AccountWorkspace } from './app/components/AccountWorkspace';
      import { AgencyCurrentInventoryView } from './app/agencies/AgencyCurrentInventoryView';
      import { OhioAgencyNumber } from './app/agencies/OhioAgencyNumber';
      import './app/agencies/agency-current-inventory.css';
      import { RelatedWorkPrompt } from './app/visits/confirmed/RelatedWorkPrompt';
      import { WorklistScheduler } from './app/my-week/WorklistScheduler';
      const root = createRoot(document.getElementById('fixture-root'));
      const actor = 'rep-one';
      const task = (index, dueDate, dueTimeMinutes = null) => ({
        id: 'task-' + index, dueDate, dueTimeMinutes, status: index % 2 ? 'IN_PROGRESS' : 'OPEN',
        title: ['Confirm November tasting and seasonal shelf display with the beverage manager', 'Deliver requested samples and review the restaurant winter cocktail menu', 'Call buyer after inventory count'][index % 3],
        detail: 'Review the agreed next step before completing this task.', updatedAt:'2026-11-03T12:00:00.000Z', category:'AGENCY',
        agencyId:'agency-one', wholesaleAccountId:null, salesOpportunityId:null, agencyProductIntelligenceId:null,
        productItemCode:null, productName:null, assignedToUserId:actor, assignedTo:'Sam Walker', isTargeting:index===0,
        location:{id:'agency-one',name:index===1?'North Market Wine, Spirits and Specialty Beverages with a long account name':'Arena Wine & Spirits',type:'agency',href:'/agencies/agency-one',businessHours:null},
      });
      const overdue = [task(0,'2026-10-29'),task(1,'2026-10-30'),task(2,null),task(3,'2026-10-31')];
      const scheduled = [task(4,'2026-11-04',9*60),task(5,'2026-11-04'),task(6,'2026-11-05',14*60)];
      const products = [
        {itemCode:'2847B',itemName:'Echo Spirits Straight Bourbon Whiskey',status:'Active',coverageGroup:'Group 1',onHand:12,minimum:6,snapshotDate:new Date('2026-11-03T00:00:00Z')},
        {itemCode:'9999B',itemName:'A very long organization product name that must wrap cleanly without obscuring current stock',status:'Active',coverageGroup:null,onHand:0,minimum:6,snapshotDate:new Date('2026-11-03T00:00:00Z')},
        {itemCode:'OTHER',itemName:'Unconfirmed inventory quantity',status:'Unavailable',coverageGroup:null,onHand:null,minimum:null,snapshotDate:new Date('2026-10-01T00:00:00Z')},
      ];
      const related = overdue.slice(0,3).map(item=>({id:item.id,title:item.title,detail:item.detail,dueDate:item.dueDate,assignedTo:item.assignedTo}));
      const fixture = window.fixture = {
        version:0, calls:[], refreshes:0, pending:[], promptMode:'success', surface:'agency', scenario:'populated',
        async action(kind,data) {
          const values = Object.fromEntries(data.entries());
          if(kind==='related') values.worklistItemIds=data.getAll('worklistItemId');
          this.calls.push({kind,...values});
          if(kind==='related' && this.promptMode==='pending') return new Promise(resolve=>this.pending.push(resolve));
          if(kind==='related' && this.promptMode==='error') return {completedIds:[],error:'Could not complete related work. Try again.'};
          return kind==='related' ? {completedIds:data.getAll('worklistItemId')} : {success:'Task completed.'};
        },
        render(surface,scenario='populated') { this.surface=surface;this.scenario=scenario;this.calls=[];this.refreshes=0;this.pending=[];this.version++;root.render(<Shell key={this.version}/>); },
      };
      const permissions={enabledFeatures:['AGENCY_INTELLIGENCE','WHOLESALE_OPPORTUNITIES','ACCOUNT_SALES_STATUS'],isAdmin:true,isPlatformAdmin:false,isTaster:false};
      function Agency(){
        const state=fixture.scenario==='non-ohio'?'FL':'OH';
        const inventory=fixture.scenario==='empty'?[]:products;
        return <><header className="page-heading page-header account-workspace-heading"><div><h1>Arena Wine &amp; Spirits</h1><OhioAgencyNumber agencyId="030712" state={state}/><p className="account-kind">Retail · Columbus</p><p className="account-location">100 Example Street, Columbus, OH 43215</p></div><div className="page-heading-actions"><button>Log visit</button></div></header>
          <AccountWorkspace panels={[{id:'overview',label:'Overview',content:<><AgencyCurrentInventoryView products={inventory} unavailable={fixture.scenario==='error'}/><section className="workspace-section"><h2>Contacts</h2><p>Taylor Buyer · Beverage manager</p></section></>},{id:'sales',label:'Sales',content:<h2>Existing sales view</h2>},{id:'intelligence',label:'Intelligence',content:<h2>Existing intelligence view</h2>}]} /></>;
      }
      function Shell(){
        const surface=fixture.surface;
        React.useLayoutEffect(()=>{document.body.dataset.fixtureVersion=String(fixture.version);},[]);
        return <><div className="environment-banner">Neat · synthetic QOL acceptance · no records saved</div><aside><div className="app-brand"><strong>Neat</strong><span>Echo Spirits</span></div><AppSidebarNavigation {...permissions}/><div className="user-card"><strong>Sam Walker</strong><span>Sales representative</span></div></aside>
          <main id="main-content"><header className="app-desktop-topbar"><span>Echo Spirits</span><span>QOL acceptance · 0.7.0</span></header>
            {surface==='agency'?<Agency/>:surface==='scheduler'?<><header className="page-heading"><h1>My Day</h1></header><WorklistScheduler view={fixture.scenario==='week'?'week':'day'} anchorDate="2026-11-04" items={fixture.scenario==='day-empty'?overdue:[...overdue,...scheduled]} currentUserId={actor} users={[{id:actor,name:'Sam Walker'}]} updateAction={data=>fixture.action('schedule',data)} completeAction={data=>fixture.action('complete',data)} createAction={data=>fixture.action('create',data)}/></>:<><h1>Visit logged</h1><p className="toast-notice" role="status">Visit logged.</p><a href="/agencies/agency-one" className="btn secondary">Return to account</a><RelatedWorkPrompt visitId="visit-one" initialItems={fixture.scenario==='empty'?[]:related} completeAction={data=>fixture.action('related',data)}/></>}
          </main><MobileTabbar {...permissions}/></>;
      }
      fixture.render('agency');
    ` },
    plugins: [{ name: 'next-fixture-adapters', setup(builder) {
      builder.onResolve({ filter: /^(next\/link|next\/navigation|react-dom)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'next/link'
        ? `import React from ${JSON.stringify(require.resolve('react'))}; export default function Link({children,...props}){return React.createElement('a',props,children);}`
        : args.path === 'next/navigation'
          ? `export const unstable_rethrow=()=>{};export const usePathname=()=>window.fixture?.surface==='agency'?'/agencies/agency-one':'/';export const useRouter=()=>({refresh:()=>window.fixture.refreshes++});`
          // React 18 outside Next lacks useFormStatus. The real ActionPendingContext,
          // ActionForm submission guard, and every component action remain active.
          : `export * from ${JSON.stringify(require.resolve('react-dom'))};export const useFormStatus=()=>({pending:false});`, loader: 'js', resolveDir: process.cwd() }));
    } }],
  });
}

async function mount(page: Page, surface: string, scenario = 'populated') {
  const version = await page.evaluate(({ surface, scenario }) => {
    (window as any).fixture.render(surface, scenario);
    return (window as any).fixture.version as number;
  }, { surface, scenario });
  await page.waitForFunction(version => document.body.dataset.fixtureVersion === String(version), version);
  await page.waitForFunction(({ surface, scenario }) => {
    if (surface === 'agency') return Boolean(document.querySelector('#current-inventory'));
    if (surface === 'scheduler') return Boolean(document.querySelector(scenario === 'day-empty' ? '.worklist-scheduler-empty' : '.scheduler-calendar'));
    return scenario === 'empty' ? !document.querySelector('[role="dialog"]') : Boolean(document.querySelector('[aria-labelledby="related-work-title"]'));
  }, { surface, scenario });
}

async function dimensions(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const lists = [...document.querySelectorAll('.scheduler-task-list')].filter(visible).map(list => {
      const rows = [...list.querySelectorAll('.scheduler-tray-item')].filter(visible).map(row => {
        const rect = row.getBoundingClientRect();return {left:rect.left,width:rect.width,top:rect.top,bottom:rect.bottom,height:rect.height};
      });
      return { rows, gaps: rows.slice(1).map((row,index)=>row.top-rows[index].bottom) };
    });
    const targets = [...document.querySelectorAll('.scheduler-task-list button, [aria-labelledby="related-work-title"] button:not(.app-modal-backdrop)')].filter(visible).map(element=>({text:element.textContent,height:element.getBoundingClientRect().height}));
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,width:document.documentElement.scrollWidth,lists,targets};
  });
}

async function main() {
  mkdirSync(output, { recursive: true });
  const bundle = await bundleFixture();
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? '';
  const css = cssPaths.map(path => readFileSync(path, 'utf8')).join('\n') + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  // Mount into body so the real body > main/aside shell selectors apply.
  const html = `<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neat QOL synthetic acceptance</title><style>${css}</style></head><body id="fixture-root" class="has-environment-banner"><script>globalThis.__name=value=>value;</script><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
  writeFileSync(`${output}/fixture.html`, html);
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({headless:true,...(existsSync(chromePath)?{executablePath:chromePath}:{})});
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors: string[] = [], failures: string[] = [], checks: unknown[] = [], interactions: string[] = [];
  page.on('pageerror', error=>errors.push(error.message));
  try {
    await page.setContent(html, {waitUntil:'load'});
    await page.getByRole('heading',{name:'Arena Wine & Spirits',exact:true}).waitFor();
    for (const theme of ['light','dark']) for (const [label,width,height] of [['narrow',320,844],['mobile',390,844],['desktop',1440,900]] as const) {
      await page.setViewportSize({width,height});
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      for (const [surface,scenario] of [['agency','populated'],['scheduler','day-empty'],['scheduler','day-populated'],['scheduler','week'],['related','populated']]) {
        await mount(page,surface,scenario);
        const metrics=await dimensions(page);
        if(metrics.overflow)failures.push(`${surface}/${scenario}/${label}/${theme}: page overflow ${metrics.width}`);
        for(const list of metrics.lists)if(list.rows.length>1){
          if(list.rows.some(row=>Math.abs(row.left-list.rows[0].left)>1||Math.abs(row.width-list.rows[0].width)>1))failures.push(`${scenario}/${label}/${theme}: staggered task rows`);
          if(list.gaps.some(gap=>Math.abs(gap-8)>1))failures.push(`${scenario}/${label}/${theme}: inconsistent task gaps ${JSON.stringify(list.gaps)}`);
        }
        if(width<=390&&metrics.targets.some(target=>target.height<43.9))failures.push(`${surface}/${scenario}/${label}/${theme}: touch target below 44px`);
        const name=`${surface}-${scenario}-${label}-${theme}`;
        await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
        if(label==='mobile'||label==='desktop')await page.screenshot({path:`${output}/${name}-viewport.png`});
        checks.push({surface,scenario,theme,viewport:`${width}x${height}`,...metrics});
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    for(const scenario of ['empty','error','non-ohio']){
      await mount(page,'agency',scenario);
      if(scenario==='empty')assert.ok(await page.getByText('No current inventory is recorded for this agency.').isVisible());
      if(scenario==='error')assert.ok(await page.getByText('Current inventory could not be loaded. Refresh to try again.').isVisible());
      if(scenario==='non-ohio')assert.equal(await page.getByText('Agency #030712').count(),0);
      await page.screenshot({path:`${output}/agency-${scenario}-mobile-light.png`,fullPage:true});
    }
    await mount(page,'agency');
    assert.ok(await page.getByText('Agency #030712',{exact:true}).isVisible());
    await page.getByRole('tab',{name:'Intelligence',exact:true}).click();
    assert.ok(await page.getByRole('heading',{name:'Existing intelligence view'}).isVisible());
    assert.equal(await page.locator('#current-inventory:visible').count(),0);
    await page.getByRole('tab',{name:'Overview',exact:true}).click();
    assert.ok(await page.getByRole('heading',{name:'Current Inventory',exact:true}).isVisible());
    interactions.push('Ohio leading-zero identifier, non-Ohio omission, inventory empty/error/freshness/status, and retained tab state');

    for(const scenario of ['day-empty','day-populated','week']){
      await mount(page,'scheduler',scenario);
      const first=page.locator('.scheduler-task-list:visible .scheduler-tray-item').first();
      await first.click();
      const dialog=page.getByRole('dialog');
      await dialog.getByRole('button',{name:'Complete',exact:true}).click();
      await dialog.waitFor({state:'detached'});
      const state=await page.evaluate(()=>({calls:(window as any).fixture.calls,refreshes:(window as any).fixture.refreshes}));
      assert.equal(state.calls[0].kind,'complete');assert.equal(state.calls[0].id,'task-0');assert.equal(state.refreshes,1);
      await first.click();
      await page.getByRole('dialog').getByRole('button',{name:'Tomorrow',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Save schedule',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'detached'});
      assert.equal((await page.evaluate(()=>(window as any).fixture.calls))[1].kind,'schedule');
    }
    interactions.push('Empty-day, populated-day and week overdue cards open task actions; Complete and Save schedule call actual ActionForm paths');

    await mount(page,'related','empty');assert.equal(await page.getByRole('dialog').count(),0);
    await mount(page,'related');assert.equal((await page.evaluate(()=>(window as any).fixture.calls)).length,0);
    await page.getByRole('button',{name:'Complete',exact:true}).first().click();
    await page.getByRole('button',{name:'Complete all (2)',exact:true}).waitFor();
    assert.deepEqual((await page.evaluate(()=>(window as any).fixture.calls))[0].worklistItemIds,['task-0']);
    await page.getByRole('button',{name:'Complete all (2)',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'detached'});
    assert.deepEqual((await page.evaluate(()=>(window as any).fixture.calls))[1].worklistItemIds,['task-1','task-2']);
    await mount(page,'related');await page.getByRole('button',{name:'Leave open',exact:true}).click();
    assert.equal((await page.evaluate(()=>(window as any).fixture.calls)).length,0);
    await mount(page,'related');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
    assert.equal((await page.evaluate(()=>(window as any).fixture.calls)).length,0);
    await mount(page,'related');await page.evaluate(()=>(window as any).fixture.promptMode='error');
    await page.getByRole('button',{name:'Complete',exact:true}).first().click();
    await page.getByRole('alert').getByText('Could not complete related work. Try again.').waitFor();
    assert.equal(await page.getByRole('button',{name:'Complete',exact:true}).count(),3);
    await page.screenshot({path:`${output}/related-error-mobile-light.png`,fullPage:true});
    await mount(page,'related');await page.evaluate(()=>(window as any).fixture.promptMode='pending');
    await page.getByRole('button',{name:'Complete all (3)',exact:true}).click();
    await page.getByRole('button',{name:'Completing…',exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'Completing…',exact:true}).isDisabled());
    for(const button of await page.getByRole('button',{name:'Complete',exact:true}).all())assert.ok(await button.isDisabled());
    assert.equal((await page.evaluate(()=>(window as any).fixture.calls)).length,1);
    await page.screenshot({path:`${output}/related-pending-mobile-light.png`,fullPage:true});
    await page.evaluate(()=>(window as any).fixture.pending.shift()({completedIds:['task-0','task-1','task-2']}));
    await page.getByRole('dialog').waitFor({state:'detached'});
    interactions.push('Related-work zero-item omission, safe default, individual/all completion, leave-open and Escape without writes, recoverable error, pending guard and success dismissal');
    writeFileSync(`${output}/results.json`,JSON.stringify({fixtureOnly:true,frameworkAdapters:['Next Link/router','React 18 useFormStatus false; actual ActionPendingContext retained'],checks,interactions,errors,failures},null,2));
    assert.deepEqual(errors,[],'browser runtime errors');assert.deepEqual(failures,[],'responsive acceptance');
    console.log(`PASS: ${checks.length} actual-component captures; 320/390/1440 widths, light/dark; all interaction checks passed. Synthetic fixtures only.`);
  } catch(error) {
    writeFileSync(`${output}/results.json`,JSON.stringify({fixtureOnly:true,checks,interactions,errors,failures,error:String(error)},null,2));
    throw error;
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

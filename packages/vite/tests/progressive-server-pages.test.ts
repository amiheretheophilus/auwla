import {afterEach,expect,it} from 'bun:test';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBuilder} from 'vite';
import puppeteer from 'puppeteer-core';
import {createDevServer,type NativeDevServer} from '../src/dev';
import memoizedDom from '../src';

const repository=resolve(import.meta.dirname,'../../..');
const chrome=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find((path):path is string=>!!path&&existsSync(path));
let fixture:string|undefined,vite:NativeDevServer|undefined,host:ReturnType<typeof Bun.serve>|undefined;
afterEach(async()=>{await vite?.close();vite=undefined;await host?.stop(true);host=undefined;if(fixture)await rm(fixture,{recursive:true,force:true});fixture=undefined;});

it.skipIf(!chrome).each(['development','production'] as const)('fills nested server-page regions without resetting native input in %s SSR streaming',async(mode)=>{
  fixture=await mkdtemp(resolve(tmpdir(),'memoized-progressive-pages-'));
  const files:Record<string,string>={
    'index.html':`<!doctype html><html><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.ts"></script></body></html>`,
    'main.ts':`import '@memoized-dom/runtime/hydrate';import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App,{onHydrateError:error=>console.error('Hydration failed: '+String(error))});`,
    'server/define.ts':`import {createDefine} from '@memoized-dom/server';export const define=createDefine();export {page} from '@memoized-dom/server';`,
    'server/functions/pages.tsx':`import {define,page} from '../define';import {Overview} from '../Overview';export const getOverview=define.function({async get(){return page(<Overview/>);}});`,
    'server/Overview.tsx':`import {Group} from '@memoized-dom/data';function Loading(){return <span data-pending>Loading section</span>}
      export function Overview(){const summary=$fetch('/summary'),notes=$fetch('/notes');return <section><h2 data-heading>Available immediately</h2><input data-draft value="initial"/>
        <Group pending={Loading}><article><h3>Summary</h3><p data-summary>{summary.label}: {summary.count}</p><p data-atomic-summary suspend>{summary.label}: {summary.count}</p></article></Group><Group pending={Loading}><aside><p data-notes>{notes.label}</p></aside></Group></section>}`,
    'App.tsx':`import {getOverview} from '#server-functions';export function App(){const overview=getOverview();let clicks=0;return <main><h1>Shell</h1>{overview}{overview}<button data-local onClick={()=>clicks++}>{clicks}</button></main>}`,
    'server.ts':`import {serve} from '@memoized-dom/server';import {define} from './server/define';import {App} from './App';
      const gates={summary:Promise.withResolvers(),notes:Promise.withResolvers()};const app=serve({define});
      app.get('/summary',async()=>{await gates.summary.promise;return {label:'Summary ready',count:7}});
      app.get('/notes',async()=>{await gates.notes.promise;return {label:'Notes ready'}});
      app.get('/release-summary',()=>{gates.summary.resolve();return 'ok'});app.get('/release-notes',()=>{gates.notes.resolve();return 'ok'});
      app.ssr('/',App,{mode:'stream'});export default app;`,
  };
  for(const [name,source] of Object.entries(files)){const file=resolve(fixture,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,source);}
  const aliases=['runtime/server','runtime/hot','runtime/hydrate-program','runtime/hydrate','runtime','data/internal','data','router/internal','router','server/internal','server/router','server','adapters/bun'].map(name=>({find:'@memoized-dom/'+name,replacement:resolve(repository,'packages',name.split('/')[0]!,'src',name.includes('/')?(name.endsWith('/router')?'http-router':name.split('/')[1]!)+'.ts':'index.ts')}));
  const config={root:fixture,configFile:false as const,logLevel:'silent' as const,resolve:{alias:aliases},plugins:[memoizedDom({clientEntry:'main.ts',serverEntry:'server.ts'})],server:{host:'127.0.0.1',port:0}};
  let origin:string;
  if(mode==='development'){vite=await createDevServer(config);origin=vite.origin;}
  else{const builder=await createBuilder(config);await builder.buildApp();const backend=await import(/* @vite-ignore */pathToFileURL(resolve(fixture,'dist/server.js')).href);host=Bun.serve({hostname:'127.0.0.1',port:0,fetch:backend.default.fetch});origin=host.url.origin;}
  const browser=await puppeteer.launch({executablePath:chrome!,headless:true});
  try{
    const tab=await browser.newPage(),errors:string[]=[],requests:string[]=[];
    tab.on('console',message=>{if(message.text().startsWith('Hydration failed:'))errors.push(message.text());});
    tab.on('pageerror',error=>errors.push(String(error)));tab.on('request',request=>{if(request.url().includes('/_fn/'))requests.push(request.url());});
    const navigating=tab.goto(origin,{waitUntil:'domcontentloaded',timeout:30_000});
    // Handle early failures while the parser deliberately remains open.
    void navigating.catch(()=>{});
    await tab.waitForSelector('[data-heading]',{timeout:15_000});
    expect(await tab.$$('[data-heading]')).toHaveLength(2);
    expect(await tab.$$('[data-pending]')).toHaveLength(8);
    expect(await tab.$$('[data-atomic-summary]')).toHaveLength(0);
    await tab.type('[data-draft]',' USER');
    const typed=await tab.$eval('[data-draft]',node=>(node as HTMLInputElement).value);
    await tab.evaluate(()=>{(window as unknown as {draft:Element|null}).draft=document.querySelector('[data-draft]');});
    await fetch(origin+'/release-summary');
    await tab.waitForFunction(()=>document.querySelector('[data-summary]')?.textContent==='Summary ready: 7',{timeout:10_000});
    expect(await tab.$$eval('[data-summary]',nodes=>nodes.map(node=>node.textContent))).toEqual(['Summary ready: 7','Summary ready: 7']);
    expect(await tab.$$('[data-summary] [data-pending]')).toHaveLength(0);
    expect(await tab.$$('[data-notes] [data-pending]')).toHaveLength(2);
    expect(await tab.$$eval('[data-atomic-summary]',nodes=>nodes.map(node=>node.textContent))).toEqual(['Summary ready: 7','Summary ready: 7']);
    expect(await tab.$$('[data-pending]')).toHaveLength(2);
    expect(await tab.$eval('[data-draft]',node=>(node as HTMLInputElement).value)).toBe(typed);
    expect(await tab.evaluate(()=>document.querySelector('[data-draft]')===(window as unknown as {draft:Element}).draft)).toBe(true);
    expect(await tab.evaluate(()=>document.activeElement===document.querySelector('[data-draft]'))).toBe(true);
    await fetch(origin+'/release-notes');await navigating;
    await tab.waitForFunction(()=>typeof(document.querySelector('[data-local]') as HTMLButtonElement|null)?.onclick==='function',{timeout:15_000});
    expect(await tab.$eval('[data-notes]',node=>node.textContent)).toBe('Notes ready');
    expect(await tab.$eval('[data-draft]',node=>(node as HTMLInputElement).value)).toBe(typed);
    expect(await tab.evaluate(()=>document.querySelector('[data-draft]')===(window as unknown as {draft:Element}).draft)).toBe(true);
    expect(await tab.evaluate(()=>document.activeElement===document.querySelector('[data-draft]'))).toBe(true);
    await tab.click('[data-local]');await tab.waitForFunction(()=>document.querySelector('[data-local]')?.textContent==='1');
    expect(requests).toEqual([]);expect(errors).toEqual([]);
  }finally{await browser.close();}
},60_000);

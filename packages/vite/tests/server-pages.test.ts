import { afterEach, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBuilder } from 'vite';
import puppeteer from 'puppeteer-core';
import { createDevServer, type NativeDevServer } from '../src/dev';
import memoizedDom from '../src';
import { decodePageHtml } from '../../runtime/src/page-html';
import type { SerializedSourceRecord } from '@memoized-dom/data';

const repository=resolve(import.meta.dirname,'../../..');
const chrome=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find((path):path is string=>!!path&&existsSync(path));
let fixture:string|undefined, vite:NativeDevServer|undefined;
let productionHost:ReturnType<typeof Bun.serve>|undefined;
afterEach(async()=>{await vite?.close();vite=undefined;await productionHost?.stop(true);productionHost=undefined;if(fixture)await rm(fixture,{recursive:true,force:true});fixture=undefined;});

function assertSettledPageSsr(html:string, streamed:boolean):void {
  expect(html).toMatch(/<h1[^>]*>Ada<\/h1>/);
  expect(html).not.toContain('SERVER_SECRET');
  const records=new Map<string,SerializedSourceRecord>();
  for(const match of html.matchAll(/<script\b[^>]*\btype="application\/mmd\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const payload=JSON.parse(match[1]!) as {state?:{sources:SerializedSourceRecord[]};sources?:SerializedSourceRecord[]};
    for(const record of payload.state?.sources ?? payload.sources ?? []) {
      if(record.contractId==='mmd-fetch/v1:page:1')records.set(record.sourceId,record);
    }
  }
  expect(records.size, 'SSR must transfer the generated page source').toBe(1);
  for(const record of records.values()) {
    expect(record.snapshot.status, JSON.stringify(record)).toBe('success');
    if(record.snapshot.status==='success')expect(record.snapshot.data).toMatchObject({$mmd:'page',html:expect.stringContaining('Ada')});
  }
  if(!streamed)expect(html).not.toContain('Waiting for server UI');
}

it.each(['development','production','development-stream'] as const)('delivers finite and live server pages in %s, binds interactions and keeps secrets off the wire',async(mode)=>{
  fixture=await mkdtemp(resolve(tmpdir(),'memoized-dom-pages-'));
  const files:Record<string,string>={
    'index.html':`<!doctype html><html><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.ts"></script></body></html>`,
    'main.ts':`import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    'server/define.ts':`import {createDefine} from '@memoized-dom/server';export const define=createDefine();export {page} from '@memoized-dom/server';`,
    'server/functions/boards.tsx':`import {define,page} from '../define';import {Board} from '../../Board.tsrx';
      let count=0;
      export const getBoard=define.function({live:()=>['board'],async get(){const user={name:'Ada',hint:'Event-only',password:'SERVER_SECRET'},subtitle=undefined;return page(<Board count={count} user={user} subtitle={subtitle}/>);}});
      export const saveBoard=define.function({updates:()=>['board'],async post(){count++;const user={name:'Saved',hint:'Event-only',password:'SERVER_SECRET'},subtitle=undefined;return page(<Board count={count} user={user} subtitle={subtitle}/>);}});
      export const getDenied=define.function({async get(){return page(<p data-denied>Denied</p>);}});`,
    'Board.tsrx':`import './board.css';export function Board({count,user,subtitle='No subtitle'}) @{let expanded=false;let hint='';function reveal(){hint=user.hint}<section class="board" data-board><style>.board{color:rgb(12,34,56);}</style><h1>{user.name}</h1><small data-subtitle>{subtitle}</small><p data-count>{count}</p><input data-local-input value="initial"/><button data-reveal onClick={reveal}>Reveal</button><p data-hint>{hint}</p><button data-toggle onClick={async()=>{await Promise.resolve();expanded=!expanded}}>Toggle</button>{expanded&&<p data-expanded>Expanded</p>}</section>}`,
    'board.css':`[data-count]{font-weight:700;}`,
    'App.tsx':`import {getBoard,saveBoard,getDenied} from '#server-functions';import {Group} from '@memoized-dom/data';
      function Loading(){return <p data-loading>Waiting for server UI</p>}
      export function App(){let board=getBoard();const form=$forms(()=>{const result=saveBoard();board=result;return result;});return <main><Group pending={Loading}><div suspend>{board}</div></Group><button data-save onClick={()=>{board=saveBoard()}}>Save</button><form onSubmit={form.submit}><button data-form disabled={form.pending}>Form save</button><span data-form-state>{form.pending?'Saving':'Ready'}</span></form><button data-deny onClick={()=>{board=getDenied()}}>Denied</button></main>}`,
    'server.ts':`import {serve} from '@memoized-dom/server';import {define} from './server/define';import {App} from './App';const reports=[];const app=serve({define,onRender:report=>reports.push(report.outcome)});app.get('/__render-reports',()=>reports);app.ssr(App${mode.endsWith('stream') ? ",{mode:'stream'}" : ''});export default app;`,
  };
  for(const [name,source] of Object.entries(files)){const file=resolve(fixture,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,source);}
  const aliases=['runtime/server','runtime/hot','runtime/hydrate-program','runtime/hydrate','runtime','data/internal','data','router/internal','router','server/internal','server/router','server','adapters/bun'].map(name=>({
    find:'@memoized-dom/'+name,replacement:resolve(repository,'packages',name.split('/')[0]!,'src',name.includes('/')?(name.endsWith('/router')?'http-router':name.split('/')[1]!)+'.ts':'index.ts'),
  }));
  const config={root:fixture,configFile:false as const,logLevel:'silent' as const,resolve:{alias:aliases},plugins:[memoizedDom({clientEntry:'main.ts',serverEntry:'server.ts'})],server:{host:'127.0.0.1',port:0}};
  let origin:string;
  if(mode.startsWith('development')){vite=await createDevServer(config);origin=vite.origin;}
  else {
    const builder=await createBuilder(config);await builder.buildApp();
    const backend=await import(/* @vite-ignore */pathToFileURL(resolve(fixture,'dist/server.js')).href);
    productionHost=Bun.serve({hostname:'127.0.0.1',port:0,fetch:backend.default.fetch});origin=productionHost.url.origin;
  }
  // The containing document must settle even before a direct endpoint request
  // has warmed the private page artifacts or request transport.
  const cold=await fetch(origin);expect(cold.status).toBe(200);
  assertSettledPageSsr(await cold.text(),mode.endsWith('stream'));
  const response=await fetch(origin+'/_fn/boards/getBoard',{headers:{'x-mmd-stream':'snapshot'}});
  const content=await response.text();expect(response.status,content).toBe(200);expect(content).not.toContain('SERVER_SECRET');
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('x-mmd-page')).toBe('1');
  expect(content.startsWith('<div')).toBe(true);
  expect(decodePageHtml(content)).toMatchObject({$mmd:'page',html:expect.stringContaining('Ada')});
  const documents=await Promise.all([fetch(origin),fetch(origin)]);
  for(const document of documents)assertSettledPageSsr(await document.text(),mode.endsWith('stream'));
  expect(await (await fetch(origin+'/__render-reports')).json()).toEqual(['complete','complete','complete']);
  if(vite) await expect(vite.vite.environments.client!.pluginContainer.load('\0virtual:memoized-dom/page/0/server/'+encodeURIComponent('./server/functions/boards.tsx.MemoizedServerPage0.tsx')+'.js')).rejects.toThrow('cannot be imported by the client');
  if(!chrome)return;
  const browser=await puppeteer.launch({executablePath:chrome,headless:true});
  try{
    const page=await browser.newPage(), viewer=await browser.newPage();const errors:string[]=[];
    const modules:string[]=[],diagnostics:string[]=[];page.on('request',request=>{if(request.url().includes('memoized-dom/page'))modules.push(request.url());});
    for(const tab of [page,viewer]){
      tab.on('pageerror',error=>errors.push(String(error)));
      tab.on('console',message=>{if(message.type()==='error')diagnostics.push(message.text());});
      tab.on('requestfailed',request=>diagnostics.push(request.url()+': '+request.failure()?.errorText));
      tab.on('response',response=>{if(response.status()>=400)diagnostics.push(response.status()+': '+response.url());});
    }
    await Promise.all([page,viewer].map(tab=>tab.goto(origin,{waitUntil:'domcontentloaded'})));
    await page.bringToFront();
    try { await page.waitForFunction(()=>typeof (document.querySelector('[data-toggle]') as HTMLButtonElement|null)?.onclick === 'function',{timeout:10_000,polling:100}); }
    catch(error){throw new Error(String(error)+'\n'+errors.join('\n')+'\n'+diagnostics.join('\n')+'\n'+modules.join('\n')+'\n'+await page.content());}
    expect(await page.$eval('[data-board]',node=>getComputedStyle(node).color)).toBe('rgb(12, 34, 56)');
    expect(await page.$eval('[data-count]',node=>getComputedStyle(node).fontWeight)).toBe('700');
    expect(await page.$eval('[data-subtitle]',node=>node.textContent)).toBe('No subtitle');
    await page.bringToFront();await page.click('[data-reveal]');
    await page.waitForFunction(()=>document.querySelector('[data-hint]')?.textContent==='Event-only',{polling:100});
    await page.bringToFront();await page.click('[data-toggle]');await page.waitForSelector('[data-expanded]',{timeout:5000});
    await viewer.bringToFront();await viewer.click('[data-toggle]');await viewer.waitForSelector('[data-expanded]',{timeout:5000});
    await viewer.type('[data-local-input]','USER');
    const typedValue=await viewer.$eval('[data-local-input]',node=>(node as HTMLInputElement).value);
    await viewer.evaluate(()=>{(window as unknown as {pageInput:Element|null}).pageInput=document.querySelector('[data-local-input]');});
    await page.$eval('[data-save]',node=>(node as HTMLButtonElement).click());
    await page.waitForFunction(()=>document.querySelector('[data-count]')?.textContent==='1',{timeout:10_000,polling:100});
    await viewer.waitForFunction(()=>document.querySelector('[data-count]')?.textContent==='1',{timeout:10_000,polling:100});
    expect(await viewer.$('[data-expanded]')).not.toBeNull();
    expect(await viewer.evaluate(()=>{const input=document.querySelector('[data-local-input]') as HTMLInputElement;return {same:input===(window as unknown as {pageInput:Element}).pageInput,value:input.value,focused:document.activeElement===input};})).toEqual({same:true,value:typedValue,focused:true});
    await viewer.bringToFront();await viewer.click('[data-toggle]');await viewer.waitForFunction(()=>!document.querySelector('[data-expanded]'),{polling:100});
    await page.bringToFront();
    await page.click('[data-toggle]');await page.waitForSelector('[data-expanded]',{timeout:5000});
    await page.evaluate(()=>{(window as unknown as {previousBoard:Element|null}).previousBoard=document.querySelector('[data-board]');});
    await page.setRequestInterception(true);
    const held=Promise.withResolvers<import('puppeteer-core').HTTPRequest>();
    const intercept=(request:import('puppeteer-core').HTTPRequest)=>{
      if(request.url().includes('/_fn/boards/saveBoard'))held.resolve(request);
      else void request.continue();
    };
    page.on('request',intercept);
    await page.click('[data-form]');
    const pendingAction=await held.promise;
    await page.waitForFunction(()=>document.querySelector('[data-form-state]')?.textContent==='Saving',{timeout:5000,polling:100});
    expect(await page.$('[data-loading]')).toBeNull();
    expect(await page.evaluate(()=>document.querySelector('[data-board]')===(window as unknown as {previousBoard:Element}).previousBoard)).toBe(true);
    expect(await page.$('[data-expanded]')).not.toBeNull();
    // Local events remain usable while the replacement source is pending.
    await page.click('[data-toggle]');await page.waitForFunction(()=>!document.querySelector('[data-expanded]'),{polling:100});
    await page.click('[data-toggle]');await page.waitForSelector('[data-expanded]',{timeout:5000});
    await pendingAction.continue();
    await page.waitForFunction(()=>document.querySelector('[data-count]')?.textContent==='2'&&document.querySelector('[data-form-state]')?.textContent==='Ready',{timeout:10_000,polling:100});
    page.off('request',intercept);await page.setRequestInterception(false);
    // Both actions return the same page call site/contract: retain the owner
    // through pending AND commit, including local changes made while waiting.
    expect(await page.$('[data-expanded]')).not.toBeNull();
    expect(await page.evaluate(()=>document.querySelector('[data-board]')===(window as unknown as {previousBoard:Element}).previousBoard)).toBe(true);
    await page.click('[data-toggle]');await page.waitForFunction(()=>!document.querySelector('[data-expanded]'),{polling:100});
    await page.click('[data-deny]');await page.waitForSelector('[data-denied]',{timeout:10_000});
    expect(await page.$('[data-board]')).toBeNull();expect(errors).toEqual([]);
  }finally{await browser.close();}
},60_000);

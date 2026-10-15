import { afterEach, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createDevServer, type NativeDevServer } from '../src/dev';
import memoizedDom from '../src';

const repository=resolve(import.meta.dirname,'../../..');
const chrome=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find((path):path is string=>!!path&&existsSync(path));
let fixture:string|undefined, vite:NativeDevServer|undefined;
afterEach(async()=>{await vite?.close();vite=undefined;if(fixture)await rm(fixture,{recursive:true,force:true});fixture=undefined;});

it('delivers finite and live server pages, binds interactions and keeps secrets off the wire',async()=>{
  fixture=await mkdtemp(resolve(tmpdir(),'memoized-dom-pages-'));
  const files:Record<string,string>={
    'index.html':`<!doctype html><html><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.ts"></script></body></html>`,
    'main.ts':`import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    'server/define.ts':`import {createDefine} from '@memoized-dom/server';export const define=createDefine();export {page} from '@memoized-dom/server';`,
    'server/functions/boards.tsx':`import {define,page} from '../define';import {Board} from '../../Board';
      let count=0;
      export const getBoard=define.function({live:()=>['board'],async get(){const user={name:'Ada',password:'SERVER_SECRET'};return page(<Board count={count} user={user}/>);}});
      export const saveBoard=define.function({updates:()=>['board'],async post(){count++;const user={name:'Saved',password:'SERVER_SECRET'};return page(<Board count={count} user={user}/>);}});
      export const getDenied=define.function({async get(){return page(<p data-denied>Denied</p>);}});`,
    'Board.tsx':`export function Board({count,user}){let expanded=false;return <section data-board><h1>{user.name}</h1><p data-count>{count}</p><button data-toggle onClick={async()=>{await Promise.resolve();expanded=!expanded}}>Toggle</button>{expanded&&<p data-expanded>Expanded</p>}</section>}`,
    'App.tsx':`import {getBoard,saveBoard,getDenied} from '#server-functions';
      export function App(){let board=getBoard();return <main><div suspend>{board}</div><button data-save onClick={()=>{board=saveBoard()}}>Save</button><button data-deny onClick={()=>{board=getDenied()}}>Denied</button></main>}`,
    'server.ts':`import {serve} from '@memoized-dom/server';import {define} from './server/define';import {App} from './App';const app=serve({define});app.ssr(App);export default app;`,
  };
  for(const [name,source] of Object.entries(files)){const file=resolve(fixture,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,source);}
  const aliases=['runtime/server','runtime/hot','runtime/hydrate-program','runtime/hydrate','runtime','data/internal','data','router/internal','router','server/internal','server/router','server'].map(name=>({
    find:'@memoized-dom/'+name,replacement:resolve(repository,'packages',name.split('/')[0]!,'src',name.includes('/')?(name.endsWith('/router')?'http-router':name.split('/')[1]!)+'.ts':'index.ts'),
  }));
  vite=await createDevServer({root:fixture,configFile:false,logLevel:'silent',resolve:{alias:aliases},plugins:[memoizedDom({clientEntry:'main.ts',serverEntry:'server.ts'})],server:{host:'127.0.0.1',port:0}});
  const origin=vite.origin;
  const response=await fetch(origin+'/_fn/boards/getBoard',{headers:{'x-mmd-stream':'snapshot'}});
  const content=await response.text();expect(response.status,content).toBe(200);expect(content).not.toContain('SERVER_SECRET');
  expect(JSON.parse(content)).toMatchObject({$mmd:'page',html:expect.stringContaining('Ada')});
  const html=await (await fetch(origin)).text();expect(html).toContain('<h1>Ada</h1>');expect(html).not.toContain('SERVER_SECRET');
  if(!chrome)return;
  const browser=await puppeteer.launch({executablePath:chrome,headless:true});
  try{
    const page=await browser.newPage(), viewer=await browser.newPage();const errors:string[]=[];
    const modules:string[]=[];page.on('request',request=>{if(request.url().includes('memoized-dom/page'))modules.push(request.url());});
    for(const tab of [page,viewer])tab.on('pageerror',error=>errors.push(String(error)));
    await Promise.all([page,viewer].map(tab=>tab.goto(origin,{waitUntil:'domcontentloaded'})));
    try { await page.waitForFunction(()=>typeof (document.querySelector('[data-toggle]') as HTMLButtonElement|null)?.onclick === 'function',{timeout:10_000,polling:100}); }
    catch(error){throw new Error(String(error)+'\n'+errors.join('\n')+'\n'+modules.join('\n')+'\n'+await page.content());}
    await page.bringToFront();await page.click('[data-toggle]');await page.waitForSelector('[data-expanded]',{timeout:5000});
    await page.click('[data-save]');
    await page.waitForFunction(()=>document.querySelector('[data-count]')?.textContent==='1',{timeout:10_000,polling:100});
    await viewer.waitForFunction(()=>document.querySelector('[data-count]')?.textContent==='1',{timeout:10_000,polling:100});
    await viewer.bringToFront();await viewer.click('[data-toggle]');await viewer.waitForSelector('[data-expanded]',{timeout:5000});
    await page.bringToFront();
    await page.click('[data-deny]');await page.waitForSelector('[data-denied]',{timeout:10_000});
    expect(await page.$('[data-board]')).toBeNull();expect(errors).toEqual([]);
  }finally{await browser.close();}
},60_000);

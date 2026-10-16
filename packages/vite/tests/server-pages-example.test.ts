import {afterEach,expect,it} from 'bun:test';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer,{type HTTPRequest,type Page} from 'puppeteer-core';
import {waitFor} from '../../../test-support/helpers';

const repository=resolve(import.meta.dirname,'../../..');
const chrome=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium']
  .find((path):path is string=>!!path&&existsSync(path));
let child:ChildProcess|undefined;

afterEach(async()=>{
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const stopped=new Promise<void>(done=>child!.once('exit',()=>done()));
  if(process.platform==='win32'){
    const killer=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});
    await new Promise<void>(done=>killer.once('exit',()=>done()));
  }else child.kill('SIGTERM');
  await stopped;child=undefined;
});

interface MultiplexRequest {session?:string;subscribe:Array<{url:string}>}

function observeMultiplex(page:Page):{openings:string[][];subscriptions:string[]} {
  const openings:string[][]=[],subscriptions:string[]=[];
  page.on('request',(request:HTTPRequest)=>{
    if(request.headers()['x-mmd-multiplex']!=='1'||request.postData()===undefined)return;
    const control=JSON.parse(request.postData()!) as MultiplexRequest;
    const urls=control.subscribe.map(item=>item.url);
    subscriptions.push(...urls);
    if(control.session===undefined)openings.push(urls);
  });
  return {openings,subscriptions};
}

it.skipIf(!chrome)('keeps the documented server-pages example interactive across two multiplexed viewers',async()=>{
  child=spawn('node',[resolve(repository,'packages/vite/dist/cli.js'),'dev','--config','examples/server-pages/vite.config.ts','--port','0'],{
    cwd:repository,stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  let log='';child.stdout!.on('data',data=>{log+=data;});child.stderr!.on('data',data=>{log+=data;});
  let origin='';
  await waitFor(()=>{const match=log.match(/Memoized DOM \((?:bun|node)\): (http[^\s]+)/);expect(match,log).not.toBeNull();origin=match![1]!;},60_000);

  const browser=await puppeteer.launch({executablePath:chrome!,headless:true});
  try{
    const first=await browser.newPage(),second=await browser.newPage(),errors:string[]=[];
    const firstWire=observeMultiplex(first),secondWire=observeMultiplex(second);
    for(const page of [first,second]){
      page.on('pageerror',error=>errors.push(String(error)));
      page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors.push(message.text());});
      page.on('requestfailed',request=>errors.push(`${request.url()}: ${request.failure()?.errorText}`));
      page.on('response',response=>{
        if(response.status()>=400&&new URL(response.url()).pathname!=='/favicon.ico')errors.push(`${response.status()}: ${response.url()}`);
      });
    }
    await Promise.all([first,second].map(page=>page.goto(origin,{waitUntil:'domcontentloaded',timeout:30_000})));
    for(const page of [first,second])await page.waitForFunction(()=>
      document.querySelector('[data-count="orchard"]')?.textContent==='0'&&
      typeof (document.querySelector('[data-local="orchard"]') as HTMLButtonElement|null)?.onclick==='function',
    {timeout:15_000,polling:100});

    for(const wire of [firstWire,secondWire]){
      await waitFor(()=>expect(new Set(wire.subscriptions.filter(url=>url.includes('/getBoard'))).size).toBe(2),15_000);
      expect(wire.openings).toHaveLength(1);
      expect(new Set(wire.openings[0]!.filter(url=>url.includes('/getBoard'))).size).toBe(2);
      expect(wire.subscriptions.some(url=>url.includes('boardId=orchard'))).toBe(true);
      expect(wire.subscriptions.some(url=>url.includes('boardId=harbor'))).toBe(true);
    }

    await first.bringToFront();await first.click('[data-local="orchard"]');
    await first.waitForFunction(()=>document.querySelector('[data-local="orchard"]')?.textContent==='Local clicks: 1');
    await first.type('[data-draft="orchard"]','private draft');
    await first.evaluate(()=>{(globalThis as typeof globalThis&{draft?:Element|null}).draft=document.querySelector('[data-draft="orchard"]');});
    const harborRender=await first.$eval('[data-render="harbor"]',node=>node.textContent);
    const shellCount=await first.$eval('[data-shell]',node=>node.textContent);

    await second.bringToFront();await second.click('[data-change="orchard-plus"]');
    for(const page of [first,second])await page.waitForFunction(()=>document.querySelector('[data-count="orchard"]')?.textContent==='1',{timeout:10_000,polling:100});
    expect(await first.evaluate(()=>{const input=document.querySelector('[data-draft="orchard"]') as HTMLInputElement;return {
      same:input===(globalThis as typeof globalThis&{draft?:Element|null}).draft,value:input.value,focused:document.activeElement===input,
    };})).toEqual({same:true,value:'private draft',focused:true});
    expect(await first.$eval('[data-local="orchard"]',node=>node.textContent)).toBe('Local clicks: 1');
    expect(await first.$eval('[data-render="harbor"]',node=>node.textContent)).toBe(harborRender);
    expect(await first.$eval('[data-shell]',node=>node.textContent)).toBe(shellCount);

    const title='Release-readiness orchard';
    await second.type('input[name="title"]',title);await second.click('[data-rename]');
    for(const page of [first,second])await page.waitForFunction(value=>document.querySelector('[data-board="orchard"] h2')?.textContent===value,{timeout:10_000,polling:100},title);
    await second.waitForFunction(value=>document.querySelector('[data-receipt] h3')?.textContent===value,{timeout:10_000,polling:100},title);
    expect(await first.$eval('[data-receipt] h3',node=>node.textContent)).toBe('No submission yet');
    expect(errors).toEqual([]);
  }catch(error){throw new Error(`${String(error)}\n${log}`);}
  finally{await browser.close();}
},120_000);

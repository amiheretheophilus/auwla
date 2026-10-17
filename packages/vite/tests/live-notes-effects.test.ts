import {afterEach,expect,it} from 'bun:test';
import {spawn,type ChildProcess} from 'node:child_process';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {waitFor} from '../../../test-support/helpers';

const root=resolve(import.meta.dirname,'../../..');
const chrome=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium']
  .find((path):path is string=>!!path&&existsSync(path));
let child:ChildProcess|undefined;
let fixture:string|undefined;
afterEach(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null){
    const stopped=new Promise<void>(done=>child!.once('exit',()=>done()));
    if(process.platform==='win32'){
      const killer=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});
      await new Promise<void>(done=>killer.once('exit',()=>done()));
    }else child.kill('SIGTERM');
    await stopped;
  }
  child=undefined;
  if(fixture)await rm(fixture,{recursive:true,force:true});
  fixture=undefined;
});

it.skipIf(!chrome)('delivers add/edit/delete to isolated browsers with effect-owning note components',async()=>{
  const directory=join(root,'tests/fixtures/out');
  await mkdir(directory,{recursive:true});
  fixture=await mkdtemp(join(directory,'live-note-effects-'));
  await cp(join(root,'examples/fieldnotes'),fixture,{recursive:true,
    filter:path=>!['node_modules','dist','.memoized'].includes(path.split(/[\\/]/).at(-1)!)});
  await writeFile(join(fixture,'src/Notes.tsx'),`
    export interface Note{id:string;text:string;by:string;}
    type Props={note:Note;isDeleting:boolean;isSaving:boolean;onDelete:(id:string)=>void;onSave:(input:{noteId:string;text:string})=>unknown;};
    export function Notes({note,isDeleting,isSaving,onDelete,onSave}:Props){
      let isDoubleClicked=false;let text=note.text;
      $effect(()=>{console.log('note-effect:editing',isDoubleClicked);});
      $effect(()=>{console.log('note-effect:value',note);});
      return <div>
        <li class="note" data-note={note.id} onDblClick={()=>isDoubleClicked=true} if={!isDoubleClicked}>
          {note.text}<span>— {note.by}</span><button disabled={isDeleting} onClick={()=>onDelete(note.id)}>Delete</button>
        </li>
        <li class="note" data-note={note.id} if={isDoubleClicked}>
          <input value={text} onInput={event=>text=event.currentTarget.value}/>
          <button class="save" disabled={isDeleting} onClick={()=>{onSave({noteId:note.id,text});isDoubleClicked=false;}}>{isSaving?'Saving':'Save'}</button>
        </li>
      </div>;
    }
  `);
  const detail=join(fixture,'src/ExpeditionDetail.tsx');
  let source=await readFile(detail,'utf8');
  source="import {Notes} from './Notes';\n"+source.replace('postNote, deleteNote,','postNote, deleteNote, editNote,');
  source=source.replace('  const deleting = new Set<string>();',`  const deleting = new Set<string>();
    const saving = new Set<string>();
    const editSavedNote=optimistic({source:[notes,summary],
      action:({noteId,text}:{noteId:string;text:string})=>editNote(page.expedition.id,noteId,text),
      apply(input){saving.add(input.noteId);return()=>saving.delete(input.noteId);},
      reconcile(_saved,input){saving.delete(input.noteId);},
    });`);
  source=source.replace(/\{notes\.map\(n => \([\s\S]*?\)\)\}/,
    `{notes.map(note=><Notes key={note.id} note={note} onDelete={removeNote} onSave={editSavedNote} isSaving={saving.has(note.id)} isDeleting={deleting.has(note.id)}/>)} `);
  expect(source).toContain('<Notes key=');
  await writeFile(detail,source);
  const functions=join(fixture,'server/functions/expeditions.ts');
  await writeFile(functions,(await readFile(functions,'utf8'))+`
    export const editNote=define.function({
      async post({services},expeditionId:string,noteId:string,text:string){
        await delay(700);const expedition=services.expeditions.all().find(item=>item.id===expeditionId);
        const note=expedition?.notes.find(item=>item.id===noteId);if(!note)throw new Error('Unknown note');
        note.text=text;return note;
      },updates:(_context,expeditionId)=>['expedition-notes',expeditionId],
    });
  `);
  child=spawn('node',[join(root,'packages/vite/dist/cli.js'),'dev','--config',join(fixture,'vite.config.ts'),'--port','0'],
    {cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let log='';child.stdout!.on('data',data=>log+=data);child.stderr!.on('data',data=>log+=data);
  let address='';
  await waitFor(()=>{
    const match=log.match(/Memoized DOM \((?:bun|node)\): (http[^\s]+)/);
    expect(match,log).not.toBeNull();address=match![1]!;
  },60_000);
  const browser=await puppeteer.launch({executablePath:chrome,headless:true,protocolTimeout:15_000});
  const errors:string[]=[];
  const effects=[0,0];
  const snapshots=[0,0];
  let stage='initial loading';
  try {
    const contexts=await Promise.all([browser.createBrowserContext(),browser.createBrowserContext()]);
    const pages=await Promise.all(contexts.map(context=>context.newPage()));
    for(const [index,page] of pages.entries()){
      page.on('pageerror',error=>errors.push(String(error)));
      page.on('console',message=>{
        if(message.text().startsWith('note-effect:'))effects[index]++;
        if(message.text().startsWith('[memoized-dom:live] snapshot-applied'))snapshots[index]++;
      });
    }
    await Promise.all(pages.map(page=>page.goto(address+'/expeditions/ice-cores',{waitUntil:'domcontentloaded'})));
    for(const page of pages)await page.waitForFunction(()=>document.querySelectorAll('li.note').length===2&&
      document.querySelector('[data-live-status]')?.textContent?.includes('Live notes connected'),{timeout:30_000});
    await waitFor(()=>expect(effects.every(count=>count>=4)).toBe(true));
    await waitFor(()=>expect(snapshots.every(count=>count>=2)).toBe(true),10_000);
    // SSR hydration is followed by the initial live snapshot, which is a real
    // prop publication. Check idle stability after that connection settles.
    await new Promise(done=>setTimeout(done,1_200));
    const initial=effects.slice();
    await new Promise(done=>setTimeout(done,400));
    expect(effects).toEqual(initial);
    stage='adding a note';
    const [writer,viewer]=pages;
    await writer!.bringToFront();
    await writer!.type('.note-form input','Cross-browser new note');
    await writer!.click('.note-form button');
    for(const page of pages)await page.waitForFunction(()=>document.querySelector('[data-note-count]')?.textContent?.includes('3 notes')&&
      [...document.querySelectorAll('li.note')].some(node=>node.textContent?.includes('Cross-browser new note')),{timeout:15_000,polling:100});
    await writer!.waitForFunction(()=>document.querySelector('.status-line')?.textContent?.includes('Note saved'),{timeout:15_000});
    const id=await writer!.$eval('ul.plain',node=>[...node.querySelectorAll('li.note')].find(row=>row.textContent?.includes('Cross-browser new note'))!.getAttribute('data-note'));
    const selector=`li[data-note="${id}"]`;
    stage='editing the note';
    // Double-click the row itself, not its centered Delete button.
    await writer!.$eval(selector,node=>node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
    await writer!.waitForSelector(selector+' input');
    await writer!.$eval(selector+' input',node=>{(node as HTMLInputElement).value='Edited across browsers';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await writer!.click(selector+' .save');
    for(const page of pages)await page.waitForFunction(value=>document.querySelector(`li[data-note="${value}"]`)?.textContent?.includes('Edited across browsers'),{timeout:15_000,polling:100},id);
    stage='deleting the note';
    await writer!.click(selector+' button');
    for(const page of pages)await page.waitForFunction(value=>document.querySelector(`li[data-note="${value}"]`)===null&&
      document.querySelector('[data-note-count]')?.textContent?.includes('2 notes'),{timeout:15_000,polling:100},id);
    const settled=effects.slice();
    await new Promise(done=>setTimeout(done,400));
    expect(effects).toEqual(settled);
    stage='reconnecting after a backend edit';
    for(const page of pages)await page.evaluate(()=>{document.documentElement.dataset.liveReloadProbe='kept';});
    // Change only server code: existing live connections must leave the retired
    // application's hub, even though the browser component itself did not change.
    const updated=(await readFile(functions,'utf8')).replace('return expedition.notes;',
      "return expedition.notes.map(note=>({...note,by:note.by+' reloaded'}));");
    expect(updated).toContain("by:note.by+' reloaded'");
    await writeFile(functions,updated);
    await waitFor(async()=>{
      const result=await(await fetch(address+'/_fn/expeditions/getNotes?expeditionId=ice-cores')).json() as Array<{by:string}>;
      expect(result.some(note=>note.by.endsWith(' reloaded'))).toBe(true);
    },15_000);
    for(const page of pages)await page.waitForFunction(()=>[...document.querySelectorAll('li.note')]
      .some(node=>node.textContent?.includes(' reloaded')),{timeout:20_000,polling:100});
    for(const page of pages)expect(await page.evaluate(()=>document.documentElement.dataset.liveReloadProbe)).toBe('kept');
    stage='delivering mutations after backend replacement';
    await writer!.type('.note-form input','After backend reload');
    await writer!.click('.note-form button');
    for(const page of pages)await page.waitForFunction(()=>document.querySelector('[data-note-count]')?.textContent?.includes('3 notes')&&
      [...document.querySelectorAll('li.note')].some(node=>node.textContent?.includes('After backend reload')),{timeout:20_000,polling:100});
    expect(errors,log).toEqual([]);
    expect(await viewer!.$eval('[data-note-count]',node=>node.textContent)).toContain('3 notes');
  }catch(error){throw new Error(`${stage}: ${String(error)}\nBrowser errors: ${errors.join('\n')}\n${log}`);}
  finally{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([browser.close(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Browser cleanup timed out')),5_000);})]);}
    catch{
      const process=browser.process();
      if(process?.pid&&globalThis.process.platform==='win32'){
        const killer=spawn('taskkill',['/pid',String(process.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});
        await new Promise<void>(done=>killer.once('exit',()=>done()));
      }else process?.kill('SIGKILL');
    }finally{clearTimeout(timer);}
  }
},150_000);

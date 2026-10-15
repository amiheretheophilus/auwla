import { afterEach, expect, it } from 'bun:test';
import { acceptPageContent, createContentRegion, type PageContent } from '@memoized-dom/runtime';

afterEach(()=>document.body.replaceChildren());
const shell='<div><h1>Static</h1><input value="initial"><section><!--mmd:g:summary--><i>Summary loading</i><!--/mmd--></section><aside><!--mmd:g:notes--><i>Notes loading</i><!--/mmd--></aside></div>';
function value(sequence:number,regions:NonNullable<PageContent['progress']>['regions']=[],complete=false,generation='first'):PageContent {
  return acceptPageContent({$mmd:'page',version:1,id:'board',html:shell,progress:{id:generation,sequence,complete,regions}});
}
it('fills only ready regions and retains static nodes, typed input and sibling loading UI',()=>{
  const host=document.createElement('main');document.body.append(host);let page=value(1);
  const region=createContentRegion(host,'page',()=>page), heading=host.querySelector('h1'), input=host.querySelector('input')!;
  input.value='unsaved';input.focus();
  const summary={id:'summary',html:'<p>Summary ready 🌍</p>',sequence:2};
  page=value(2,[summary]);region.update();
  expect(host.querySelector('section')?.textContent).toBe('Summary ready 🌍');expect(host.querySelector('aside')?.textContent).toBe('Notes loading');
  expect(host.querySelector('h1')).toBe(heading);expect(host.querySelector('input')).toBe(input);expect(input.value).toBe('unsaved');expect(document.activeElement).toBe(input);
  page=value(4,[summary,{id:'notes',html:'<p>Notes ready</p>',sequence:3}],true);region.update();
  expect(host.querySelector('aside')?.textContent).toBe('Notes ready');expect(host.querySelector('input')).toBe(input);
  region.dispose();expect(host.childNodes).toHaveLength(0);
});
it('scopes equal compiler range IDs to their own mounted page and handles skipped frames',()=>{
  const one=document.createElement('main'),two=document.createElement('main');document.body.append(one,two);
  let page=value(1);const first=createContentRegion(one,'one',()=>page),second=createContentRegion(two,'two',()=>value(1));
  page=value(3,[{id:'summary',html:'<p>Ready</p>',sequence:2},{id:'notes',html:'<p>Done</p>',sequence:3}],true);first.update();
  expect(one.querySelector('aside')?.textContent).toBe('Done');expect(two.querySelector('aside')?.textContent).toBe('Notes loading');
  first.dispose();second.dispose();
});
it('keeps a committed page until a replacement generation completes',()=>{
  const host=document.createElement('main');document.body.append(host);let page=value(1,[],true);
  const region=createContentRegion(host,'page',()=>page), original=host.querySelector('div');
  page=value(1,[],false,'replacement');region.update();expect(host.querySelector('div')).toBe(original);
  page=acceptPageContent({...value(2,[],true,'replacement'),html:'<div><h1>Replacement ready</h1></div>'});region.update();
  expect(host.querySelector('div')===original).toBe(false);expect(host.textContent).toBe('Replacement ready');region.dispose();
});

import { expect, it } from 'bun:test';
import { decodePageFrames, encodePageFrame, encodePageFailure, type PageContent } from '@memoized-dom/runtime';

function value(sequence: number, complete = false): PageContent {
  return {$mmd:'page',version:1,id:'test',html:'<p>汉字 😀 <!--mmd:page-value:4--> </p>',
    progress:{id:'render',sequence,complete,regions:[]}};
}
function bytes(body: string, width = 7): ReadableStream<Uint8Array> {
  const encoded=new TextEncoder().encode(body);
  let offset=0;
  return new ReadableStream({pull(controller){
    if(offset===encoded.length){controller.close();return;}
    controller.enqueue(encoded.slice(offset,offset=Math.min(offset+width,encoded.length)));
  }});
}
async function collect(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<PageContent[]> {
  const result:PageContent[]=[];
  for await(const page of decodePageFrames(body,signal))result.push(page);
  return result;
}
it('decodes fragmented finite HTML frames with Unicode and delimiter-like markup',async()=>{
  const first=value(1),last=value(2,true);
  expect(await collect(bytes(encodePageFrame(first)+encodePageFrame(last),1))).toEqual([first,last]);
});
it('rejects truncated, out-of-order, cross-generation and post-completion frames',async()=>{
  for(const body of ['',encodePageFrame(value(1)),encodePageFrame(value(1,true)).slice(0,-1),
    encodePageFrame(value(2,true)),encodePageFrame(value(1))+encodePageFrame({...value(2,true),progress:{...value(2,true).progress!,id:'other'}}),
    encodePageFrame(value(1,true))+encodePageFrame(value(2,true)),encodePageFailure(),
    '<!--mmd:page-value:9000000-->']) {
    await expect(collect(bytes(body))).rejects.toThrow();
  }
});
it('cancels a stalled finite page decoder when its owner aborts',async()=>{
  let cancelled=false;
  const controller=new AbortController();
  const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
  const reading=collect(stream,controller.signal);
  controller.abort();
  await expect(reading).rejects.toHaveProperty('name','AbortError');
  expect(cancelled).toBe(true);
});

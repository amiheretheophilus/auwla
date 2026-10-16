import {expect,it} from 'bun:test';
import {readStreamFrames,StreamProtocolError} from '../src/stream-frames';

function response(chunks:Uint8Array[]){return new Response(new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}}),{headers:{'content-type':'text/event-stream'}});}
const encoder=new TextEncoder();
it('parses fragmented Unicode, CRLF, comments and multiline data',async()=>{
  const bytes=encoder.encode(': heartbeat\r\n\r\nevent: value\r\ndata: {"sub":"one",\r\ndata: "value":"雪😀"}\r\n\r\n');
  const frames:unknown[]=[];
  await readStreamFrames(response(Array.from(bytes,byte=>new Uint8Array([byte]))),new AbortController().signal,(event,value)=>{frames.push([event,value]);});
  expect(frames).toEqual([['value',{sub:'one',value:'雪😀'}]]);
});
it('limits individual frames rather than a batch of valid frames in one read',async()=>{
  const frame='event: value\ndata: '+JSON.stringify({sub:'one',value:'雪'.repeat(100_000)})+'\n\n';let count=0;
  await readStreamFrames(response([encoder.encode(frame.repeat(5))]),new AbortController().signal,()=>{count++;});expect(count).toBe(5);
  await expect(readStreamFrames(response([encoder.encode('data: '+JSON.stringify({value:'x'.repeat(1_048_576)})+'\n\n')]),new AbortController().signal,()=>{})).rejects.toThrow('1 MiB');
});
it('distinguishes an interrupted frame from a complete malformed protocol frame',async()=>{
  let interrupted:unknown;
  try{await readStreamFrames(response([encoder.encode('event: value\ndata: {"sub":')]),new AbortController().signal,()=>{});}catch(error){interrupted=error;}
  expect(interrupted).toBeInstanceOf(Error);expect(interrupted).not.toBeInstanceOf(StreamProtocolError);
  await expect(readStreamFrames(response([encoder.encode('event: value\ndata: null\n\n')]),new AbortController().signal,()=>{})).rejects.toBeInstanceOf(StreamProtocolError);
});
it('cancels a pending reader when its connection aborts',async()=>{
  let cancelled=0;const abort=new AbortController();
  const source=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'text/event-stream'}});
  const reading=readStreamFrames(source,abort.signal,()=>{});abort.abort();
  await expect(reading).rejects.toThrow();expect(cancelled).toBe(1);expect(source.body!.locked).toBe(false);
});

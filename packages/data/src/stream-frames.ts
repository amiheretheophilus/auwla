/** Bounded fetch-SSE framing. Callbacks may enqueue independent subscription work. */
export class StreamProtocolError extends Error {}
export class LivePatchBaselineError extends Error {}
export async function readStreamFrames(response:Response,signal:AbortSignal,
  receive:(event:string,data:Record<string,unknown>,bytes:number)=>void|Promise<void>,
):Promise<void>{
  if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream')){
    await response.body?.cancel();throw new StreamProtocolError('Expected an SSE response');
  }
  const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
  let buffer='',event='',data:string[]=[],size=0;
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{
    while(!signal.aborted){
      const next=await reader.read();if(next.done)break;
      buffer+=decoder.decode(next.value,{stream:true});let newline:number;
      while((newline=buffer.indexOf('\n'))!==-1){
        const raw=buffer.slice(0,newline),line=raw.replace(/\r$/,'');buffer=buffer.slice(newline+1);
        size+=encoder.encode(raw).byteLength+1;
        if(size>1_048_576)throw new StreamProtocolError('Streaming frame exceeds 1 MiB');
        if(line===''){
          if(data.length){
            const value:unknown=JSON.parse(data.join('\n'));
            if(!value||typeof value!=='object'||Array.isArray(value))throw new StreamProtocolError('Invalid streaming frame');
            await receive(event,value as Record<string,unknown>,size);
          }
          event='';data=[];size=0;
        }else if(line.startsWith('event:'))event=line.slice(6).trimStart();
        else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
      }
      if(size+encoder.encode(buffer).byteLength>1_048_576)throw new StreamProtocolError('Streaming frame exceeds 1 MiB');
    }
    signal.throwIfAborted();
    // A transport can disconnect in the middle of a frame. Reconnect from full
    // baselines; only a complete but malformed frame is a terminal protocol error.
    if(data.length||buffer)throw new Error('Streaming connection ended during a frame');
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

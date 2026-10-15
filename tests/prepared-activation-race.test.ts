import { expect, it } from 'bun:test';
import { createApplicationRuntime, createPreparedRegion, getActiveApplicationRuntime, markDirty,
  readPreparationScope, registerEntity, runWithApplicationRuntime, unregisterSubtree } from '@memoized-dom/runtime';

it('rechecks readiness before queued activation without clearing an already published range',async()=>{
  const runtime=createApplicationRuntime();const host=document.createElement('main');document.body.append(host);
  const kept=document.createElement('p');kept.textContent='Ready';let factories=0;
  try {
    const region=runWithApplicationRuntime(runtime,()=>{
      registerEntity({id:'root',parent:null,render(){}});
      const read=()=>readPreparationScope('root/child','value',()=>getActiveApplicationRuntime().state.preparation?.consume({
        key:host,snapshot:()=>({status:'ready'}),subscribe:()=>()=>{},
      }));
      const result=createPreparedRegion(host,'root/range',()=>{
        factories++;registerEntity({id:'root/child',parent:'root',render:read});read();
        return {nodes:[kept],update:read,dispose:()=>unregisterSubtree('root/child')};
      });
      markDirty('root/child');return result;
    });
    await region.settled;expect(region.status).toBe('active');expect(host.querySelector('p')).toBe(kept);expect(factories).toBe(1);
    runWithApplicationRuntime(runtime,()=>region.dispose());
  } finally {runtime.dispose();host.remove();}
});

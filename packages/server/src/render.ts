/** Renderer implementation stays independent of the public HTTP/response barrel. */
import { stringTier, type StringRenderableNode } from './string-document';
import { escapeJsonForScriptTag } from './json-script';
import { RenderSession } from './session';
import type { RenderOptions, RenderPayload, RenderResult } from './index';
import type { ServerComponent } from './root-id';

export function createPayloadScriptTag(rootId:string,payload:RenderPayload):string {
  const safeJson=escapeJsonForScriptTag(JSON.stringify(payload));
  const safeRootId=rootId.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<script type="application/mmd+json" data-mmd-root="${safeRootId}">${safeJson}</script>`;
}
function serializeString(session:RenderSession,root:Node):string {
  return session.wrap((root as unknown as StringRenderableNode).toString(session.markers,session.initialBindings));
}
/** Prepare routes, settle request data, and return request-isolated HTML and payload. */
export async function render(component:ServerComponent,options:RenderOptions={}):Promise<RenderResult> {
  return RenderSession.execute(component,options,stringTier(),async session=>{
    await session.prepare();const root=session.mount();await session.settle();
    const html=serializeString(session,root), payload=session.payload();
    return {html,payload,scriptTag:session.carriesPayload?createPayloadScriptTag(session.rootId,payload):'',settlement:session.settlement};
  });
}
/** Synchronous shell only; routed preparation and request settlement need render(). */
export function renderToString(component:ServerComponent,options:Omit<RenderOptions,'mode'|'timeout'|'deadline'|'signal'>={}):string {
  return RenderSession.execute(component,options,stringTier(),session=>{
    if(session.initialDelivery&&session.initialDelivery.html===undefined)throw new Error('memo-dom: request-only HTML requires asynchronous rendering');
    return serializeString(session,session.mount());
  });
}

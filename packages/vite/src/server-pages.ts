/** Private, allowlisted page artifacts. Server handler graphs never enter browser compilation. */
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { compileServerPage, definePackageBoundaries, extractServerPages, memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow,
  type ServerFunctionModule, type ServerPageImport } from '@memoized-dom/compiler';
import type { GraphPluginContext } from './graph/collector';
import { valueImports } from './graph/imports';
import { cleanViteId, normalizeFile } from './paths';
import { clientServerFunctionSource, isServerFunctionFile, rewriteServerFunctionBarrelImports, type ServerFunctionBarrelEntry } from './server-functions';
import { resolveServerAlias } from './server-config';
import type { ResolvedAdapterOptions } from './options';

export const pageBindingsId = 'virtual:memoized-dom/page-bindings';
/** The loader owns delivery/cache work, not an independently changing UI value.
 * Use the ordinary boundary contract; do not teach the compiler a Vite name or
 * suppress opacity for arbitrary source factories/callbacks.
 */
export const pageBindingsBoundary = definePackageBoundaries({
  [pageBindingsId]: { loadPageBinding: {}, preparePageHydration: {} },
});
export const pageHydrationId = 'virtual:memoized-dom/page/hydrate.js';
const prefix = 'virtual:memoized-dom/page/';
export function isPageModule(id:string): boolean { return id.replace(/^\0/,'') === pageBindingsId || id.replace(/^\0/,'').startsWith(prefix); }
type Artifact = ReturnType<typeof compileServerPage>;

export class ServerPages {
  get enabled():boolean {return this.definitions.some(module=>module.functions.some(fn=>fn.page));}
  private prepared?: Promise<void>;
  private readonly implementations = new Map<string,string>();
  private readonly modules = new Map<string,string>();
  private readonly serverOnly = new Set<string>();
  private readonly pages: {id:string; artifact:Artifact; entry:string}[] = [];
  private readonly files = new Set<string>();
  private readonly styles = new Set<string>();
  owns(file:string):boolean {return this.files.has(normalizeFile(file));}
  constructor(private readonly root:string, private readonly options:ResolvedAdapterOptions,
    private readonly definitions:readonly ServerFunctionModule[], private readonly barrel:readonly ServerFunctionBarrelEntry[],
    private readonly diagnostics = false) {}

  private async resolve(context:GraphPluginContext,specifier:string, importer:string): Promise<string|undefined> {
    if (specifier.startsWith('#server/')) specifier=resolveServerAlias(this.root,specifier,this.options);
    const result=await context.resolve(specifier,importer,{skipSelf:true});
    return result && !result.external ? normalizeFile(cleanViteId(result.id)) : undefined;
  }

  async prepare(context:GraphPluginContext): Promise<void> {
    return this.prepared ??= this.build(context);
  }
  private async build(context:GraphPluginContext): Promise<void> {
    const frontend=this.options.frontend ?? memoizedEstreeFrontend;
    type Node = {type:string;[key:string]:unknown};
    const parsed = async (file:string) => {
      this.files.add(file);
      context.addWatchFile(file);
      return parseWithEstreeFrontendOrThrow(frontend,await readFile(file,'utf8'),{filename:file,sourceType:'module'}).program.body as unknown as Node[];
    };
    const name=(node:unknown):string => {const n=node as Node|undefined;return String(n?.name ?? n?.value ?? '');};
    const origin = async (specifier:string, imported:string, importer:string, seen=new Set<string>()):Promise<boolean> => {
      if (specifier === '@memoized-dom/server') return imported === 'page';
      if (!specifier.startsWith('.') && !specifier.startsWith('#server/')) return false;
      const file=await this.resolve(context,specifier,importer);
      if (!file || seen.has(file+'#'+imported)) return false;
      seen.add(file+'#'+imported);
      const statements=await parsed(file);
      for (const statement of statements) {
        if (statement.type !== 'ExportNamedDeclaration') continue;
        for (const item of statement.specifiers as Node[] ?? []) {
          if (name(item.exported) !== imported) continue;
          if (statement.source) return origin(name(statement.source),name(item.local),file,seen);
          for (const declaration of statements) if (declaration.type === 'ImportDeclaration') {
            const dependency=(declaration.specifiers as Node[]).find(entry=>name(entry.local)===name(item.local));
            if (dependency) return origin(name(declaration.source),name(dependency.imported),file,seen);
          }
        }
      }
      return false;
    };
    for (const definition of this.definitions) {
      if (!definition.functions.some(fn=>fn.page)) continue;
      const file=normalizeFile(definition.moduleId);
      const source=await readFile(file,'utf8');
      const providers:ServerPageImport[]=[];
      for (const statement of await parsed(file)) if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') {
        for (const specifier of statement.specifiers as Node[]) if (specifier.type === 'ImportSpecifier' &&
          await origin(name(statement.source),name(specifier.imported),file)) providers.push({module:name(statement.source),imported:name(specifier.imported)});
      }
      const moduleId='./'+relative(this.root,file).replaceAll('\\','/');
      const extracted=extractServerPages(source,{moduleId,frontend,pageImports:providers,wrap:true});
      if (!extracted.pages.length) throw new Error(`memo-dom: JSX in '${moduleId}' must be returned through the imported page() helper`);
      const delivery:Record<string,Artifact['delivery']>={};
      const serverExports:string[]=[];
      for (const page of extracted.pages) {
        const index=this.pages.length;
        const rootModule=moduleId+'.'+page.component+'.tsx';
        // A branch owns just its selected root, not every JSX branch in the handler.
        const companion=parseWithEstreeFrontendOrThrow(frontend,extracted.componentSource,{filename:rootModule,sourceType:'module'}).program;
        const rootSource=companion.body.filter(raw=>{
          const node=raw as unknown as Node;
          return node.type === 'ImportDeclaration'
            ? (node.specifiers as Node[]).some(specifier=>page.imports.includes(name(specifier.local)))
            : name((node.declaration as Node|undefined)?.id) === page.component;
        }).map(raw=>{const node=raw as unknown as {start:number;end:number};return extracted.componentSource.slice(node.start,node.end);}).join('\n');
        const sources:Record<string,string>={[rootModule]:rootSource};
        const files=new Map<string,string>([[rootModule,file]]);
        const resolutions=new Map<string,string>();
        const collect=async(id:string):Promise<void>=>{
          const program=parseWithEstreeFrontendOrThrow(frontend,sources[id]!,{filename:id,sourceType:'module'}).program;
          for (const {specifier} of valueImports(program)) {
            if (specifier.startsWith('@memoized-dom/') || specifier.startsWith('virtual:')) continue;
            const target=await this.resolve(context,specifier,files.get(id)!);
            if (!target) continue;
            if (!/\.(?:[jt]sx?|tsrx)$/.test(target)) {
              resolutions.set(id+'\0'+specifier,target);
              if (/\.(?:css|less|sass|scss|styl|stylus|pcss|postcss)$/.test(target)) {this.styles.add(target);this.files.add(target);context.addWatchFile(target);}
              continue;
            }
            const targetId='./'+relative(this.root,target).replaceAll('\\','/');
            resolutions.set(id+'\0'+specifier,targetId);
            if (sources[targetId] !== undefined) continue;
            context.addWatchFile(target);this.files.add(target);files.set(targetId,target);
            let code=await readFile(target,'utf8');
            if (isServerFunctionFile(this.root,target,this.options)) code=await clientServerFunctionSource(code,target,this.root,this.options);
            sources[targetId]=rewriteServerFunctionBarrelImports(code,this.barrel,{moduleId:targetId,frontend});
            await collect(targetId);
          }
        };
        await collect(rootModule);
        const artifact=compileServerPage(sources,rootModule,page.component,page.captures.length,{frontend,
          resolveImport:(specifier,importer)=>resolutions.get(importer+'\0'+specifier), renderableContent:true, diagnostics:this.diagnostics});
        delivery[page.component]=artifact.delivery;
        const virtual=(environment:string,id:string)=>prefix+index+'/'+environment+'/'+encodeURIComponent(id)+'.js';
        for (const [environment,output] of [['server',artifact.server],['client',artifact.browser]] as const) for (const [id,code] of Object.entries(output)) {
          const program=parseWithEstreeFrontendOrThrow(frontend,code,{filename:id,sourceType:'module'}).program;
          let rewritten=code;
          const edits:{start:number;end:number;text:string}[]=[];
          for (const raw of program.body) {
            const node=raw as unknown as Node;
            if (!['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) || !node.source) continue;
            const original=name(node.source);
            const target=resolutions.get(id+'\0'+original) ?? (original === rootModule ? rootModule : undefined);
            if (target && Object.hasOwn(output,target)) edits.push({start:(node.source as unknown as {start:number}).start,end:(node.source as unknown as {end:number}).end,text:JSON.stringify(virtual(environment,target))});
            else if (target && !sources[target]) edits.push({start:(node.source as unknown as {start:number}).start,end:(node.source as unknown as {end:number}).end,text:JSON.stringify(target)});
            else if (environment === 'client' && (original.startsWith('#server/') || original.startsWith('node:'))) throw new Error('memo-dom: a server-only dependency escaped page binding compilation');
          }
          for (const edit of edits.sort((a,b)=>b.start-a.start)) rewritten=rewritten.slice(0,edit.start)+edit.text+rewritten.slice(edit.end);
          this.modules.set(virtual(environment,id),rewritten);
          if (environment === 'server') this.serverOnly.add(virtual(environment,id));
        }
        const entry=prefix+index+'/bindings.js';
        this.modules.set(entry,`import {registerCompiledPage} from '@memoized-dom/runtime';import {${page.component}} from ${JSON.stringify(virtual('client',rootModule))};registerCompiledPage(${JSON.stringify(artifact.delivery.key)},${page.component},${JSON.stringify(page.component)});`);
        serverExports.push(`export {${page.component}} from ${JSON.stringify(virtual('server',rootModule))};`);
        this.pages.push({id:page.id,artifact,entry});
      }
      const companionId=prefix+encodeURIComponent(moduleId)+'/server.js';
      this.modules.set(companionId,serverExports.join('\n'));
      this.serverOnly.add(companionId);
      this.implementations.set(file,extractServerPages(source,{moduleId,frontend,pageImports:providers,wrap:true,delivery,componentModule:companionId}).source);
    }
  }
  implementation(file:string):string|undefined {return this.implementations.get(normalizeFile(file));}
  load(id:string,server:boolean):string|undefined {
    id=id.replace(/^\0/,'');
    if (!server && this.serverOnly.has(id)) throw new Error('memo-dom: server page implementations cannot be imported by the client graph');
    if (id === pageHydrationId) return `import {preparePageHydration} from ${JSON.stringify(pageBindingsId)};await preparePageHydration();`;
    if (id !== pageBindingsId) return this.modules.get(id);
    const entries=this.pages.map(page=>`${JSON.stringify(page.id)}:{key:${JSON.stringify(page.artifact.delivery.key)},load:()=>${server || page.artifact.delivery.browser === 'none' ? 'Promise.resolve()' : `import(${JSON.stringify(page.entry)})`}}`);
    const hydration=server ? 'export async function preparePageHydration(){}' : `export async function preparePageHydration(){
      const pending=[];
      function visit(value){if(!value||typeof value!=='object')return;if(value.$mmd==='page'&&value.version===1){pending.push(loadPageBinding(value.id,value.binding?.key));return;}for(const item of Object.values(value))visit(item);}
      for(const script of document.querySelectorAll('script[type="application/mmd+json"][data-mmd-root]')){let payload;try{payload=JSON.parse(script.textContent);}catch{continue;}for(const record of payload.state?.sources??[]){if(record.contractId==='mmd-fetch/v1:page:1'&&record.snapshot?.status==='success')visit(record.snapshot.data);}}
      await Promise.all(pending);}`;
    const styles=server ? '' : [...this.styles].map(file=>`import ${JSON.stringify(file)};`).join('\n');
    return `${styles}\nconst pages={${entries.join(',')}},loaded=new Map();export function loadPageBinding(id,key){const page=Object.hasOwn(pages,id)?pages[id]:undefined;if(!page||(key!==undefined&&key!==page.key))throw new Error('memo-dom: unknown or stale page binding contract');if(key===undefined||loaded.get(key)===true)return;if(loaded.has(key))return loaded.get(key);const pending=page.load().then(()=>{loaded.set(key,true)},error=>{loaded.delete(key);throw error});loaded.set(key,pending);return pending;}${hydration}`;
  }
}

/** Authored callback sources; DOM targets are supplied only during lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode, type BaseNode} from '../ast';
import {astBindingAt, variableDeclaratorFor, walkNodes, nodeHasJsx, type ComponentPath, type Ctx} from '../context';
import {planHandlerWrites} from '../handlers/analyze';
import type {HandlerWritePlan} from '../handlers/plan';
import type {RowWriteFacts} from '../handlers/write-facts';

type Callback = t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
export interface CallbackSourcePlan {
  readonly target: Callback;
  readonly helpers: readonly CallbackSourcePlan[];
  readonly writesFor: (row?:RowWriteFacts,eventBoundary?:boolean) => HandlerWritePlan;
}
export interface ComponentCallbacks {
  readonly forValue: (value:t.Expression,executionAware?:boolean) => CallbackSourcePlan | null;
  readonly forEvent: (value:t.Expression,executionAware?:boolean) => CallbackSourcePlan | null;
}

/** Resolve a factory-local declaration, excluding module and nested bindings. */
export function resolveLocalHelper(ctx:Ctx, path:ComponentPath, name:string):Callback|null {
  const binding=astBindingAt(ctx,path.node as unknown as BaseNode,name);
  if (!binding || binding.scope.getFunctionScope()?.block!==path.node) return null;
  if (binding.kind==='function' && binding.declarationNode.type==='FunctionDeclaration') return binding.declarationNode as Callback;
  const init=variableDeclaratorFor(ctx,binding)?.init;
  return init && (astFactory.isArrowFunctionExpression(init)||astFactory.isFunctionExpression(init)) ? init : null;
}

/**
 * Resolve `object.method` where `object` is a factory-local `const` object
 * literal and `method` is a non-computed property holding a function. Such a
 * command table is the same lexical helper as a named local function.
 */
export function resolveLocalMethod(ctx:Ctx, path:ComponentPath, object:string, method:string):Callback|null {
  const binding=astBindingAt(ctx,path.node as unknown as BaseNode,object);
  if (!binding || binding.scope.getFunctionScope()?.block!==path.node || binding.kind!=='const') return null;
  const init=variableDeclaratorFor(ctx,binding)?.init;
  if (!init || !astFactory.isObjectExpression(init)) return null;
  for (const property of init.properties) {
    if (!astFactory.isObjectProperty(property) || property.computed || property.kind!=='init') continue;
    const key=astFactory.isIdentifier(property.key) ? property.key.name :
      astFactory.isStringLiteral(property.key) ? property.key.value : null;
    if (key!==method) continue;
    const value=property.value as t.Node;
    return astFactory.isArrowFunctionExpression(value)||astFactory.isFunctionExpression(value) ? value : null;
  }
  return null;
}

/** A local callable name: `helper` or `object.method` for a local command table. */
export function localCallableName(callee:t.Node):string|null {
  if (astFactory.isIdentifier(callee)) return callee.name;
  if (astFactory.isMemberExpression(callee) && !callee.computed &&
      astFactory.isIdentifier(callee.object) && astFactory.isIdentifier(callee.property)) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

/** Resolve either a local helper or a local command-table method by name. */
export function resolveLocalCallable(ctx:Ctx, path:ComponentPath, name:string):Callback|null {
  const dot=name.indexOf('.');
  return dot<0 ? resolveLocalHelper(ctx,path,name) : resolveLocalMethod(ctx,path,name.slice(0,dot),name.slice(dot+1));
}

export function hasConditionalRootExecution(target:Callback):boolean {
  let conditional=false;
  walkNodes(target.body,node=>{
    if(node!==target.body&&astFactory.isFunction(node))return false;
    if(['IfStatement','SwitchStatement','ConditionalExpression','LogicalExpression','ForStatement',
      'ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement'].includes(node.type)){
      conditional=true;return false;
    }
  });
  return conditional;
}

/**
 * Capture lexical helper identities and immutable callback bodies before any
 * factory replacement. Semantic row facts parameterize writes; no generated
 * row id, refresh function, document or runtime identifier enters this plan.
 */
export function planComponentCallbacks(ctx:Ctx,name:string,path:ComponentPath):ComponentCallbacks {
  const sources=new Map<string,{copy:Callback;calls:readonly string[];conditional:boolean}>();
  const helpers=new Map<string,Callback>();
  const identity=(node:Callback)=>node.loc ? `${node.type}:${node.loc.start.line}:${node.loc.start.column}` : null;
  const capture=(node:Callback)=>{
    const calls=new Set<string>();
    walkNodes(node.body,child=>{
      const callee=astFactory.isCallExpression(child)?localCallableName(child.callee):null;
      if(callee!==null)calls.add(callee);
    });
    return {copy:node,calls:[...calls],conditional:hasConditionalRootExecution(node)};
  };
  // One parser-neutral snapshot also contains every nested callback body.
  walkNodes(cloneNode(path.node),node=>{
    if(!astFactory.isFunction(node))return;
    const callback=node as Callback,key=identity(callback);
    if(key)sources.set(key,capture(callback));
  });
  for(const statement of path.node.body.body) {
    const names=astFactory.isFunctionDeclaration(statement)&&statement.id ? [statement.id.name] :
      astFactory.isVariableDeclaration(statement) ? statement.declarations.flatMap(declaration=>
        astFactory.isIdentifier(declaration.id)?[declaration.id.name]:[]) : [];
    for(const local of names){const helper=resolveLocalHelper(ctx,path,local);if(helper)helpers.set(local,helper);}
    if(!astFactory.isVariableDeclaration(statement)||statement.kind!=='const')continue;
    for(const declaration of statement.declarations){
      if(!astFactory.isIdentifier(declaration.id)||!declaration.init||!astFactory.isObjectExpression(declaration.init))continue;
      for(const property of declaration.init.properties){
        if(!astFactory.isObjectProperty(property)||property.computed||!astFactory.isIdentifier(property.key))continue;
        const key=`${declaration.id.name}.${property.key.name}`,method=resolveLocalCallable(ctx,path,key);
        if(method)helpers.set(key,method);
      }
    }
  }
  // Backend replacement mutates ComponentPath.node. Preserve the authored
  // factory references used by semantic queries, sharing publication facts.
  // Write queries need this owner only; copying the module map per component
  // would make source retention grow quadratically with component count.
  const sourceCtx={...ctx,compPaths:new Map([[name,{...path}]])};
  function sourceFor(target:Callback,executionAware:boolean,seen:Set<Callback>):CallbackSourcePlan {
    const key=identity(target),source=key&&sources.get(key)||capture(cloneNode(target));
    const reachable:CallbackSourcePlan[]=[];
    for(const local of source.calls){
      const helper=helpers.get(local);
      if(!helper||seen.has(helper))continue;
      seen.add(helper);
      const helperSource=sources.get(identity(helper)!);
      reachable.push(sourceFor(helper,helperSource?.conditional??hasConditionalRootExecution(helper),seen));
    }
    return {target,helpers:reachable,writesFor:(row,eventBoundary=false)=>
      planHandlerWrites(sourceCtx,target,name,row,eventBoundary,executionAware,source.copy)};
  }
  const resolve=(value:t.Expression,executionAware:boolean)=>{
    const target=astFactory.isArrowFunctionExpression(value)||astFactory.isFunctionExpression(value) ? value :
      (()=>{const local=localCallableName(value);return local===null?undefined:helpers.get(local);})();
    return target?sourceFor(target,executionAware,new Set([target])):null;
  };
  return {
    forValue:(value,executionAware=true)=>{
      const source=resolve(value,executionAware);
      return source&&!nodeHasJsx(source.target.body)?source:null;
    },
    forEvent:(value,executionAware=false)=>resolve(value,executionAware),
  };
}

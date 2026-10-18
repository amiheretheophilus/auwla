/** Binding-aware recognition of authored provider and form calls. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode, printEstree, walkAst, type BaseNode} from '../ast';
import {astBindingAt,type Ctx} from '../context';

export function isCallToImported(
  ctx:Ctx,component:BaseNode,call:t.Expression|null|undefined,names:ReadonlySet<string>,
):boolean {
  if(!astFactory.isCallExpression(call)||!astFactory.isIdentifier(call.callee)||!names.has(call.callee.name))return false;
  return astBindingAt(ctx,component,call.callee.name)?.kind==='import';
}

/**
 * `const feed = tab === 'mine' ? getArticles(me) : getArticles(null)` names one
 * source whose request depends on `tab`. Lowered to the same factory with the
 * choice moved into its arguments, `getArticles(tab === 'mine' ? me : null)`, it
 * is an ordinary source that rebinds when its inputs change. Branches calling
 * different factories cannot share one source and are rejected.
 */
export function normalizeSourceChoices(
  ctx:Ctx,
  program:{node:t.Program;buildCodeFrameError(message:string,node?:t.Node):Error},
  factories:ReadonlySet<string>,
):boolean {
  if(factories.size===0)return false;
  let changed=false;
  const code=(node:t.Node)=>printEstree(node as unknown as BaseNode).code;
  walkAst(program.node as unknown as BaseNode,{enter(node){
    if(node.type!=='VariableDeclarator')return;
    const declarator=node as unknown as t.VariableDeclarator;
    const choice=declarator.init;
    if(!astFactory.isConditionalExpression(choice))return;
    const sourceCall=(branch:t.Expression)=>isCallToImported(ctx,branch as unknown as BaseNode,branch,factories)
      ?branch as t.CallExpression:null;
    const yes=sourceCall(choice.consequent),no=sourceCall(choice.alternate);
    if(yes===null&&no===null)return;
    const callee=(call:t.CallExpression|null)=>call!==null&&astFactory.isIdentifier(call.callee)?call.callee.name:null;
    if(yes===null||no===null||callee(yes)!==callee(no)||yes.arguments.length!==no.arguments.length||
        [...yes.arguments,...no.arguments].some(argument=>astFactory.isSpreadElement(argument))){
      throw program.buildCodeFrameError(
        'memo-dom: a conditional cannot choose between two data sources; call one factory and choose its arguments, '+
        'e.g. getArticles(cond ? a : b), or declare each source separately',choice);
    }
    declarator.init=astFactory.callExpression(astFactory.identifier(callee(yes)!),yes.arguments.map((argument,index)=>{
      const other=no.arguments[index]!;
      return code(argument as t.Node)===code(other as t.Node)?argument
        :astFactory.conditionalExpression(cloneNode(choice.test,true),argument as t.Expression,other as t.Expression);
    }));
    changed=true;
  }});
  return changed;
}

/** Data-flow projection for compiler-owned page binding inputs. No application code executes here. */
import { childNode, childNodes, identifierLikeName, nodeField, parseWithEstreeFrontendOrThrow,
  memoizedEstreeFrontend, type BaseNode, type EstreeFrontend } from './ast';

type Path = readonly (string | number)[];
type Value = { path: Path } | { fields: Map<string, Value | undefined> } | undefined;
type Environment = Map<string, Value>;

export function pageInputPaths(sources: Readonly<Record<string, string>>, root: string, component: string,
  count: number, resolveImport: (specifier: string, importer: string) => string | undefined,
  frontend: EstreeFrontend = memoizedEstreeFrontend): readonly Path[] {
  const programs = new Map(Object.entries(sources).map(([id, source]) => [id,
    parseWithEstreeFrontendOrThrow(frontend, source, {filename:id, sourceType:'module'}).program]));
  const paths = new Map<string, Path>();
  const active = new Set<BaseNode>();
  const consume = (value: Value): void => {
    if (!value) return;
    if ('path' in value) paths.set(JSON.stringify(value.path), value.path);
    else for (const field of value.fields.values()) consume(field);
  };
  function member(value: Value, key: string | number): Value {
    return value && ('path' in value ? {path:[...value.path,key]} : value.fields.get(String(key)));
  }
  function bind(pattern: BaseNode | null, value: Value, env: Environment): void {
    if (!pattern) return;
    if (pattern.type === 'Identifier') env.set(identifierLikeName(pattern)!, value);
    else if (pattern.type === 'AssignmentPattern') bind(childNode(pattern,'left'), value, env);
    else if (pattern.type === 'ObjectPattern') for (const property of childNodes(pattern,'properties')) {
      if (property.type === 'RestElement') { consume(value); continue; }
      const key = identifierLikeName(childNode(property,'key')) ?? nodeField(childNode(property,'key')!,'value');
      bind(childNode(property,'value'), member(value, String(key)), env);
    }
    else if (pattern.type === 'ArrayPattern') childNodes(pattern,'elements').forEach((item,index) => bind(item,member(value,index),env));
    else consume(value);
  }
  function declaration(id: string, name: string): {id:string;node:BaseNode} | undefined {
    const program = programs.get(id);
    if (!program) return;
    for (const statement of program.body) {
      if (statement.type === 'ImportDeclaration') {
        for (const specifier of childNodes(statement,'specifiers')) {
          if (identifierLikeName(childNode(specifier,'local')) !== name) continue;
          const target = resolveImport(String(nodeField(childNode(statement,'source')!,'value')), id);
          if (target) return declaration(target, identifierLikeName(childNode(specifier,'imported')) ?? 'default');
        }
      }
      const node = childNode(statement,'declaration') ?? statement;
      if (node.type === 'FunctionDeclaration' && (identifierLikeName(childNode(node,'id')) === name || name === 'default' && statement.type === 'ExportDefaultDeclaration')) return {id,node};
      if (node.type === 'VariableDeclaration') for (const item of childNodes(node,'declarations')) {
        const init = childNode(item,'init');
        if (identifierLikeName(childNode(item,'id')) === name && init && ['ArrowFunctionExpression','FunctionExpression'].includes(init.type)) return {id,node:init};
      }
    }
  }
  function invoke(id: string, node: BaseNode, args: Value[], outer: Environment = new Map()): void {
    if (active.has(node)) throw new Error('memo-dom: recursive page input projection is not supported');
    active.add(node);
    try {
      const env = new Map(outer);
      childNodes(node,'params').forEach((param,index) => bind(param,args[index],env));
      visit(childNode(node,'body'),env,id);
    } finally { active.delete(node); }
  }
  function expression(node: BaseNode | null, env: Environment, id: string): Value {
    if (!node) return;
    if (node.type === 'Identifier') return env.get(identifierLikeName(node)!);
    if (node.type === 'MemberExpression') {
      const object = expression(childNode(node,'object'),env,id);
      const property = childNode(node,'property');
      const key = nodeField(node,'computed') ? property && nodeField(property,'value') : identifierLikeName(property);
      if (typeof key !== 'string' && typeof key !== 'number') { consume(object); visit(property,env,id); return; }
      return member(object,key);
    }
    if (node.type === 'ObjectExpression') {
      const fields = new Map<string,Value>();
      for (const property of childNodes(node,'properties')) {
        if (property.type === 'SpreadElement') {consume(expression(childNode(property,'argument'),env,id));continue;}
        const key = identifierLikeName(childNode(property,'key')) ?? nodeField(childNode(property,'key')!,'value');
        fields.set(String(key),expression(childNode(property,'value'),env,id));
      }
      return {fields};
    }
    if (node.type === 'CallExpression') {
      const callee = childNode(node,'callee');
      const args = childNodes(node,'arguments');
      if (callee?.type === 'MemberExpression' && ['map','filter','find','some','every','forEach'].includes(identifierLikeName(childNode(callee,'property')) ?? '')) {
        const source = expression(childNode(callee,'object'),env,id);
        const callback = args[0];
        if (callback && ['ArrowFunctionExpression','FunctionExpression'].includes(callback.type)) invoke(id,callback,[member(source,'*')],env);
        else consume(source);
        return;
      }
      const fn = callee?.type === 'Identifier' ? declaration(id,identifierLikeName(callee)!) : undefined;
      const values = args.map(arg => expression(arg,env,id));
      if (fn) invoke(fn.id,fn.node,values,env);
      else { if (callee?.type === 'MemberExpression') consume(expression(childNode(callee,'object'),env,id)); values.forEach(consume); }
      return;
    }
    if (node.type === 'JSXElement') {
      const opening = childNode(node,'openingElement')!;
      const name = identifierLikeName(childNode(opening,'name'));
      const fn = name && /^[A-Z]/.test(name) ? declaration(id,name) : undefined;
      const props = new Map<string,Value>();
      for (const attribute of childNodes(opening,'attributes')) {
        const value = childNode(attribute,'value');
        const item = expression(value?.type === 'JSXExpressionContainer' ? childNode(value,'expression') : value,env,id);
        if (fn) props.set(identifierLikeName(childNode(attribute,'name'))!,item); else consume(item);
      }
      if (fn) {
        const params = childNodes(fn.node,'params');
        invoke(fn.id,fn.node,params[0]?.type === 'ObjectPattern' || params[0]?.type === 'AssignmentPattern'
          ? [{fields:props}] : params.map(param => props.get(identifierLikeName(param)!)));
      }
      for (const child of childNodes(node,'children')) visit(child,env,id);
      return;
    }
    if (['ArrowFunctionExpression','FunctionExpression'].includes(node.type)) { invoke(id,node,[],env); return; }
    for (const [key,value] of Object.entries(node)) {
      if (['loc','range','start','end','type','id','key','property'].includes(key)) continue;
      if (Array.isArray(value)) { for (const item of value) if (item && typeof item === 'object' && 'type' in item) visit(item as BaseNode,env,id); }
      else if (value && typeof value === 'object' && 'type' in value) visit(value as BaseNode,env,id);
    }
  }
  function visit(node: BaseNode | null, env: Environment, id: string): void {
    if (!node) return;
    if (node.type === 'VariableDeclaration') {
      for (const item of childNodes(node,'declarations')) bind(childNode(item,'id'),expression(childNode(item,'init'),env,id),env);
    } else if (node.type === 'BlockStatement') for (const item of childNodes(node,'body')) visit(item,env,id);
    else if (node.type !== 'FunctionDeclaration') consume(expression(node,env,id));
  }
  const fn = declaration(root,component);
  if (!fn) throw new Error('memo-dom: missing compiled page root');
  invoke(root,fn.node,[{fields:new Map(Array.from({length:count},(_,index) => [String(index),{path:[index]} as Value]))}]);
  return [...paths.values()];
}

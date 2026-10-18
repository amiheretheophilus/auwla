/** Link a server page to the existing HTML and initial-binding compiler products. */
import { compileModulesDetailed, type CompileModulesOptions } from './linker';
import { pageInputPaths } from './page-projection';
import { parseWithEstreeFrontendOrThrow, memoizedEstreeFrontend, printEstree, type BaseNode } from './ast';
import * as f from './ast/factory';
import type * as t from './ast/compiler-types';
import { createHash } from 'node:crypto';
import { isReferenceIdentifier, walkAst } from './ast';
import { GeneratedIdentifiers } from './dom/identifiers';

/** Keep static runtime reads visible to downstream application tree-shaking. */
function pageRuntimeMembers(program: t.Program, namespace: string): string[] | undefined {
  const members = new Set<string>();
  let opaque = false;
  walkAst<t.Node>(program, { enter(node, parent, key) {
    if (!f.isIdentifier(node) || node.name !== namespace || !isReferenceIdentifier(parent, key)) return;
    if (parent?.type === 'MemberExpression' && key === 'object') {
      const member = parent as t.MemberExpression;
      if (!member.computed && f.isIdentifier(member.property)) { members.add(member.property.name); return; }
      if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') {
        members.add(member.property.value); return;
      }
    }
    // Authored reflection/dynamic namespace access still needs the full API.
    // Compiler-owned runtime calls use statically named members.
    opaque = true;
  } });
  return opaque ? undefined : [...members].sort();
}

export function compileServerPage(sources: Readonly<Record<string,string>>, rootModule: string, component: string,
  captureCount: number, options: CompileModulesOptions = {}) {
  const entry = rootModule + '.mount.ts';
  const modules = { ...sources, [entry]: `import {mount} from ${JSON.stringify(options.runtimePath ?? '@memoized-dom/runtime')};import {${component}} from ${JSON.stringify(rootModule)};mount('__mmd_page_root',${component});` };
  const resolveImport = (specifier:string, importer:string) => specifier === rootModule ? rootModule : options.resolveImport?.(specifier,importer);
  const base = { ...options, resolveImport, hot:false, pageCaptureCount:captureCount, initialContent:true };
  const browser = compileModulesDetailed(modules, {...base,routedEnvironment:'client',scopedEvents:true,moduleStateCells:false});
  let delivery = browser.initialDelivery;
  if (!delivery) {
    let interactive=false;
    for (const [id,source] of Object.entries(sources)) walkAst<t.Node>(parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend,source,{filename:id,sourceType:'module'}).program as unknown as t.Node,{enter(node){
      if (f.isJSXAttribute(node) && node.name.type === 'JSXIdentifier' && (node.name.name === 'ref' || /^on[A-Z]/.test(node.name.name))) interactive=true;
      if (node.type === 'JSXSpreadAttribute') interactive=true;
      if (f.isCallExpression(node) && f.isIdentifier(node.callee) && ['$effect','$cleanup'].includes(node.callee.name)) interactive=true;
    }});
    if (!interactive) delivery={key:createHash('sha256').update(JSON.stringify([rootModule,component,sources])).digest('hex'),target:'__mmd_page_root',browser:'none'};
  }
  if (!delivery || delivery.browser === 'bindings' && (browser.initialRender.kind === 'browser' || browser.initialRender.kind === 'mixed')) {
    throw new Error('memo-dom: this server page needs an unsupported browser creation program; simplify its bindings or move server-only work into the handler: '+JSON.stringify(browser.initialRender));
  }
  const server = compileModulesDetailed(modules, {...base,diagnostics:false,routedEnvironment:'server',moduleStateCells:true});
  const paths = delivery.browser === 'bindings' ? pageInputPaths(sources,rootModule,component,captureCount,resolveImport,options.frontend) : [];
  const output: Record<string,string> = {};
  if (delivery.browser === 'bindings') for (const [id,code] of Object.entries(browser.output)) {
    if (id === entry) continue;
    const parsed = parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend,code,{filename:id,sourceType:'module'});
    const program = parsed.program as unknown as t.Program;
    const identifiers = new GeneratedIdentifiers(program);
    for (const statement of [...program.body]) {
      if (!f.isImportDeclaration(statement) || statement.source.value !== (options.runtimePath ?? '@memoized-dom/runtime')) continue;
      const specifier = statement.specifiers.find(item => item.type === 'ImportNamespaceSpecifier');
      if (!specifier) continue;
      const name = specifier.local.name;
      const members = pageRuntimeMembers(program, name);
      const baseName = identifiers.generate('pageRuntime').name;
      const selectedName = members === undefined ? baseName : identifiers.generate('pagePrimitives').name;
      specifier.local.name = baseName;
      const declarations: t.Statement[] = [];
      if (members !== undefined) declarations.push(f.variableDeclaration('const',[
        f.variableDeclarator(f.identifier(selectedName),f.objectExpression(members.map(member =>
          f.objectProperty(f.identifier(member),f.memberExpression(f.identifier(baseName),f.identifier(member)))))),
      ]));
      declarations.push(f.variableDeclaration('const',[f.variableDeclarator(f.identifier(name),f.identifier(selectedName))]));
      program.body.unshift(...declarations);
      for (const item of program.body) {
        const node = item.type === 'ExportNamedDeclaration' || item.type === 'ExportDefaultDeclaration' ? item.declaration : item;
        if (node?.type !== 'FunctionDeclaration') continue;
        node.body.body.unshift(f.variableDeclaration('const',[f.variableDeclarator(f.identifier(name),
          f.callExpression(f.memberExpression(f.identifier(baseName),f.identifier('bindRuntimeNamespace')),[f.identifier(selectedName)]))]));
      }
    }
    output[id] = printEstree(program as unknown as BaseNode).code;
  }
  return { server:server.output, browser:output, component, rootModule,
    delivery:{key:delivery.key,browser:delivery.browser,paths,styles:[...new Set(Object.values(server.css ?? {}))]},
  };
}

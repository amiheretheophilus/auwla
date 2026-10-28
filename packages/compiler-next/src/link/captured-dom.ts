/** Observe a captured default's own value, without following its original variable. */
import { findAll, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { CompileModulesOptions } from '../options';
import { DEFAULT_RUNTIME_PATH } from '../options';
import type { ModulePlan } from '../core/plan/model';
import { unwrap } from '../core/plan/jsx';
import { copy } from '../core/emit/copy';
import { Names } from '../core/emit/names';
import { expression, statement, statements } from '../core/emit/quote';
import type { EmittedModule } from './modules';

export function emitCapturedValues(
  plan: ModulePlan,
  emitted: EmittedModule,
  options: CompileModulesOptions,
): EmittedModule {
  const captures = plan.capturedExports ?? [];
  if (captures.length === 0) {
    return emitted;
  }

  const tree = copy(emitted.tree);
  const names = new Names(plan.module.module);
  for (const identifier of findAll(tree, 'Identifier')) {
    names.reserve(identifier.name);
  }
  for (const capture of captures) {
    names.reserve(capture.reader);
    names.reserve(capture.observer);
  }

  const runtime = names.fresh('_MD_default');
  const source = JSON.stringify(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
  const declarations: Node[] = [statement(`import * as ${runtime} from ${source};`)];
  let setup: {
    readonly value: string;
    readonly holder: string;
    readonly batch: string;
    readonly notify: string;
    readonly initialized: string;
    readonly inferName: boolean;
  } | undefined;
  const privateExports = new Set(emitted.privateExports);

  for (const capture of captures) {
    const value = names.fresh('_defaultValue');
    const holder = names.fresh('_defaultHolder');
    const version = names.fresh('_defaultVersion');
    const key = names.fresh('_defaultKey');
    const batch = names.fresh('_defaultWrites');
    const notify = names.fresh('_mutated_default');
    const current = names.fresh('_version_default');
    const initialized = names.fresh('_defaultReady');

    declarations.push(...statements(`
      let $$version = 0;
      var $$key = {};
      var $$initialized = false;
      const $$batch = $$runtime.createSharedWrites([$$key], []);
      function $$notify() {
        $$version++;
        $$batch.mark($$key);
      }
      function $$current() { return $$version; }
      function $$reader() {
        return $$runtime.trackRead($$current, $$value, $$key);
      }
      function $$observer(snapshot) {
        if ($$key !== void 0) {
          $$runtime.trackRead($$current, void 0, $$key);
          if (snapshot && $$initialized) return $$value;
        }
      }
      export { $$reader, $$observer };
    `, { version, key, batch, runtime, notify, current, value, initialized, reader: capture.reader, observer: capture.observer }));

    const original = capture.exported.node as Extract<Node, { type: 'ExportDefaultDeclaration' }>;
    const input = unwrap(original.declaration);
    const inferName = is.ArrowFunctionExpression(input)
      || ((is.FunctionExpression(input) || is.ClassExpression(input)) && input.id === null);
    setup = { value, holder, batch, notify, initialized, inferName };
    privateExports.add(capture.reader);
    privateExports.add(capture.observer);
  }

  tree.body = tree.body.flatMap((node) => {
    // ESM has one default export. Shared-owner composition may replace the
    // statement's AST identity, but preserves this native module declaration.
    const captured = setup;
    if (captured === undefined || !is.ExportDefaultDeclaration(node)) {
      return [node];
    }

    const { value, holder, batch, notify, initialized, inferName } = captured;
    const initialize = inferName ? [
      // A property initializer supplies the same contextual name as a native
      // default export. Keep the read separate: Bun folds a one-expression
      // property extraction and incorrectly infers the temporary's name.
      statement('let $$holder = { default: $$expression };', { holder, expression: node.declaration }),
      statement('const $$value = $$holder.default;', { value, holder }),
      statement('$$holder = null;', { holder }),
    ] : [statement('const $$value = $$expression;', { value, expression: node.declaration })];
    const exported = copy(node);
    exported.declaration = expression('$$value', { value });
    return [
      ...initialize,
      statement('$$initialized = true;', { initialized }),
      statement('$$batch.watch([{ read: () => $$value, notify: $$notify }]);', { batch, value, notify }),
      exported,
    ];
  });

  let insertion = 0;
  while (insertion < tree.body.length) {
    const entry = tree.body[insertion]!;
    if (!is.ExpressionStatement(entry) || typeof entry.directive !== 'string') {
      break;
    }
    insertion++;
  }
  tree.body.splice(insertion, 0, ...declarations as typeof tree.body);
  return { ...emitted, tree, privateExports };
}

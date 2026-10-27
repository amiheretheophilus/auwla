/** Compiled suspend values adapt the existing detached-region coordinator. */
import {
  createBuildScope,
  createComputation,
  createComponentValue,
  createPreparedRegion,
  createRenderValue,
  createValueSlot,
  createWriteBatch,
  getActiveEnvironment,
  getEntity,
  mutatedSince,
  mutationTime,
  ownCleanup,
  readPreparationScope,
  registerEntity,
  unregisterSubtree,
} from '@memoized-dom/runtime';
import { consumeSourceWaiting, presentSourceValue, readSourceValue, waitingSourceInputs, type SourcePresentation } from './source-readiness';
import { ownSourceFrame } from './source-scope';

type RenderProgram = Parameters<typeof createRenderValue>[0];
type RenderOwner = Parameters<RenderProgram['mount']>[1];
type RenderEntry = ReturnType<RenderProgram['mount']>;
type PresentationEntry = Omit<RenderEntry, 'nodes' | 'update'> & { nodes: Node[]; update(): void };

const programs = new Map<string, RenderProgram>();
let nextRegion = 0;

/** Props may forward handles; a host consumes its actual attribute values. */
export function createSourceComponentValue(
  callee: unknown,
  props: Record<PropertyKey, unknown>,
  key: unknown,
  policy?: SourcePresentation,
): unknown {
  consumeSourceWaiting(callee);

  for (const value of Object.values(props)) {
    consumeSourceWaiting(value);
  }

  const tagWaiting = waitingSourceInputs([callee, key === undefined ? props.key : key]);

  if (tagWaiting !== undefined) {
    return presentSourceValue(tagWaiting, policy);
  }

  const tag = readSourceValue(callee);
  const identity = readSourceValue(key === undefined ? props.key : key);

  if (typeof tag !== 'string') {
    return createComponentValue(tag, props, identity, policy);
  }

  const required = Object.entries(props).flatMap(([name, value]) => {
    return name === 'children' || name === 'suspend' || name.startsWith('on') ? [] : [value];
  });
  const waiting = waitingSourceInputs(required);

  if (waiting !== undefined) {
    return presentSourceValue(waiting, policy);
  }

  const attributes: Record<PropertyKey, unknown> = {};

  for (const property of Reflect.ownKeys(props)) {
    const value = props[property];

    if (typeof property === 'string' && property.startsWith('on')) {
      attributes[property] = waitingSourceInputs([value]) === undefined ? readSourceValue(value) : undefined;
    } else {
      attributes[property] = property === 'children' || property === 'suspend' ? value : readSourceValue(value);
    }
  }

  return createComponentValue(tag, attributes, identity, policy);
}

/** Each authored boundary has stable render identity, independently of its captures. */
export function createSuspendedSourceValue(
  site: string,
  read: () => unknown,
  policy: SourcePresentation = {},
  inputs: () => readonly unknown[] = () => [],
): object {
  let program = programs.get(site);

  if (program === undefined) {
    program = suspendedProgram(site);
    programs.set(site, program);
  }

  return createRenderValue(program, [read, policy, inputs]);
}

function suspendedProgram(site: string): RenderProgram {
  return {
    mount(values, owner) {
      const id = `${owner.id}/suspend${nextRegion++}`;
      let read = values[0] as () => unknown;
      let policy = values[1] as SourcePresentation;
      let inputs = values[2] as () => readonly unknown[];
      let previous: readonly unknown[] = [];
      let stamp = mutationTime();
      let region: ReturnType<typeof createPreparedRegion> | undefined;

      const entity = { id, parent: owner.entity?.id ?? null, render: () => update() };
      const batch = createWriteBatch(entity);
      const computation = createComputation(batch.mark, entity);

      registerEntity(entity);
      ownCleanup(id, () => {
        computation.dispose();
        region?.dispose();
      });

      const changedInputs = (): boolean => {
        computation.begin();

        const next = inputs();
        const changed = next.length !== previous.length || next.some((value, index) => {
          return !Object.is(value, previous[index]) || mutatedSince(value, stamp);
        });

        computation.end();
        previous = next;
        stamp = mutationTime();

        return changed;
      };

      const createEntry = (render: () => unknown, kind: string): PresentationEntry => {
        return presentationEntry(render, { ...owner, id, entity, batch }, `${id}/${kind}${nextRegion++}`);
      };

      changedInputs();

      const fragment = getActiveEnvironment().document.createDocumentFragment();

      region = createPreparedRegion(
        fragment,
        site,
        () => createEntry(() => read(), 'content'),
        policy.pending === undefined ? undefined : () => createEntry(() => policy.pending?.(), 'pending'),
        policy.error === undefined ? undefined : (error, retry) => createEntry(() => policy.error?.({ error, retry }), 'error'),
      );

      function update(): void {
        if (getEntity(id) !== entity || region === undefined) {
          return;
        }

        const changed = changedInputs();

        if (region.status === 'error' && changed) {
          region.restart();
        } else {
          region.update();
        }
      }

      batch.activate();

      return {
        nodes: Array.from(fragment.childNodes),
        update(next) {
          read = next[0] as () => unknown;
          policy = next[1] as SourcePresentation;
          inputs = next[2] as () => readonly unknown[];
          update();
        },
        dispose() {
          if (getEntity(id) === entity) {
            unregisterSubtree(id);
          }
        },
      };
    },
  };
}

/** This small entry owns only a value slot; the runtime owns staging and retry. */
function presentationEntry(read: () => unknown, owner: RenderOwner, id: string): PresentationEntry {
  const document = getActiveEnvironment().document;
  const fragment = document.createDocumentFragment();
  const anchor = document.createTextNode('');

  fragment.appendChild(anchor);

  const entity = { id, parent: owner.entity?.id ?? null, render: () => render() };
  const batch = createWriteBatch(entity);
  const scope = createBuildScope();
  const computation = createComputation(batch.mark, entity);

  registerEntity(entity);

  const slot = createValueSlot(anchor, { ...owner, id, entity, batch });

  ownCleanup(id, () => {
    computation.dispose();
    slot.dispose();
  });

  function render(): void {
    if (getEntity(id) !== entity) {
      return;
    }

    const frame = scope.enter(() => unregisterSubtree(id));

    ownSourceFrame(frame, id);
    computation.begin();
    readPreparationScope(id, 'content', () => slot.write(read()));
    computation.end();
    scope.leave(frame);
  }

  batch.beginMount();
  render();
  batch.activate();

  return {
    nodes: Array.from(fragment.childNodes),
    update: render,
    dispose() {
      if (getEntity(id) === entity) {
        unregisterSubtree(id);
      }
    },
  };
}

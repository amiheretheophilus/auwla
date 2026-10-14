import type { StandardSchemaV1 } from '@memoized-dom/data';
import {
  createDefine,
  serve,
  type DefinitionState,
  type DefinitionPlatform,
  type ServerFunctionArguments,
  type ServerFunctionResult,
  type ServiceValue,
} from '../src';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

interface State { requestId: string; user?: string }
interface Platform { region: string }
const define = createDefine<State, Platform>();
type StateCheck = Assert<Equal<DefinitionState<typeof define>, State>>;
type PlatformCheck = Assert<Equal<DefinitionPlatform<typeof define>, Platform>>;

const schema: StandardSchemaV1<{ id: string }, { id: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: value => ({ value: { id: Number((value as { id: string }).id) } }),
  },
};
const story = define.function({
  input: schema,
  async get({ state }, input) {
    type HandlerInputCheck = Assert<Equal<typeof input, { id: number }>>;
    type HandlerStateCheck = Assert<Equal<typeof state, State>>;
    // @ts-expect-error The schema output has a numeric id.
    const wrong: string = input.id;
    return { id: input.id, requestId: state.requestId };
  },
});
type ClientInputCheck = Assert<Equal<ServerFunctionArguments<typeof story>, readonly [input: { id: string }]>>;
type ResultCheck = Assert<Equal<ServerFunctionResult<typeof story>, { id: number; requestId: string }>>;

declare const clientStory: (...args: ServerFunctionArguments<typeof story>) => void;
clientStory({ id: '42' });
// @ts-expect-error The caller supplies the schema input, before transformation.
clientStory({ id: 42 });

const vote = define.function({ post: async ({ state }, id: number) => ({ id, by: state.user }) });
type PositionalCheck = Assert<Equal<ServerFunctionArguments<typeof vote>, [id: number]>>;

const noInput = define.function({ async get() { return ['story']; } });
type NoInputCheck = Assert<Equal<ServerFunctionArguments<typeof noInput>, []>>;
type NoInputResultCheck = Assert<Equal<ServerFunctionResult<typeof noInput>, string[]>>;

const scalarSchema: StandardSchemaV1<string, number> = {
  '~standard': { version: 1, vendor: 'test', validate: value => ({ value: Number(value) }) },
};
const scalar = define.function({
  input: scalarSchema,
  async post({ state }, id) {
    type ScalarOutputCheck = Assert<Equal<typeof id, number>>;
    return { id, requestId: state.requestId };
  },
});
type ScalarInputCheck = Assert<Equal<ServerFunctionArguments<typeof scalar>, readonly [input: string]>>;

// @ts-expect-error Every operation declares exactly one HTTP verb.
define.function({ async get() {}, async post() {} });
// @ts-expect-error A definition needs an HTTP verb handler.
define.function({});
// @ts-expect-error The prior method-chain declaration is no longer supported.
define.function.get(async () => []);

const database = define.service('database', async () => ({ name: 'primary' }));
type ServiceCheck = Assert<Equal<ServiceValue<typeof database>, { name: string }>>;
define.service('mailer', {
  dependencies: { database },
  create({ database }) {
    type DependencyCheck = Assert<Equal<typeof database, { name: string }>>;
    return { database: database.name };
  },
});

const app = serve({ define, state: () => ({ requestId: 'one' }) });
app.get('/account/:id', ({ state, platform, params }) => {
  type RouteStateCheck = Assert<Equal<typeof state, State>>;
  type RoutePlatformCheck = Assert<Equal<typeof platform, Platform | undefined>>;
  const id: string = params.id;
  return { id, requestId: state.requestId };
});

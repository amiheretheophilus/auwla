import type { StandardSchemaV1 } from '@memoized-dom/data';
import {
  createDefine,
  error,
  replyToSocket,
  serve,
  type DefinitionState,
  type DefinitionPlatform,
  type ServerContext,
  type ServerFunctionArguments,
  type ServerFunctionResult,
  type ServerSocketEvent,
  type ServerSocketInitial,
  type ServerSocketInput,
  type ServerSocketResult,
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
const liveNotes = define.function({
  async get({ state }, id: string) { return [{ id, by: state.requestId }]; },
  live: (_context, id) => { type LiveKeyInputCheck = Assert<Equal<typeof id, string>>; return ['notes', id]; },
});
type LiveResultCheck = Assert<Equal<ServerFunctionResult<typeof liveNotes>, { id: string; by: string }[]>>;
const saveLive = define.function({
  async post(_context, id: string, text: string) { return { id, text }; },
  updates: (_context, id) => { type UpdateKeyInputCheck = Assert<Equal<typeof id, string>>; return ['notes', id]; },
});
type LiveArgumentsCheck = Assert<Equal<ServerFunctionArguments<typeof saveLive>, [id: string, text: string]>>;
const reordered = define.function({
  async post(_context, text: string, expeditionId: number) { return { text, expeditionId }; },
  updates: (_context, _text, id) => {
    type TextPositionCheck = Assert<Equal<typeof _text, string>>;
    type IdPositionCheck = Assert<Equal<typeof id, number>>;
    return ['notes', id];
  },
});
type ReorderedArgumentsCheck = Assert<Equal<ServerFunctionArguments<typeof reordered>, [text: string, expeditionId: number]>>;
const callbackFirst = define.function({
  updates: (_context, id: string) => ['notes', id],
  async post(_context, id: string, text: string) { return { id, text }; },
});
type CallbackFirstCheck = Assert<Equal<ServerFunctionArguments<typeof callbackFirst>, [id: string, text: string]>>;
// Written before the handler with an untyped argument, as in `live: (context, id) => …`, a key
// can't get the handler's types: TypeScript types the object top to bottom and settles them as
// unknown at `live`. No signature changes that, so the compiler rejects that one order with a
// message to move it (packages/compiler/src/server/functions.ts, takesUntypedArguments).
// It happens only when the handler has an untyped parameter (its context): a handler with none
// is typed first, wherever it sits. These stay typed, and the compiler accepts them:
define.function({
  live: (_context, id) => {
    type LiveBeforeTypedHandlerCheck = Assert<Equal<typeof id, string>>;
    return ['a', id];
  },
  async get(_context: ServerContext<State, Platform>, id: string) { return { id }; },
});
define.function({
  live: () => ['payment'],
  refresh: (payment) => {
    type RefreshBeforeBareHandlerCheck = Assert<Equal<typeof payment, { state: string }>>;
    return '5s';
  },
  async get() { return { state: 'pending' }; },
});
const refreshed = define.function({
  async get(_context, reference: string) { return { reference }; },
  live: (_context, reference) => ['tracking', reference],
  refresh: '30s',
});
type RefreshArgumentsCheck = Assert<Equal<ServerFunctionArguments<typeof refreshed>, [reference: string]>>;
// @ts-expect-error refresh takes a duration in seconds or minutes.
define.function({ async get() { return 1; }, live: () => ['a'], refresh: 30 });
type PaymentState = 'pending' | 'succeeded' | 'failed';
define.function({
  async get(_context, reference: string) { return { reference, state: 'pending' as PaymentState }; },
  live: (_context, reference) => ['payment', reference],
  refresh: (payment) => {
    type RefreshResultCheck = Assert<Equal<typeof payment, { reference: string; state: PaymentState }>>;
    return payment.state === 'pending' ? '5s' : false;
  },
});
define.function({
  async get(_context, id: string) {
    if (id === '') return error({ message: 'Unavailable' }, { status: 503 });
    return { count: 1 };
  },
  live: (_context, id) => ['count', id],
  refresh: (last) => {
    type RefreshSkipsErrorCheck = Assert<Equal<typeof last, { count: number }>>;
    return '1m';
  },
});
// @ts-expect-error A refresh callback returns a duration or false.
define.function({ async get() { return 1; }, live: () => ['a'], refresh: () => 5 });
const streamed = define.function({ async *post(_context, prompt: string) { yield prompt; yield prompt + '!'; return undefined; } });
type StreamResultCheck = Assert<Equal<ServerFunctionResult<typeof streamed>, string>>;
const validatedLive = define.function({
  input: scalarSchema,
  live: (_context, input) => { type ValidatedKeyCheck = Assert<Equal<typeof input, number>>; return ['notes', input]; },
  async get(_context, input) { return input; },
});
type ValidatedLiveCheck = Assert<Equal<ServerFunctionArguments<typeof validatedLive>, readonly [input: string]>>;

const board = define.function({
  input: schema,
  live: (_context, input) => {
    type RoomKeyInputCheck = Assert<Equal<typeof input, { id: number }>>;
    return ['board', input.id];
  },
  async websocket({ state, platform }, input) {
    type SocketStateCheck = Assert<Equal<typeof state, State>>;
    type SocketPlatformCheck = Assert<Equal<typeof platform, Platform | undefined>>;
    type SocketSetupInputCheck = Assert<Equal<typeof input, { id: number }>>;
    if (!state.user) return new Response('Denied', { status: 403 });
    return {
      initial: async () => ({ id: input.id }),
      async message(text: string) {
        if (text.length === 0) return replyToSocket(false as const);
        return { text };
      },
    };
  },
});
type BoardSession = ServerFunctionResult<typeof board>;
type ConnectInputCheck = Assert<Equal<ServerFunctionArguments<typeof board>, readonly [input: { id: string }]>>;
type MessageInputCheck = Assert<Equal<ServerSocketInput<BoardSession>, string>>;
type InitialCheck = Assert<Equal<ServerSocketInitial<BoardSession>, { id: number }>>;
type EventCheck = Assert<Equal<ServerSocketEvent<BoardSession>, { id: number } | { text: string }>>;
type ReplyCheck = Assert<Equal<ServerSocketResult<BoardSession>, false | { text: string }>>;

const positionalSocket = define.function({
  websocket(_context, room: string) {
    return { message: (text: string) => `${room}: ${text}` };
  },
  live: (_context, room) => {
    type RoomArgumentCheck = Assert<Equal<typeof room, string>>;
    return ['board', room];
  },
});
type PositionalSocketCheck = Assert<Equal<ServerFunctionArguments<typeof positionalSocket>, [room: string]>>;

define.invalidate(['notes', 'one']);
app.get('/account/:id', ({ state, platform, params }) => {
  type RouteStateCheck = Assert<Equal<typeof state, State>>;
  type RoutePlatformCheck = Assert<Equal<typeof platform, Platform | undefined>>;
  const id: string = params.id;
  return { id, requestId: state.requestId };
});

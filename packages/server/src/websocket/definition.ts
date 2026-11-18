const PRIVATE_REPLY = Symbol.for('memo-dom:socket-reply');

export interface SocketReply<T> {
  readonly [PRIVATE_REPLY]: true;
  readonly value: T;
}

/** Return a result to the client that sent the message. */
export function replyToSocket<T>(value: T): SocketReply<T> {
  return { [PRIVATE_REPLY]: true, value };
}

export function isSocketReply(value: unknown): value is SocketReply<unknown> {
  return typeof value === 'object' && value !== null && Reflect.get(value, PRIVATE_REPLY) === true;
}

/** The setup result belongs to one connection and can close over its server context. */
export interface ServerSocketSession<Input = never, Initial = unknown, Result = unknown, Departure = unknown> {
  readonly initial?: Initial | (() => Initial | Promise<Initial>);
  message(input: Input): Result | Promise<Result>;
  close?(): Departure | Promise<Departure>;
}

export type ServerSocketInput<Session> =
  Session extends ServerSocketSession<infer Input> ? Input : never;

type MessageResult<Session> =
  Session extends ServerSocketSession<never, unknown, infer Result> ? Awaited<Result> : never;

export type ServerSocketInitial<Session> =
  Session extends { readonly initial: infer Initial }
    ? Initial extends () => infer Value ? Awaited<Value> : Awaited<Initial>
    : undefined;

export type ServerSocketEvent<Session> =
  Exclude<ServerSocketInitial<Session> | MessageResult<Session> | DepartureResult<Session>, SocketReply<unknown> | void>;

type DepartureResult<Session> = Session extends { close(): infer Result } ? Awaited<Result> : never;

export type ServerSocketResult<Session> =
  MessageResult<Session> extends infer Result
    ? Result extends SocketReply<infer Value> ? Value : Result
    : never;

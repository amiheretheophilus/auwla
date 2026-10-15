/** Optional compiler-owned response protocols; ordinary fetches keep normal decoding. */
import type { StandardSchemaV1 } from './types';

type ResponseDecoder = (response: Response) => Promise<unknown>;
const decoders = new WeakMap<StandardSchemaV1, ResponseDecoder>();
type ResponseStreamDecoder = (response: Response, signal: AbortSignal) => AsyncIterable<unknown>;
const streamDecoders = new WeakMap<StandardSchemaV1, ResponseStreamDecoder>();
export function registerResponseStreamDecoder(schema: StandardSchemaV1, decode: ResponseStreamDecoder): void { streamDecoders.set(schema, decode); }
export function responseStreamDecoder(schema: StandardSchemaV1 | undefined): ResponseStreamDecoder | undefined { return schema === undefined ? undefined : streamDecoders.get(schema); }

export function registerResponseDecoder(schema: StandardSchemaV1, decode: ResponseDecoder): void {
  decoders.set(schema, decode);
}

export function responseDecoder(schema: StandardSchemaV1 | undefined): ResponseDecoder | undefined {
  return schema === undefined ? undefined : decoders.get(schema);
}

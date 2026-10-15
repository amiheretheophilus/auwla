/** Optional compiler-owned response protocols; ordinary fetches keep normal decoding. */
import type { StandardSchemaV1 } from './types';

type ResponseDecoder = (response: Response) => Promise<unknown>;
const decoders = new WeakMap<StandardSchemaV1, ResponseDecoder>();

export function registerResponseDecoder(schema: StandardSchemaV1, decode: ResponseDecoder): void {
  decoders.set(schema, decode);
}

export function responseDecoder(schema: StandardSchemaV1 | undefined): ResponseDecoder | undefined {
  return schema === undefined ? undefined : decoders.get(schema);
}

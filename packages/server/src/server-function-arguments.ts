/**
 * A server function's arguments, from the HTTP request that carries them: a GET's in the query,
 * one scalar type each (`queryKind`); any other method's as a JSON object in the body; a
 * WebSocket's as JSON in the `args` query parameter; and a function with an `input` schema's as
 * one JSON value, which the schema checks. Malformed input is the client's mistake: a 400 that
 * says what was wrong, never a server failure.
 */
import type { StandardSchemaV1 } from '@memoized-dom/data';
import type { ServerFunctionRouteParameter } from './http-router';

/** Input the client sent wrong: answered with a 400 (`serverFunctionError`). */
export class ServerFunctionInputError extends Error {}

function serverFunctionInputError(message: string): never {
  throw new ServerFunctionInputError(message);
}

/** The 400 answer for input the client sent wrong. */
export function serverFunctionError(error: ServerFunctionInputError): Response {
  return Response.json({
    error: 'invalid_server_function_input',
    message: error.message,
  }, { status: 400 });
}

function scalarQueryValue(
  name: string,
  value: string,
  kind: 'string' | 'number' | 'boolean',
): string | number | boolean {
  if (kind === 'string') return value;
  if (kind === 'number') {
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)) {
      return serverFunctionInputError(`Query parameter '${name}' must be a finite number`);
    }
    return number;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return serverFunctionInputError(`Query parameter '${name}' must be 'true' or 'false'`);
}

/** A GET's arguments, by name from the query, each read as its declared type. */
export function queryArguments(
  url: URL,
  parameters: readonly ServerFunctionRouteParameter[],
): unknown[] {
  const known = new Set(parameters.map(parameter => parameter.name));
  for (const name of url.searchParams.keys()) {
    if (!known.has(name)) {
      serverFunctionInputError(`Unknown query parameter '${name}'`);
    }
  }
  return parameters.map((parameter) => {
    const kind = parameter.queryKind ?? 'string';
    const values = url.searchParams.getAll(parameter.name);
    if (values.length === 0) {
      if (parameter.optional) return undefined;
      return serverFunctionInputError(`Missing query parameter '${parameter.name}'`);
    }
    if (kind.endsWith('[]')) {
      const scalarKind = kind.slice(0, -2) as 'string' | 'number' | 'boolean';
      return values.map(value => scalarQueryValue(parameter.name, value, scalarKind));
    }
    if (values.length !== 1) {
      return serverFunctionInputError(`Query parameter '${parameter.name}' must appear once`);
    }
    return scalarQueryValue(parameter.name, values[0]!, kind as 'string' | 'number' | 'boolean');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Any other method's arguments, by name from a JSON object body. */
export async function bodyArguments(
  request: Request,
  parameters: readonly ServerFunctionRouteParameter[],
): Promise<unknown[]> {
  if (parameters.length === 0 && request.body === null) return [];
  let body: unknown;
  try {
    const text = await request.text();
    if (parameters.length === 0 && text.trim() === '') return [];
    body = JSON.parse(text);
  } catch {
    return serverFunctionInputError('Request body must be valid JSON');
  }
  return namedArguments(body, parameters);
}

function namedArguments(value: unknown, parameters: readonly ServerFunctionRouteParameter[]): unknown[] {
  const body = value;
  if (!isRecord(body)) {
    return serverFunctionInputError('Request body must be a JSON object');
  }
  const known = new Set(parameters.map(parameter => parameter.name));
  for (const name of Object.keys(body)) {
    if (!known.has(name)) {
      serverFunctionInputError(`Unknown request body field '${name}'`);
    }
  }
  return parameters.map((parameter) => {
    if (!Object.hasOwn(body, parameter.name)) {
      if (parameter.optional) return undefined;
      return serverFunctionInputError(`Missing request body field '${parameter.name}'`);
    }
    return body[parameter.name];
  });
}

/** A WebSocket connection's arguments, from JSON in its one `args` query parameter. */
export function socketArguments(url: URL, parameters: readonly ServerFunctionRouteParameter[]): unknown[] {
  const values = url.searchParams.getAll('args');
  if (values.length !== 1 || [...url.searchParams.keys()].some(name => name !== 'args')) {
    return serverFunctionInputError("WebSocket connection arguments must appear once as 'args'");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(values[0]!);
  } catch {
    return serverFunctionInputError('WebSocket connection arguments must be valid JSON');
  }
  return namedArguments(parsed, parameters);
}

/** Check a schema-owned input: the handler's one argument, or the schema's 400 answer. */
export async function validateServerFunctionArguments(
  schema: StandardSchemaV1,
  input: unknown,
): Promise<unknown[] | Response> {
  const result = await schema['~standard'].validate(input);
  if (result.issues !== undefined) {
    return Response.json({
      error: 'invalid_server_function_input',
      message: 'Input validation failed',
      issues: result.issues,
    }, { status: 400 });
  }
  return [result.value];
}

/** A schema-owned GET input: JSON in its one `input` query parameter. */
export function querySchemaInput(url: URL): unknown {
  for (const name of url.searchParams.keys()) {
    if (name !== 'input') serverFunctionInputError(`Unknown query parameter '${name}'`);
  }
  const values = url.searchParams.getAll('input');
  if (values.length !== 1) {
    return serverFunctionInputError("Validated GET input must appear once as query parameter 'input'");
  }
  try {
    return JSON.parse(values[0]!);
  } catch {
    return serverFunctionInputError('Validated GET input must be valid JSON');
  }
}

/** A schema-owned input of any other method: the JSON body. */
export async function bodySchemaInput(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return serverFunctionInputError('Request body must be valid JSON');
  }
}

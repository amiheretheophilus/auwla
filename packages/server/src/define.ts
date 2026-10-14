import type { StandardSchemaV1 } from '@memoized-dom/data';
import type {
  RegisteredServerServices,
  ServerContext,
  ServerMiddleware,
} from './http-router';

export type ServerFunctionMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

declare const SERVER_FUNCTION_TYPES: unique symbol;

export interface DefinedServerFunction<
  TArguments extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
  TState extends object = object,
  TPlatform = unknown,
  TServices extends object = RegisteredServerServices,
  THandlerArguments extends readonly unknown[] = TArguments,
> {
  readonly [SERVER_FUNCTION_TYPES]?: {
    readonly arguments: TArguments;
    readonly result: TResult;
  };
  readonly method: ServerFunctionMethod;
  readonly handler: (
    context: ServerContext<TState, TPlatform, TServices>,
    ...args: THandlerArguments
  ) => Promise<TResult>;
  readonly middleware: readonly ServerMiddleware<TState, TPlatform, TServices>[];
  readonly input?: StandardSchemaV1;
}

export type ServerFunctionArguments<TFunction> =
  TFunction extends { readonly [SERVER_FUNCTION_TYPES]?: { readonly arguments: infer TArguments } }
    ? TArguments
    : never;

export type ServerFunctionResult<TFunction> =
  TFunction extends { readonly [SERVER_FUNCTION_TYPES]?: { readonly result: infer TResult } }
    ? TResult
    : never;

type ServerFunctionHandler<
  TState extends object,
  TPlatform,
  TServices extends object,
  TArguments extends readonly unknown[],
  TResult,
> = (
  context: ServerContext<TState, TPlatform, TServices>,
  ...args: TArguments
) => Promise<TResult>;

type ServerFunctionVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

type OneFunctionMethod<THandler> = {
  [TMethod in ServerFunctionVerb]:
    { readonly [TKey in TMethod]: THandler } &
    { readonly [TKey in Exclude<ServerFunctionVerb, TMethod>]?: never };
}[ServerFunctionVerb];

export type ServerFunctionDescriptor<
  TState extends object,
  TPlatform,
  TServices extends object,
  TArguments extends readonly unknown[],
  TResult,
> = {
  readonly middleware?: readonly ServerMiddleware<TState, TPlatform, TServices>[];
  readonly input?: undefined;
} & OneFunctionMethod<ServerFunctionHandler<
  TState,
  TPlatform,
  TServices,
  TArguments,
  TResult
>>;

type SchemaInput<TSchema> =
  TSchema extends StandardSchemaV1<infer TInput, unknown> ? TInput : never;

type SchemaOutput<TSchema> =
  TSchema extends StandardSchemaV1<unknown, infer TOutput> ? TOutput : never;

export type ServerFunctionInputDescriptor<
  TState extends object,
  TPlatform,
  TServices extends object,
  TSchema extends StandardSchemaV1,
  TResult,
> = {
  readonly middleware?: readonly ServerMiddleware<TState, TPlatform, TServices>[];
  readonly input: TSchema;
} & OneFunctionMethod<ServerFunctionHandler<
  TState,
  TPlatform,
  TServices,
  readonly [input: SchemaOutput<TSchema>],
  TResult
>>;

export interface DefineServerFunction<
  TState extends object,
  TPlatform,
  TServices extends object,
> {
  <TSchema extends StandardSchemaV1, TResult>(
    descriptor: ServerFunctionInputDescriptor<
      TState,
      TPlatform,
      TServices,
      TSchema,
      TResult
    >,
  ): DefinedServerFunction<
    readonly [input: SchemaInput<TSchema>],
    TResult,
    TState,
    TPlatform,
    TServices,
    readonly [input: SchemaOutput<TSchema>]
  >;
  <TArguments extends readonly unknown[], TResult>(
    descriptor: ServerFunctionDescriptor<
      TState,
      TPlatform,
      TServices,
      TArguments,
      TResult
    >,
  ): DefinedServerFunction<TArguments, TResult, TState, TPlatform, TServices>;
}

export interface ServiceDefinition<
  TName extends string = string,
  TValue = unknown,
> {
  readonly name: TName;
  readonly dependencies: Readonly<Record<string, ServiceDefinition>>;
  readonly create: (
    dependencies: Readonly<Record<string, unknown>>,
  ) => TValue | Promise<TValue>;
}

export type ServiceValue<TService> =
  TService extends ServiceDefinition
    ? Awaited<ReturnType<TService['create']>>
    : never;

type ServiceDependencies = Readonly<Record<string, ServiceDefinition>>;

type ResolvedDependencies<TDependencies extends ServiceDependencies> = {
  readonly [TKey in keyof TDependencies]: ServiceValue<TDependencies[TKey]>;
};

export interface ServiceDescriptor<
  TDependencies extends ServiceDependencies,
  TValue,
> {
  readonly dependencies: TDependencies;
  readonly create: (
    dependencies: ResolvedDependencies<TDependencies>,
  ) => TValue | Promise<TValue>;
}

const SERVER_DEFINITION = Symbol('memoized-dom.server-definition');

interface ServerDefinitionRuntime {
  readonly services: Map<string, ServiceDefinition>;
}

export interface ServerDefinition<
  TState extends object = Record<string, never>,
  TPlatform = unknown,
  TServices extends object = RegisteredServerServices,
> {
  readonly [SERVER_DEFINITION]: ServerDefinitionRuntime & {
    readonly state?: TState;
    readonly platform?: TPlatform;
    readonly serviceTypes?: TServices;
  };
  readonly function: DefineServerFunction<TState, TPlatform, TServices>;
  middleware<TMiddleware extends ServerMiddleware<TState, TPlatform, TServices>>(
    middleware: TMiddleware,
  ): TMiddleware;
  service<TName extends string, TValue>(
    name: TName,
    create: () => TValue | Promise<TValue>,
  ): ServiceDefinition<TName, TValue>;
  service<
    TName extends string,
    TDependencies extends ServiceDependencies,
    TValue,
  >(
    name: TName,
    descriptor: ServiceDescriptor<TDependencies, TValue>,
  ): ServiceDefinition<TName, TValue>;
}

export type DefinitionState<TDefinition> =
  TDefinition extends { readonly [SERVER_DEFINITION]: { readonly state?: infer TState } }
    ? TState
    : never;

export type DefinitionPlatform<TDefinition> =
  TDefinition extends { readonly [SERVER_DEFINITION]: { readonly platform?: infer TPlatform } }
    ? TPlatform
    : never;

function createFunctionDefinition<
  TState extends object,
  TPlatform,
  TServices extends object,
>(): DefineServerFunction<TState, TPlatform, TServices> {
  return (<TArguments extends readonly unknown[], TResult>(
    descriptor:
      | ServerFunctionDescriptor<TState, TPlatform, TServices, TArguments, TResult>
      | ServerFunctionInputDescriptor<TState, TPlatform, TServices, StandardSchemaV1, TResult>,
  ): DefinedServerFunction<TArguments, TResult, TState, TPlatform, TServices> => {
    if (typeof descriptor !== 'object' || descriptor === null) {
      throw new TypeError('memo-dom: define.function() requires an object definition');
    }
    const methods = (['get', 'post', 'put', 'patch', 'delete'] as const)
      .filter(method => Object.hasOwn(descriptor, method));
    if (methods.length !== 1) {
      throw new TypeError('memo-dom: define.function() requires exactly one HTTP method: get, post, put, patch, or delete');
    }
    const method = methods[0]!;
    const handler = descriptor[method];
    if (typeof handler !== 'function') {
      throw new TypeError(`memo-dom: define.function() '${method}' must be a function`);
    }
    return Object.freeze({
      method: method.toUpperCase() as ServerFunctionMethod,
      handler,
      middleware: Object.freeze([...(descriptor.middleware ?? [])]),
      ...(descriptor.input === undefined ? {} : { input: descriptor.input }),
    }) as unknown as DefinedServerFunction<
      TArguments,
      TResult,
      TState,
      TPlatform,
      TServices
    >;
  }) as DefineServerFunction<TState, TPlatform, TServices>;
}

/** Create the one definition object shared by an application's server code. */
export function createDefine<
  TState extends object = Record<string, never>,
  TPlatform = unknown,
  TServices extends object = RegisteredServerServices,
>(): ServerDefinition<TState, TPlatform, TServices> {
  const runtime: ServerDefinitionRuntime = { services: new Map() };
  const registerService = <TName extends string, TValue>(
    name: TName,
    value: (() => TValue | Promise<TValue>) | ServiceDescriptor<ServiceDependencies, TValue>,
  ): ServiceDefinition<TName, TValue> => {
    if (name.length === 0) {
      throw new TypeError('memo-dom: define.service() requires a non-empty name');
    }
    if (runtime.services.has(name)) {
      throw new TypeError(`memo-dom: service '${name}' is already defined`);
    }
    const descriptor = typeof value === 'function'
      ? { dependencies: Object.freeze({}), create: () => value() }
      : value;
    const service: ServiceDefinition<TName, TValue> = Object.freeze({
      name,
      dependencies: Object.freeze({ ...descriptor.dependencies }),
      create: descriptor.create as ServiceDefinition<TName, TValue>['create'],
    });
    runtime.services.set(name, service);
    return service;
  };
  return Object.freeze({
    [SERVER_DEFINITION]: runtime,
    function: createFunctionDefinition<TState, TPlatform, TServices>(),
    middleware<TMiddleware extends ServerMiddleware<TState, TPlatform, TServices>>(
      middleware: TMiddleware,
    ): TMiddleware {
      return middleware;
    },
    service: registerService,
  }) as ServerDefinition<TState, TPlatform, TServices>;
}

/** Build an isolated lazy service cache for one serve() application. */
export function createServiceResolver<
  TState extends object,
  TPlatform,
  TServices extends object,
>(
  definition: ServerDefinition<TState, TPlatform, TServices>,
): () => Promise<Record<string, unknown>> {
  const runtime = definition[SERVER_DEFINITION];
  const values = new Map<ServiceDefinition, Promise<unknown>>();
  const resolving: ServiceDefinition[] = [];

  const resolveService = (service: ServiceDefinition): Promise<unknown> => {
    if (runtime.services.get(service.name) !== service) {
      return Promise.reject(new Error(
        `memo-dom: service dependency '${service.name}' must be registered on the same define object`,
      ));
    }
    const cached = values.get(service);
    if (cached !== undefined) return cached;
    const cycleAt = resolving.indexOf(service);
    if (cycleAt !== -1) {
      const cycle = [...resolving.slice(cycleAt), service]
        .map(item => item.name)
        .join(' -> ');
      return Promise.reject(new Error(`memo-dom: service dependency cycle: ${cycle}`));
    }
    resolving.push(service);
    const pending = Promise.all(Object.entries(service.dependencies).map(
      async ([name, dependency]) => [name, await resolveService(dependency)] as const,
    )).then(entries => service.create(Object.freeze(Object.fromEntries(entries))));
    resolving.pop();
    values.set(service, pending);
    pending.catch(() => values.delete(service));
    return pending;
  };

  let all: Promise<Record<string, unknown>> | undefined;
  return async () => {
    if (all === undefined) {
      all = Promise.all([...runtime.services].map(
        async ([name, service]) => [name, await resolveService(service)] as const,
      )).then(entries => Object.freeze(Object.fromEntries(entries)));
      all.catch(() => { all = undefined; });
    }
    return all;
  };
}

/** The colorless action surface awaits the request the existing engine dispatched. */
import { disposeFetchResource, resourceController } from './resource';
import type { FetchResource, ResolvedValue } from './types';

export function transparentFetchResult<T>(resource: FetchResource<T>): ResolvedValue<T> | Promise<T> {
  const controller = resourceController(resource);

  if (controller.paused || controller.descriptor.method === 'GET') {
    return resource as unknown as ResolvedValue<T>;
  }

  // Calling refresh here would dispatch twice. The entry already owns the
  // original request, including decoding, validation and cancellation.
  const request = controller.entry?.request ?? Promise.resolve(controller.snapshot.data);

  const result = request.then(
    (value) => {
      disposeFetchResource(resource);

      return value as T;
    },
    (error: unknown) => {
      disposeFetchResource(resource);

      throw error;
    },
  );

  // Fire-and-forget actions can outlive an owner. Runtime cancellation is
  // observed internally while a caller awaiting this promise still rejects.
  void result.then(undefined, () => undefined);

  return result;
}

# @memoized-dom/utils

This project does not support legacy APIs. All packages and consumers must use the current APIs. Do not add compatibility shims, deprecated aliases, or fallback paths for superseded APIs.

Optional helpers for Memoized DOM applications.

```tsx
import { optimistic } from '@memoized-dom/utils';

const vote = optimistic({
  action: (direction: 'up' | 'down') => saveVote(story.id, direction),
  apply(direction) {
    const change = direction === 'up' ? 1 : -1;
    story.votes += change;
    return error => {
      story.votes -= change;
      voteError = error.message;
    };
  },
});
```

`action` starts a fresh operation and returns an MMD trackable source or a
promise. `vote` returns that same result. The `apply` callback runs immediately
and receives the operation ID as an optional second parameter. Its rollback
function runs only if that operation fails; it may ignore the error parameter.
Each overlapping call has its own rollback. Plain promises are wrapped in a
temporary `$read` source, while `$fetch` and server-function results are
tracked directly. An optional `reconcile(saved, payload, id)` callback replaces
temporary data with the server's returned data without refetching.

The returned function can be called directly from an event handler or passed
as a `$forms` action. `$forms` owns validation and submission state; this
utility owns the optimistic change and rollback.

## Protecting live sources

Use `source: notes`, or `source: [notes, summary]` for multiple live sources, in
the `optimistic()` options. The compiler preserves those bindings; callbacks
still own the immediate change, rollback, and reconciliation. Each source holds
its newest incoming snapshot until all associated operations settle, and does
not apply a snapshot older than a successful mutation acknowledgement. This is
optional and separate from grouping IDs; it neither serializes requests nor
replays callbacks. See the self-contained
[streaming guide](../../docs/live-streaming-design.md#optimistic-authoring-preserve-callbacks-associate-the-source)
for full examples and the delivery contract.

## Grouping repeated updates by ID

Pass an optional second argument on each invocation:

```ts
changeCount(payload);                     // reconcile every successful call
changeCount(payload, { id: counter.id }); // reconcile this counter's burst once
```

The ID identifies the resource or value being updated. Use the same string or
number for all buttons that change the same counter, and different IDs for
different counters:

```tsx
interface Counter { id: string; count: number }

const changeCount = optimistic({
  action: ({ counter, delta }: { counter: Counter; delta: number }) =>
    updateCounter(counter.id, delta),

  apply({ counter, delta }) {
    counter.count += delta;
    return () => { counter.count -= delta; };
  },

  reconcile(saved, { counter }) {
    counter.count = saved.count;
  },
});

return counters.map(counter => (
  <div key={counter.id}>
    <span>{counter.count}</span>
    <button onClick={() =>
      changeCount({ counter, delta: 1 }, { id: counter.id })
    }>+</button>
    <button onClick={() =>
      changeCount({ counter, delta: -1 }, { id: counter.id })
    }>−</button>
  </div>
));
```

Every click still starts its request and applies its optimistic change
immediately. While any call with that ID is pending, successful responses
are held instead of overwriting the displayed value. Once the group settles,
`reconcile` runs once with the most recently started successful call's result,
payload, and operation ID. Response arrival order does not select the winner.
Each failed call still runs its own rollback; if every call fails, there is no
reconciliation. Calls arriving while a group is pending join that group. After
it settles, another call with that ID starts a new group.
Aborted source calls stop holding the group open and supply no reconciliation
result.

IDs are scoped to the function returned by `optimistic()`. Different IDs settle
independently. The caller-provided ID groups updates; the operation ID received
by `apply` and `reconcile` still uniquely identifies an individual request.
Omitting the options, passing `{}`, or passing `{ id: undefined }` keeps the
per-call behavior. The original request result is returned unchanged.

Use grouped reconciliation for repeated writes to one value or resource. For
inserting separate rows, omit the grouping ID so every successful insertion
gets its own reconciliation.

For a form, provide the ID in the action wrapper:

```ts
const form = $forms((fields: FormData) => changeCount(
  { counter, delta: Number(fields.get('delta')) },
  { id: counter.id },
));
```

# Cross-instance live invalidation: under discussion

Status: being discussed. No adapter API or implementation has been selected.
This note records why the capability matters, not a proposed solution.

## Current limitation

Live invalidations are held in memory by each application instance. A mutation
reruns matching queries subscribed to that instance, but does not notify another
Node/Bun process, container, worker instance, or serverless instance.

When a deployment scales horizontally, a browser's long-lived live connection
can reach one instance while its mutation reaches another. The write may succeed
in a shared database while that browser and other subscribers remain stale.
An open browser connection does not prove that cross-instance notifications are
working. This limitation does not affect the current single-instance demonstration.

## Why we want to address it

- Preserve live-query behavior when applications move from one instance to many.
- Keep backend choice out of function and component authoring.
- Preserve per-subscriber authorization rather than sharing computed private data.
- Preserve optimistic protection: today's confirmation cursors belong to one
  instance and cannot establish equivalent confirmation across different instances.
- Make missed notifications, reconnects, and publication failures explicit rather
  than silently leaving clients stale.

Invalidation delivery does not replicate an application's in-memory service data.
Likewise, a successful database write and successful notification delivery are
different events; an interrupted publication must not be mistaken for proof that
the write rolled back. These correctness and failure boundaries are part of the
ongoing discussion.

See [live queries and streaming functions](./live-streaming-design.md) for the
implemented single-instance behavior. Distributed invalidation remains outside
that implementation; this document intentionally specifies no adapter contract,
provider driver, or configuration API.

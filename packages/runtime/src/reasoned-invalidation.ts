/** Exact cause merging is selected only by invalidation paths carrying causes. */
import { mergeDirtyReasons, type DirtyReasonInput } from './dirty-reasons';
import {
  enqueueEntityInvalidation, enqueueEntityInvalidations, enqueueSubtreeInvalidation,
  getEntity, registeredIds,
  type EntityId,
} from './kernel';

/** General runtime API preserves exact causes and full-update dominance. */
export function markDirty(id: EntityId, reason?: DirtyReasonInput): void {
  enqueueEntityInvalidation(id, reason, mergeDirtyReasons);
}
export function markDirtyMany(ids: readonly EntityId[], reason?: DirtyReasonInput): void {
  enqueueEntityInvalidations(ids, reason, mergeDirtyReasons);
}
export function markDirtySubtree(id: EntityId, ownerId?: EntityId, ownerReason?: DirtyReasonInput): void {
  enqueueSubtreeInvalidation(id, ownerId, ownerReason, mergeDirtyReasons);
}

/** A separately compiled component cannot know its consuming application's root name. */
export function markOwnerRootDirty(ownerId?: EntityId, ownerReason?: DirtyReasonInput): void {
  // A shared module handler has no lexical instance. Preserve its conservative
  // fallback in the active runtime without inventing a publisher-owned root ID.
  if (ownerId === undefined) {
    enqueueEntityInvalidations(registeredIds(), undefined, mergeDirtyReasons);
    return;
  }
  let id = ownerId;
  let entity = getEntity(id);
  // A static component need not register an update entity of its own.
  while (entity === undefined) {
    const end = id.lastIndexOf('/');
    if (end < 0) return;
    id = id.slice(0, end);
    entity = getEntity(id);
  }
  while (entity.parent !== null) {
    const parent = getEntity(entity.parent);
    if (parent === undefined) break;
    entity = parent;
  }
  markDirtySubtree(entity.id, ownerId, ownerReason);
}

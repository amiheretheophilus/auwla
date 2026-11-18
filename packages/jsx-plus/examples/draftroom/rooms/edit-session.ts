import type { Project } from '../model/types';
import { diffProject } from './diff';
import { mergeProject } from './merge';
import type { EditResult, ProjectPatch, RoomSnapshot } from './protocol';

interface Workspace {
  project(): Project;
  showRoom(project: Project): void;
}

interface Edit {
  id: string;
  patch: ProjectPatch;
  settled?: (revision?: number) => void;
}

interface HistoryEntry {
  forward: ProjectPatch;
  inverse: ProjectPatch;
}

export function createEditSession(
  initial: RoomSnapshot,
  workspace: Workspace,
  post: (edit: Edit) => Promise<EditResult | null>,
  busy: () => boolean,
  publish: () => void,
) {
  let confirmed = initial;
  let appliedRevision = initial.revision;
  let shown = initial.project;
  let running = false;
  let paused = false;
  let closed = false;
  let problem: string | undefined;
  const pending: Edit[] = [];
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];

  function reconcile(): void {
    // Finish the local pointer or text gesture against its original board before merging incoming edits.
    if (busy() || closed) return;

    let merged = confirmed.project;
    for (const edit of pending) {
      merged = mergeProject(merged, edit.patch) ?? merged;
    }
    appliedRevision = confirmed.revision;
    workspace.showRoom(merged);
    shown = workspace.project();
  }

  function receive(snapshot: RoomSnapshot): void {
    if (closed || snapshot.revision <= confirmed.revision) return;

    confirmed = snapshot;
    reconcile();
  }

  function pause(message: string): void {
    running = false;
    paused = true;
    problem = message;
    for (const edit of pending) {
      edit.settled?.();
    }
    publish();
  }

  function send(): void {
    const first = pending[0];
    if (closed || running || paused || first === undefined) return;

    running = true;
    void post(first).then(result => {
      if (closed) return;

      if (result === null) {
        pause('This room is unavailable. Your edits are still in this tab.');
        return;
      }

      running = false;
      pending.shift();
      if (result.snapshot.revision >= confirmed.revision) confirmed = result.snapshot;
      if (!result.accepted) {
        problem = 'Someone changed the same object. Draftroom kept their version.';
        past.length = 0;
        future.length = 0;
      }
      reconcile();
      first.settled?.(result.accepted ? result.snapshot.revision : undefined);
      publish();
      send();
    }, () => {
      if (closed) return;

      pause('Sync interrupted. Retry to send your pending edits.');
    });
  }

  function enqueue(patch: ProjectPatch, settled?: Edit['settled']): void {
    if (!paused) problem = undefined;
    else settled?.();
    pending.push({ id: crypto.randomUUID(), patch, settled });
    publish();
    send();
  }

  function change(project: Project, settled?: Edit['settled']): void {
    const before = shown;
    shown = project;
    const forward = diffProject(before, project);
    if (forward.length === 0) {
      settled?.();
      return;
    }

    past.push({ forward, inverse: diffProject(project, before) });
    if (past.length > 80) past.shift();
    future.length = 0;
    enqueue(forward, settled);
  }

  function travel(direction: 'undo' | 'redo'): void {
    const source = direction === 'undo' ? past : future;
    const destination = direction === 'undo' ? future : past;
    const entry = source.pop();
    if (entry === undefined) return;

    const patch = direction === 'undo' ? entry.inverse : entry.forward;
    const project = mergeProject(workspace.project(), patch);
    if (project === undefined) {
      problem = 'That edit overlaps a newer change from a collaborator.';
      publish();
      return;
    }

    destination.push(entry);
    workspace.showRoom(project);
    shown = workspace.project();
    enqueue(patch);
  }

  function retry(): void {
    paused = false;
    problem = undefined;
    send();
    publish();
  }

  return {
    receive, change, travel, reconcile, retry,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    queued: () => pending.length,
    revision: () => appliedRevision,
    error: () => problem,
    offline: () => paused,
    close: () => { closed = true; },
  };
}

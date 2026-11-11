import { JsxPlusError, type Repair } from '../../diagnostics';
import { hasError, parseModule } from '../../host';
import { blankRange } from '../../masks';
import { normalizeForChecking } from '../../normalize';
import type { NormalizedSource, Range, VerbatimMapping } from '../../model';
import { blank } from '../../repairs';

export interface RecoveredMarkup {
  readonly normalized: NormalizedSource;
  readonly errors: readonly JsxPlusError[];
}

/** At most this many repairs for one projection. */
const MAX_REPAIRS = 3;
/** At most this many re-reads of the file per projection, so a keystroke stays cheap. */
const MAX_READS = 24;

interface Insertion {
  readonly at: number;
  readonly text: string;
}

/**
 * The edits one recovery makes to the authored source: blanked ranges (same
 * UTF-16 width, line endings kept) and inserted closers, all in authored offsets.
 * The patched text is what is read again; `authored` maps its offsets back.
 */
class Patch {
  constructor(readonly holes: readonly Range[] = [], readonly insertions: readonly Insertion[] = []) {}

  get size(): number {
    return this.holes.length + this.insertions.length;
  }

  /** Whether `repair` touches text this patch already changed. */
  conflicts(repair: Repair): boolean {
    if (repair.kind === 'blank') {
      const [start, end] = repair.range;
      return this.holes.some((hole) => start < hole[1] && hole[0] < end)
        || this.insertions.some((insertion) => start < insertion.at && insertion.at < end);
    }
    return this.insertions.some((insertion) => insertion.at === repair.at)
      || this.holes.some((hole) => hole[0] < repair.at && repair.at < hole[1]);
  }

  with(repair: Repair): Patch {
    if (repair.kind === 'blank') {
      return new Patch([...this.holes, repair.range].sort((a, b) => a[0] - b[0]), this.insertions);
    }
    const insertions = [...this.insertions, { at: repair.at, text: repair.text }].sort((a, b) => a.at - b.at);
    return new Patch(this.holes, insertions);
  }

  apply(source: string): string {
    let text = source;
    for (const [start, end] of this.holes) {
      text = blankRange(text, start, end);
    }
    for (const insertion of [...this.insertions].reverse()) {
      text = text.slice(0, insertion.at) + insertion.text + text.slice(insertion.at);
    }
    return text;
  }

  /** The authored offset of a patched offset; inside inserted text, where it was inserted. */
  authored(offset: number): number {
    let shift = 0;
    for (const insertion of this.insertions) {
      const at = insertion.at + shift;
      if (offset < at) {
        break;
      }
      if (offset < at + insertion.text.length) {
        return insertion.at;
      }
      shift += insertion.text.length;
    }
    return offset - shift;
  }

  /** The patched ranges holding inserted text. */
  inserted(): Range[] {
    let shift = 0;
    return this.insertions.map((insertion) => {
      const start = insertion.at + shift;
      shift += insertion.text.length;
      return [start, start + insertion.text.length];
    });
  }

  /** Mappings read from the patched text, in authored offsets, without inserted text. */
  authoredMappings(mappings: readonly VerbatimMapping[]): VerbatimMapping[] {
    const inserted = this.inserted();
    const result: VerbatimMapping[] = [];
    for (const mapping of mappings) {
      let cursor = mapping.authored[0];
      const end = mapping.authored[1];
      const include = (to: number) => {
        if (cursor >= to) {
          return;
        }
        const generated = mapping.generated[0] + cursor - mapping.authored[0];
        const authored = this.authored(cursor);
        result.push({
          kind: 'verbatim',
          generated: [generated, generated + to - cursor],
          authored: [authored, authored + to - cursor],
        });
      };
      for (const [start, stop] of inserted) {
        if (stop <= cursor || start >= end) {
          continue;
        }
        include(start);
        cursor = Math.min(end, stop);
      }
      include(end);
    }
    return result;
  }

  /** An error read from the patched text, in authored offsets. */
  authoredError(error: JsxPlusError, source: string): JsxPlusError {
    if (this.insertions.length === 0) {
      return error;
    }
    const repairs = error.repairs.map((repair): Repair => {
      if (repair.kind === 'blank') {
        return blank([this.authored(repair.range[0]), this.authored(repair.range[1])]);
      }
      return { ...repair, at: this.authored(repair.at) };
    });
    const range: Range = [this.authored(error.range[0]), this.authored(error.range[1])];
    return new JsxPlusError(error.code, error.reason, error.filename, range, source, repairs);
  }
}

function lineAt(source: string, position: number): Range {
  let start = position;
  let end = position;
  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') {
    start--;
  }
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
    end++;
  }
  return [start, end];
}

/** Only unmodified characters are eligible for native diagnostics/editor edits. */
function outsideHoles(mappings: readonly VerbatimMapping[], holes: readonly Range[]): VerbatimMapping[] {
  const result: VerbatimMapping[] = [];
  for (const mapping of mappings) {
    let cursor = mapping.authored[0];
    const end = mapping.authored[1];
    function include(to: number) {
      if (cursor < to) {
        const start = mapping.generated[0] + cursor - mapping.authored[0];
        result.push({ kind: 'verbatim', generated: [start, start + to - cursor], authored: [cursor, to] });
      }
    }
    for (const hole of holes) {
      if (hole[1] <= cursor || hole[0] >= end) {
        continue;
      }
      include(hole[0]);
      cursor = Math.min(end, hole[1]);
    }
    include(end);
  }
  return result;
}

/**
 * Whether every blanked character was blank or inside markup that read again
 * completely, and every closer was inserted inside such markup. Such a patch
 * changed only that markup, which normalized to a whole JSX expression, so it
 * cannot cause a host syntax error elsewhere.
 */
function onlyMarkupPatched(source: string, normalized: NormalizedSource, patch: Patch): boolean {
  const roots = normalized.roots.map((root): Range => [patch.authored(root.range[0]), patch.authored(root.range[1])]);
  const inRoot = (offset: number) => roots.some(([start, end]) => start <= offset && offset < end);
  return patch.insertions.every((insertion) => inRoot(insertion.at)) && patch.holes.every(([start, end]) => {
    for (let index = start; index < end; index++) {
      if (source[index]!.trim() !== '' && !inRoot(index)) {
        return false;
      }
    }
    return true;
  });
}

/** A repair to try for an error; `own` when it fixes the error where it is. */
interface Candidate {
  readonly repair: Repair;
  readonly own: boolean;
}

/**
 * What to try for an error, best first: the reporter's own repairs (a missing
 * closer such as `)`, which keeps the line being typed checked; an unclosed
 * element's opening tag; a stray closing tag), then setting aside the whole line,
 * then the error to the end of its line. The last keeps host code before the
 * error (`const banner =`); the whole line comes first because a narrower range
 * leaves fragments such as `aria-label=` that cause errors of their own, and a
 * whole line that held host code is rejected by `accept` anyway.
 */
function candidates(source: string, error: JsxPlusError): Candidate[] {
  const at = error.range[0];
  const line = lineAt(source, at);
  const repairs: Repair[] = [...error.repairs, blank(line)];
  if (source.slice(line[0], at).trim() !== '') {
    repairs.push(blank([at, line[1]]));
  }

  const result: Candidate[] = [];
  for (const repair of repairs) {
    if (repair.kind === 'blank') {
      const [start, end] = repair.range;
      const known = result.some(({ repair: other }) => other.kind === 'blank' && other.range[0] === start && other.range[1] === end);
      if (start >= end || known) {
        continue;
      }
      result.push({ repair, own: start <= at && at < end });
    } else {
      result.push({ repair, own: true });
    }
  }
  return result;
}

/**
 * Editor recovery for damaged markup in this exact revision: the fewest repairs
 * that let the rest of the file read. Each repair inserts a missing closer
 * (unmapped, so it is never shown as authored text) or sets a likely-damaged range
 * aside. A breadth-first search over `candidates`, bounded by `MAX_REPAIRS`
 * and `MAX_READS`.
 *
 * A recovered file must still have authored code mapped. A host syntax error
 * that remains is accepted only when the patch could not have caused it
 * (`onlyMarkupPatched`): it is the author's own, left mapped for native
 * TypeScript recovery as in an undamaged file. Otherwise the module must parse.
 *
 * The first error is always reported. A later error is reported only when its
 * repair fixed it where it is; one fixed by setting aside another range
 * (`</main>` after a half-typed `</fo`) was only a consequence. Recovery is never
 * used for production compilation and never borrows an older projection.
 */
export function recoverMarkup(source: string, filename: string, first: JsxPlusError): RecoveredMarkup | null {
  let reads = 0;

  function accept(normalized: NormalizedSource, patch: Patch): NormalizedSource | null {
    if (!onlyMarkupPatched(source, normalized, patch) && hasError(parseModule(normalized.code).diagnostics)) {
      return null;
    }
    const mappings = outsideHoles(patch.authoredMappings(normalized.mappings), patch.holes);
    if (!mappings.some((mapping) => source.slice(...mapping.authored).trim() !== '')) {
      return null;
    }
    return { ...normalized, mappings };
  }

  // Visit all one-repair candidates before trying two repairs. A recursive
  // depth-first search could discard more code before reaching a simpler fix.
  const pending: { patch: Patch; errors: readonly JsxPlusError[]; error: JsxPlusError }[] = [
    { patch: new Patch(), errors: [], error: first },
  ];
  for (let index = 0; index < pending.length; index++) {
    const { patch, errors, error } = pending[index]!;
    for (const candidate of candidates(source, error)) {
      if (reads >= MAX_READS) {
        return null;
      }
      if (patch.conflicts(candidate.repair)) {
        continue;
      }

      const next = patch.with(candidate.repair);
      const reported = errors.length === 0 || candidate.own ? [...errors, error] : errors;
      reads++;
      try {
        const normalized = accept(normalizeForChecking(next.apply(source), filename), next);
        if (normalized !== null) {
          return { normalized, errors: reported };
        }
      } catch (thrown) {
        if (!(thrown instanceof JsxPlusError)) {
          throw thrown;
        }
        if (next.size < MAX_REPAIRS) {
          pending.push({ patch: next, errors: reported, error: next.authoredError(thrown, source) });
        }
      }
    }
  }
  return null;
}

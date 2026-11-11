import { projectForChecking } from '../checking/project';
import type { CheckingSource } from '../checking/protocol';

type Projector = typeof projectForChecking;

interface CachedTransform {
  readonly fileName: string;
  readonly content: string;
  readonly result: CheckingSource;
}

/** One latest transform per open project; no ASTs or edit history are retained. */
export class CheckingProject {
  private cached: CachedTransform | undefined;

  constructor(private readonly projector: Projector = projectForChecking) {}

  transform(content: string, fileName: string): CheckingSource {
    const cached = this.cached;
    if (cached !== undefined && cached.fileName === fileName && cached.content === content) {
      return cached.result;
    }

    // Keep the full checking result together: text, diagnostics, supplemental
    // views and UTF-16 maps must all describe the same exact source revision.
    const result = this.projector(content, fileName);
    this.cached = { fileName, content, result };
    return result;
  }
}

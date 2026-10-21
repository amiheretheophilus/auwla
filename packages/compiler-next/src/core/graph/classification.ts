/** Facts shared between feature classifiers; features never import each other. */
import type { Binding, WriteSite } from '../resolve';
import type { InitialComputation, ReadFact } from './model';

export interface BindingComputation {
  readonly binding: Binding;
  readonly initial: InitialComputation | null;
  readonly reads: readonly ReadFact[];
  readonly opaque: boolean;
  /** Actual execution context decides which of these reassignments takes control. */
  readonly takeovers: readonly WriteSite[];
}

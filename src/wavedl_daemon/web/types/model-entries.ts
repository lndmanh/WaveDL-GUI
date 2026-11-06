import type { ModelDescription } from './catalog-api';

/**
 * One architecture as the user thinks of it. The catalogue lists `x` and
 * `x_pretrained` separately; weights only load when the run also sets `pretrained`.
 */
export interface ModelEntry {
  readonly key: string;
  /** Trains from scratch; null when the architecture only ships a weights-capable id. */
  readonly scratch: ModelDescription | null;
  /** Accepts `pretrained: true`; null when no ImageNet weights exist. */
  readonly weighted: ModelDescription | null;
  /** The description shown for the entry (the from-scratch variant when both exist). */
  readonly primary: ModelDescription;
}

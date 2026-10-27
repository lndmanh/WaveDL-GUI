import { clientError } from '../i18n/client-messages';
import { trainingRequestSchema, type TrainingRequest } from '../../shared/schemas/training-request';
import {
  inferenceDefaults,
  resultRequestSchema,
  type ResultRequest,
} from '../../shared/schemas/result-request';
import type { PlanView, RunView } from './daemon-api';
import type { CheckpointOption } from './result-operations';

export interface AutoPlotCapture {
  readonly daemonId: string;
  readonly revision: number;
  readonly run: RunView;
  readonly approvedPlan: PlanView;
  readonly request: TrainingRequest;
}
export interface AutoPlotIntent {
  readonly request: ResultRequest;
  readonly idempotencyKey: string;
}
export interface AutoPlotObservation {
  readonly daemonId: string;
  readonly connected: boolean;
  readonly revision: number;
  readonly freshness: 'fresh' | 'stale' | 'unconfirmed';
  readonly run: RunView;
  /** Caller obtains these through checkpointOptions' verified metadata downloads. */
  readonly publications: readonly CheckpointOption[];
}

/** One submitted training workflow, not whichever run happens to be selected.
 * Pure intent coordination: the caller must revalidate grants before planning
 * and use the same daemon plan/key for retries. No HTTP or lifecycle authority
 * is inferred here. Detach/shutdown permanently disarms this instance.
 */
export class AutoPlotWorkflow {
  #capture: AutoPlotCapture;
  #intent: AutoPlotIntent | null = null;
  #state: 'armed' | 'planned' | 'submitted' | 'stopped' = 'armed';
  constructor(capture: AutoPlotCapture) {
    const request = trainingRequestSchema.parse(capture.request);
    if (
      !capture.run.submission_requested ||
      capture.run.operation !== 'train' ||
      capture.approvedPlan.run_id !== capture.run.run_id ||
      capture.approvedPlan.request_id !== capture.run.request_id ||
      capture.approvedPlan.plan_id !== capture.run.plan_id
    )
      throw clientError('autoPlotAlreadySubmitted', {});
    this.#capture = structuredClone({ ...capture, request });
  }
  get state() {
    return this.#state;
  }
  stop(): void {
    this.#state = 'stopped';
    this.#intent = null;
  }
  observe(observation: AutoPlotObservation): AutoPlotIntent | null {
    const capture = this.#capture;
    if (
      !observation.connected ||
      observation.revision !== capture.revision ||
      observation.daemonId !== capture.daemonId
    ) {
      this.stop();
      return null;
    }
    const run = observation.run;
    if (
      this.#state === 'stopped' ||
      this.#state === 'submitted' ||
      capture.request.config.cv > 0 ||
      observation.freshness !== 'fresh' ||
      run.run_id !== capture.run.run_id ||
      run.plan_id !== capture.run.plan_id ||
      run.request_id !== capture.run.request_id ||
      run.operation !== 'train' ||
      run.backend !== capture.request.backend ||
      run.state !== 'completed' ||
      run.uncertainty ||
      run.cancellation_requested ||
      run.attempt === null ||
      run.evidence?.native_pending === true
    )
      return null;
    const best = observation.publications.filter(
      (option) =>
        option.selectable &&
        option.classification.kind === 'best' &&
        option.artifact.runId === run.run_id &&
        option.artifact.attempt === run.attempt,
    );
    if (new Set(best.map((option) => option.artifact.generation)).size !== best.length) return null;
    // Core select_checkpoint(purpose='best') uses newest numeric publication,
    // not step (which can reset), directory order, or newest periodic checkpoint.
    best.sort((left, right) => {
      const a = BigInt(left.artifact.generation.slice(4));
      const b = BigInt(right.artifact.generation.slice(4));
      return a < b ? 1 : a > b ? -1 : 0;
    });
    if (!best[0]) return null;
    const source = best[0].artifact;
    if (this.#intent) {
      return this.#intent.request.checkpoint_source.generation === source.generation
        ? structuredClone(this.#intent)
        : null;
    }
    const config = capture.request.config;
    const request = resultRequestSchema.parse({
      backend: capture.request.backend,
      operation: 'plot',
      runtime: capture.request.runtime,
      // Test/plot execute one process, not the distributed training launcher.
      // Preserve runtime/device/storage authority; the daemon must reject any
      // operator resource policy that cannot express this separate plot plan.
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
      ...(capture.request.storage_map === undefined
        ? {}
        : { storage_map: capture.request.storage_map }),
      checkpoint_source: { run_id: run.run_id, generation: source.generation },
      config: {
        ...inferenceDefaults,
        data_path: config.data_path,
        model: config.model,
        import_modules: config.import_modules,
        batch_size: config.batch_size,
        workers: Math.max(0, config.workers),
        plot: true,
      },
    });
    this.#intent = {
      request,
      // Deterministic across browser reconstruction; daemon persists this key.
      idempotencyKey: `web-autoplot-v1:${capture.run.run_id}:${capture.run.request_id}:${source.generation}`,
    };
    return structuredClone(this.#intent);
  }
  planned(): void {
    if (this.#state !== 'armed' || !this.#intent) throw clientError('autoPlotIntentMissing', {});
    this.#state = 'planned';
  }
  submitted(): void {
    if (this.#state !== 'planned') throw clientError('autoPlotMustUseItsPersistedPlan', {});
    this.#state = 'submitted';
  }
}

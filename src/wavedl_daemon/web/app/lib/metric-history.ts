import {
  clientRangeError,
  type ClientErrorKey,
  type ClientErrorParams,
} from '../i18n/client-messages';
import { DaemonApiError, object, validateJson, type JsonObject, type RunView } from './daemon-api';
import type { RunEvent } from './event-stream';

export interface MetricRecord {
  runId: string;
  attempt: number;
  seq: number;
  step: number;
  name: string;
  value: number | null;
  unit: string;
  metrics: JsonObject;
  sourceGeneration: string | null;
  active: boolean;
}
export interface MetricSummary {
  progress: { epoch: number; totalEpochs: number; fraction: number } | null;
  best: number | null;
  latest: MetricRecord | null;
  /** Present only when the selected runtime has emitted metrics. */
  current?: RuntimeMetricSummary;
}
export interface MetricHealth {
  label: string;
  value: string;
  status: string;
  severity: 'good' | 'warning' | 'error';
}
export interface RuntimeMetricSummary {
  trainLoss: number | null;
  validationLoss: number | null;
  r2: number | null;
  bestR2: number | null;
  learningRate: number | null;
  pearson: number | null;
  gradientNorm: number | null;
  mae: number | null;
  epochSeconds: number | null;
  elapsedSeconds: number | null;
  patience: { used: number; maximum: number; fraction: number } | null;
  parameters: { name: string; value: number | null }[];
  health: MetricHealth[];
}
export interface NumericPoint {
  attempt: number;
  seq: number;
  step: number;
  value: number | null;
}
interface Boundary {
  attempt: number;
  step: number;
  seq: number | null;
}
const numericFields = new Set([
  'train_loss',
  'val_loss',
  'best_val_loss',
  'lr',
  'r2',
  'pearson',
  'patience',
  'patience_ctr',
  'epoch_time',
  'elapsed_time',
  'grad_norm',
  'mae_avg',
  'val_r2',
  'val_pearson',
  'val_mae_avg',
  'total_time',
]);
const integerFields = new Set(['epoch', 'total_epochs', 'patience_counter', 'max_patience']);
function fail(clientMessageKey: ClientErrorKey, clientMessageParams?: ClientErrorParams): never {
  throw DaemonApiError.fromKey('protocol', clientMessageKey, { params: clientMessageParams });
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function numeric(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}
function valueOf(record: MetricRecord, ...fields: string[]): number | null {
  for (const field of fields) {
    const value = Object.hasOwn(record.metrics, field)
      ? record.metrics[field]
      : record.name === field
        ? record.value
        : undefined;
    if (numeric(value)) return value;
  }
  return null;
}

/** Match Qt's heuristic thresholds, but never assess a missing/null operand. */
function runtimeSummary(record: MetricRecord, bestR2: number | null): RuntimeMetricSummary {
  const current: RuntimeMetricSummary = {
    trainLoss: valueOf(record, 'train_loss'),
    validationLoss: valueOf(record, 'val_loss'),
    r2: valueOf(record, 'r2', 'val_r2'),
    bestR2,
    learningRate: valueOf(record, 'lr'),
    pearson: valueOf(record, 'pearson', 'val_pearson'),
    gradientNorm: valueOf(record, 'grad_norm'),
    mae: valueOf(record, 'mae_avg', 'val_mae_avg'),
    epochSeconds: valueOf(record, 'epoch_time'),
    elapsedSeconds: valueOf(record, 'total_time', 'elapsed_time'),
    patience: null,
    parameters: [],
    health: [],
  };
  const used = record.metrics.patience_counter;
  const maximum = record.metrics.max_patience;
  if (integer(used) && integer(maximum, 1))
    current.patience = { used, maximum, fraction: used / maximum };
  const parameters = record.metrics.mae_per_param;
  const namedParameters = record.metrics.per_param_mae;
  if (Array.isArray(parameters))
    current.parameters = parameters.map((value, index) => ({
      name: `P${index + 1}`,
      value: numeric(value) ? value : null,
    }));
  else if (object(namedParameters))
    current.parameters = Object.entries(namedParameters).map(([name, value]) => ({
      name,
      value: numeric(value) ? value : null,
    }));
  else
    current.parameters = Object.entries(record.metrics)
      .filter(([name]) => name.startsWith('MAE_Phys_P'))
      .map(([name, value]) => ({ name, value: numeric(value) ? value : null }));
  const { trainLoss, validationLoss, learningRate, gradientNorm, patience } = current;
  if (trainLoss !== null && trainLoss > 0 && validationLoss !== null) {
    const gap = ((validationLoss - trainLoss) / trainLoss) * 100;
    current.health.push({
      label: 'Overfitting',
      value: `Gap: ${gap.toFixed(1)}%`,
      status: gap > 50 ? 'Severe' : gap > 20 ? 'Moderate' : gap > 0 ? 'Healthy' : 'Underfitting',
      severity: gap > 50 ? 'error' : gap > 20 || gap <= 0 ? 'warning' : 'good',
    });
  }
  if (learningRate !== null && learningRate > 0)
    current.health.push({
      label: 'Learning rate',
      value: learningRate.toExponential(2),
      status: learningRate < 1e-7 ? 'Very Low' : learningRate > 1e-2 ? 'High' : 'Normal',
      severity: learningRate < 1e-7 || learningRate > 1e-2 ? 'warning' : 'good',
    });
  if (gradientNorm !== null && gradientNorm > 0)
    current.health.push({
      label: 'Gradient health',
      value: gradientNorm.toFixed(4),
      status:
        gradientNorm > 100
          ? 'Exploding'
          : gradientNorm > 10
            ? 'High'
            : gradientNorm < 1e-6
              ? 'Vanishing'
              : 'Stable',
      severity:
        gradientNorm > 100 || gradientNorm < 1e-6
          ? 'error'
          : gradientNorm > 10
            ? 'warning'
            : 'good',
    });
  if (patience)
    current.health.push({
      label: 'Patience used',
      value: `${patience.used}/${patience.maximum} (${(patience.fraction * 100).toFixed(0)}%)`,
      status: patience.fraction > 0.8 ? 'Critical' : patience.fraction > 0.5 ? 'Elevated' : 'OK',
      severity: patience.fraction > 0.8 ? 'error' : patience.fraction > 0.5 ? 'warning' : 'good',
    });
  const best = valueOf(record, 'best_val_loss');
  const epoch = record.metrics.epoch;
  const total = record.metrics.total_epochs;
  if (
    best !== null &&
    validationLoss !== null &&
    validationLoss > 0 &&
    integer(epoch, 1) &&
    integer(total, 1)
  ) {
    const distance = ((validationLoss - best) / validationLoss) * 100;
    current.health.push({
      label: 'Convergence',
      value: `Epoch ${epoch}/${total}`,
      status: distance < 1 ? 'Converging' : distance < 10 ? 'Plateau' : 'Diverging',
      severity: distance < 1 ? 'good' : distance < 10 ? 'warning' : 'error',
    });
  }
  return current;
}
function metric(
  payload: JsonObject,
): Omit<MetricRecord, 'runId' | 'attempt' | 'seq' | 'active' | 'sourceGeneration'> {
  if (
    typeof payload.name !== 'string' ||
    !numeric(payload.value) ||
    !integer(payload.step) ||
    (payload.unit !== undefined && typeof payload.unit !== 'string')
  )
    fail('invalidMetricPayload');
  const details = payload.metrics ?? {};
  if (!object(details)) fail('invalidMetricDetails');
  validateJson(details);
  for (const [key, value] of Object.entries(details)) {
    if ((numericFields.has(key) || key.startsWith('MAE_Phys_P')) && !numeric(value))
      fail('invalidNumericMetric', { field: key });
    if (integerFields.has(key) && !integer(value)) fail('invalidIntegerMetric', { field: key });
    if (key === 'mae_per_param' && (!Array.isArray(value) || !value.every(numeric)))
      fail('invalidPerParameterMetrics');
    if (key === 'per_param_mae' && (!object(value) || !Object.values(value).every(numeric)))
      fail('invalidPerParameterMetrics');
  }
  return {
    name: payload.name,
    value: payload.value,
    step: payload.step,
    unit: payload.unit ?? '',
    metrics: structuredClone(details),
  };
}

/** Incremental numeric replay, independent of capped display logs. Capacity errors
 * are explicit and atomic: silently evicting causal checkpoints corrupts replay.
 * Ingestion is O(1) per metric; branch restores and requested snapshots are O(N).
 */
export class MetricHistory {
  #records: MetricRecord[] = [];
  #active = new Map<string, MetricRecord>();
  #steps = new Map<number, Map<number, number>>();
  #known = new Set<number>();
  #published = new Set<string>();
  #generations = new Map<number, string>();
  #cursors = new Map<number, number>();
  #lineage = new Map<number, Boundary>();
  #head = 0;
  #latest: MetricRecord | null = null;
  #r2Scores = new Map<string, number>();
  #bestR2: number | null = null;
  #bestR2Dirty = false;
  #scope: number | null | undefined;
  #pending = false;
  readonly maxPoints: number;
  constructor(
    readonly runId: string,
    options: { maxPoints?: number } = {},
  ) {
    this.maxPoints = options.maxPoints ?? 200_000;
    if (!integer(this.maxPoints, 1)) throw clientRangeError('invalidMaxPoints');
  }
  get size(): number {
    return this.#records.length;
  }
  get headAttempt(): number {
    return this.#head;
  }
  setScope(view: RunView): void {
    if (view.run_id !== this.runId) fail('metricScopeBelongsToAnotherRun');
    this.#scope = view.attempt;
    this.#pending = view.evidence?.native_pending === true;
  }
  acknowledgeGeneration(sourceAttempt: number, step: number, generation: string): void {
    if (!integer(sourceAttempt, 1) || !integer(step) || !generation)
      fail('invalidVerifiedGeneration');
    if (this.#published.size >= this.maxPoints) fail('metricGenerationCapacityExceeded');
    this.#published.add(JSON.stringify([sourceAttempt, step, generation]));
    this.#known.add(sourceAttempt);
  }
  apply(event: RunEvent): void {
    if (event.run_id !== this.runId || !integer(event.attempt, 1) || !integer(event.seq))
      fail('invalidMetricEventOwnership');
    if (event.seq <= (this.#cursors.get(event.attempt) ?? -1)) return;
    if (!this.#cursors.has(event.attempt) && this.#cursors.size >= this.maxPoints)
      fail('metricAttemptCapacityExceeded');
    if (event.type === 'metric') {
      const checked = metric(event.payload);
      if (this.size >= this.maxPoints) fail('metricHistoryCapacity');
      const active = event.attempt >= this.#head;
      const record: MetricRecord = {
        ...checked,
        runId: this.runId,
        attempt: event.attempt,
        seq: event.seq,
        sourceGeneration: this.#generations.get(event.attempt) ?? null,
        active,
      };
      const key = JSON.stringify([record.step, record.name]);
      if (active) {
        if (event.attempt > this.#head) this.#resetRuntimeSummary();
        const prior = this.#active.get(key);
        if (prior) prior.active = false;
        this.#trackR2(key, record);
        this.#active.set(key, record);
        this.#latest = record;
      }
      this.#records.push(record);
      let steps = this.#steps.get(event.attempt);
      if (!steps) {
        steps = new Map();
        this.#steps.set(event.attempt, steps);
      }
      steps.set(record.step, Math.min(steps.get(record.step) ?? event.seq, event.seq));
      this.#known.add(event.attempt);
      this.#head = Math.max(this.#head, event.attempt);
    } else if (event.type === 'supersede') {
      const payload = event.payload;
      if (
        !integer(payload.source_attempt, 1) ||
        payload.source_attempt >= event.attempt ||
        !integer(payload.step) ||
        typeof payload.generation !== 'string' ||
        !payload.generation ||
        (payload.source_seq !== undefined && !integer(payload.source_seq))
      )
        fail('invalidSupersessionBoundary');
      const seq = payload.source_seq ?? null;
      const first = this.#steps.get(payload.source_attempt)?.get(payload.step);
      if (
        !(first !== undefined && (seq === null || first <= seq)) &&
        !this.#published.has(
          JSON.stringify([payload.source_attempt, payload.step, payload.generation]),
        ) &&
        !(payload.step === 0 && this.#known.has(payload.source_attempt))
      )
        fail('supersessionStepMissing');
      if (this.#lineage.has(event.attempt)) fail('supersessionAlreadySet');
      this.#lineage.set(event.attempt, {
        attempt: payload.source_attempt,
        step: payload.step,
        seq,
      });
      if (event.attempt >= this.#head) {
        this.#restore(event.attempt);
        this.#head = event.attempt;
        this.#resetRuntimeSummary();
        this.#latest = null;
        for (const record of this.#active.values()) {
          if (record.attempt === event.attempt && (!this.#latest || record.seq > this.#latest.seq))
            this.#latest = record;
        }
        for (const record of this.#active.values()) {
          if (record.attempt === event.attempt)
            this.#trackR2(JSON.stringify([record.step, record.name]), record);
        }
      }
      this.#generations.set(event.attempt, payload.generation);
    } else if (event.type === 'hello') {
      this.#known.add(event.attempt);
      if (event.attempt > this.#head) {
        this.#latest = null;
        this.#resetRuntimeSummary();
      }
      this.#head = Math.max(this.#head, event.attempt);
    } else if (event.type === 'artifact' && event.payload.kind === 'checkpoint')
      this.#known.add(event.attempt);
    this.#cursors.set(event.attempt, event.seq);
  }
  #resetRuntimeSummary(): void {
    this.#r2Scores.clear();
    this.#bestR2 = null;
    this.#bestR2Dirty = false;
  }
  #trackR2(key: string, record: MetricRecord): void {
    if (this.#r2Scores.get(key) === this.#bestR2) this.#bestR2Dirty = true;
    const score = valueOf(record, 'r2', 'val_r2');
    if (score === null) this.#r2Scores.delete(key);
    else {
      this.#r2Scores.set(key, score);
      this.#bestR2 = this.#bestR2 === null ? score : Math.max(score, this.#bestR2);
    }
  }
  #restore(attempt: number): void {
    const bounds = new Map<number, { step: number | null; seq: number | null }>();
    let step: number | null = null;
    let seq: number | null = null;
    for (;;) {
      bounds.set(attempt, { step, seq });
      const boundary = this.#lineage.get(attempt);
      if (!boundary) break;
      attempt = boundary.attempt;
      step = step === null ? boundary.step : Math.min(step, boundary.step);
      seq = boundary.seq;
    }
    this.#active.clear();
    for (const record of this.#records) {
      record.active = false;
      const bound = bounds.get(record.attempt);
      if (
        !bound ||
        (bound.step !== null && record.step > bound.step) ||
        (bound.seq !== null && record.seq > bound.seq)
      )
        continue;
      const key = JSON.stringify([record.step, record.name]);
      const prior = this.#active.get(key);
      if (
        !prior ||
        record.attempt > prior.attempt ||
        (record.attempt === prior.attempt && record.seq > prior.seq)
      )
        this.#active.set(key, record);
    }
    for (const record of this.#active.values()) record.active = true;
  }
  metrics(
    options: { activeOnly?: boolean; attempt?: number; live?: boolean } = {},
  ): MetricRecord[] {
    if (
      options.live &&
      (this.#pending ||
        this.#scope === null ||
        (this.#scope !== undefined && this.#scope !== this.#head))
    )
      return [];
    return this.#records
      .filter(
        (record) =>
          (!(options.activeOnly ?? true) || record.active) &&
          (options.attempt === undefined || record.attempt === options.attempt),
      )
      .map((record) => structuredClone(record));
  }
  summary(): MetricSummary {
    if (
      this.#pending ||
      this.#scope === null ||
      (this.#scope !== undefined && this.#scope !== this.#head)
    )
      return { progress: null, best: null, latest: null };
    const latest = this.#latest;
    const epoch = latest?.metrics.epoch;
    const totalEpochs = latest?.metrics.total_epochs;
    const best = latest?.metrics.best_val_loss;
    if (this.#bestR2Dirty) {
      this.#bestR2 = null;
      for (const score of this.#r2Scores.values())
        this.#bestR2 = this.#bestR2 === null ? score : Math.max(this.#bestR2, score);
      this.#bestR2Dirty = false;
    }
    return {
      progress:
        integer(epoch) && integer(totalEpochs, 1)
          ? { epoch, totalEpochs, fraction: Math.min(epoch / totalEpochs, 1) }
          : null,
      best: numeric(best) ? best : null,
      latest: latest ? structuredClone(latest) : null,
      ...(latest ? { current: runtimeSummary(latest, this.#bestR2) } : {}),
    };
  }
  series(
    field: string,
    options: { activeOnly?: boolean; attempt?: number; live?: boolean } = {},
  ): NumericPoint[] {
    const points: NumericPoint[] = [];
    for (const record of this.metrics(options)) {
      const value = Object.hasOwn(record.metrics, field)
        ? record.metrics[field]
        : record.name === field
          ? record.value
          : undefined;
      if (numeric(value))
        points.push({ attempt: record.attempt, seq: record.seq, step: record.step, value });
    }
    return points;
  }
}

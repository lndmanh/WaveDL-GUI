import { shallowRef, toRaw } from 'vue';
import {
  trainingConfigSchema,
  trainingRequestSchema,
  type TrainingRequest,
} from '../../shared/schemas/training-request';
import {
  object,
  parseJson,
  type DaemonApi,
  type Json,
  type JsonObject,
  type PlanView,
  type RunView,
} from './daemon-api';
import {
  mappedStoragePath,
  normalizedStoragePath,
  storageMapSchema,
} from '../../shared/schemas/storage-mapping';
import type { ConnectionSession } from './connection-session';
import { ArtifactClient, type Artifact, type SelectionMetadata } from './artifact-client';
import { checkpointOptions, type CheckpointOption } from './result-operations';
import { AutoPlotWorkflow, type AutoPlotIntent } from './autoplot-workflow';

/** Extract only the exact approved manifest, never current form or run-list data. */
export function automaticPlotRequest(
  run: RunView,
  plan: PlanView,
  originalRequest?: JsonObject,
): TrainingRequest {
  if (typeof plan.preview.manifest_json !== 'string') throw new Error('Missing approved manifest');
  const manifest = parseJson(plan.preview.manifest_json);
  if (
    !object(manifest) ||
    manifest.schema_version !== 1 ||
    manifest.run_id !== run.run_id ||
    manifest.operation !== 'train' ||
    !object(manifest.resolved_config) ||
    !object(manifest.runtime) ||
    manifest.runtime.container !== null ||
    !object(plan.preview.topology) ||
    plan.preview.target !== run.backend
  )
    throw new Error('Unsupported approved training manifest');
  const mappings = storageMapSchema.parse(manifest.storage_map ?? []);
  const keys = new Set(Object.keys(trainingConfigSchema.shape));
  if (Object.keys(manifest.resolved_config).some((key) => key !== 'output_dir' && !keys.has(key)))
    throw new Error('Unsupported normalized training configuration');
  const config = Object.fromEntries(
    Object.entries(manifest.resolved_config).filter(([key]) => keys.has(key)),
  );
  const runtime = manifest.runtime;
  const normalized = trainingRequestSchema.parse({
    backend: plan.preview.target,
    operation: manifest.operation,
    config,
    runtime: {
      python: runtime.python,
      mode: runtime.mode,
      device: runtime.device,
      environment: runtime.environment,
    },
    topology: plan.preview.topology,
  });
  if (!originalRequest) {
    if (mappings.length) throw new Error('Mapped plots require the original approved host request');
    return normalized;
  }
  const original = trainingRequestSchema.parse(originalRequest);
  const approvedMappings = original.storage_map ?? [];
  const mappingIdentity = (items: typeof mappings): string =>
    JSON.stringify(
      items
        .map((item) => ({
          host_root: normalizedStoragePath(item.host_root),
          execution_root: normalizedStoragePath(item.execution_root),
        }))
        .sort((a, b) => a.host_root.localeCompare(b.host_root)),
    );
  if (
    mappingIdentity(approvedMappings) !== mappingIdentity(mappings) ||
    original.backend !== normalized.backend
  )
    throw new Error('Approved storage mapping differs from the submitted request');
  if (!mappings.length) return normalized;
  if (
    mappedStoragePath(original.config.data_path, mappings) !==
      normalizedStoragePath(normalized.config.data_path) ||
    mappedStoragePath(original.runtime.python, mappings) !==
      normalizedStoragePath(normalized.runtime.python)
  )
    throw new Error('Approved host paths do not match normalized execution paths');
  // File registrations are mapped by the daemon just like the dataset. Keep
  // their original host spelling after verifying one forward rewrite; sending
  // normalized execution paths would apply overlapping maps a second time.
  const imports = original.config.import_modules;
  if (
    imports.length !== normalized.config.import_modules.length ||
    imports.some((item, index) => {
      const approved = normalized.config.import_modules[index];
      return item.endsWith('.py')
        ? mappedStoragePath(item, mappings) !== normalizedStoragePath(approved ?? '')
        : item !== approved;
    })
  )
    throw new Error('Approved registrations do not match normalized execution paths');
  return trainingRequestSchema.parse({
    ...normalized,
    config: {
      ...normalized.config,
      data_path: original.config.data_path,
      import_modules: imports,
    },
    runtime: { ...normalized.runtime, python: original.runtime.python },
    storage_map: original.storage_map,
  });
}
export interface AutomaticPlotState {
  status: 'armed' | 'planning' | 'submitted' | 'error' | 'unavailable' | 'stopped';
  plotRunId: string | null;
  message: string;
}
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

const inferenceWeightNames = new Set([
  'model.safetensors',
  'model.bin',
  'pytorch_model.bin',
  'model_weights.pth',
]);

/** A best publication is usable for automatic plots only when its inference state is complete. */
function hasInferenceSource(artifacts: readonly Artifact[], generation: string): boolean {
  const paths = new Set(
    artifacts
      .filter((artifact) => artifact.generation === generation)
      .map((artifact) => artifact.path),
  );
  return (
    paths.has('training_meta.pkl') &&
    paths.has('scaler.pkl') &&
    [...inferenceWeightNames].some((name) => paths.has(name))
  );
}

/** Bounded browser-local continuation of one explicitly approved training run. */
export class AutoPlotController {
  readonly state = shallowRef<AutomaticPlotState>({
    status: 'stopped',
    plotRunId: null,
    message: '',
  });
  readonly session: ConnectionSession;
  #workflow: AutoPlotWorkflow | null = null;
  #run: RunView | null = null;
  #intent: AutoPlotIntent | null = null;
  #plan: PlanView | null = null;
  #sourcePlan: PlanView | null = null;
  #sourceApi: DaemonApi | null = null;
  #sourceFiles: Artifact[] = [];
  #sourceSelection: SelectionMetadata | null = null;
  #scope = new AbortController();
  #revision = -1;
  #daemonId = '';
  #busy = false;
  #sourceAttempt: number | null = null;
  #sourceNative = '';
  #observedAttempt: number | null = null;
  #nativeBinding: { cluster: string; owner: string; jobId: string; restart: number } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #unsubscribe: () => void;
  // Status recovery must never re-arm explicitly disabled/completed workflows.
  // Bound the page-local ledger without evicting deduplication authority.
  #capturedRequests = new Set<string>();
  constructor(
    session: ConnectionSession,
    readonly options: { pollMs?: number; deadlineMs?: number } = {},
  ) {
    this.session = toRaw(session);
    for (const value of [options.pollMs ?? 2000, options.deadlineMs ?? 15000])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('Invalid automatic plot deadline');
    this.#unsubscribe = this.session.subscribe((state) => {
      if (
        this.#workflow &&
        (state.status !== 'connected' ||
          state.revision !== this.#revision ||
          state.health?.daemon_id !== this.#daemonId)
      )
        this.stop();
    });
  }
  capture(run: RunView, plan: PlanView): void {
    if (this.#capturedRequests.has(run.request_id)) return;
    this.stop();
    const state = this.session.snapshot();
    if (state.status !== 'connected' || !state.health) return;
    if (this.#capturedRequests.size >= 256) {
      this.state.value = {
        status: 'unavailable',
        plotRunId: null,
        message: 'Automatic plot workflow capacity reached. Use explicit result planning.',
      };
      return;
    }
    this.#capturedRequests.add(run.request_id);
    try {
      const approved = toRaw(plan);
      const api = this.session.api;
      if (!api) throw new Error('Automatic plots require a verified connection');
      const request = automaticPlotRequest(run, approved, api.approvedRequest(approved));
      if (request.config.cv > 0) return;
      this.#revision = state.revision;
      this.#sourcePlan = approved;
      this.#sourceApi = api;
      this.#daemonId = state.health.daemon_id;
      this.#scope = new AbortController();
      this.#workflow = new AutoPlotWorkflow({
        daemonId: this.#daemonId,
        revision: this.#revision,
        run: toRaw(run),
        approvedPlan: toRaw(plan),
        request,
      });
      this.#run = structuredClone(toRaw(run));
      this.#observedAttempt = run.attempt;
      if (!this.#acceptScope(run)) throw new Error('Unsupported captured native scope');
      this.state.value = {
        status: 'armed',
        plotRunId: null,
        message:
          'Diagnostic plots will use this approved training run’s published best checkpoint.',
      };
      this.#schedule();
    } catch {
      this.stop();
      this.state.value = {
        status: 'unavailable',
        plotRunId: null,
        message:
          'Automatic plots unavailable: approved manifest is unsupported. Use explicit result planning.',
      };
    }
  }
  #schedule(): void {
    if (this.#timer || this.state.value.status !== 'armed' || this.#scope.signal.aborted) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#poll();
    }, this.options.pollMs ?? 2000);
  }
  async #poll(): Promise<void> {
    const run = this.#run;
    const signal = this.#scope.signal;
    if (!run || !this.#current(signal)) return;
    try {
      const current = await this.session.perform((api, signal) => api.getRun(run.run_id, signal), {
        signal: this.#scope.signal,
        timeoutMs: this.options.deadlineMs ?? 15000,
      });
      await this.observeFresh(current);
    } catch {
      this.#error(signal);
    }
    this.#schedule();
  }
  #error(signal: AbortSignal): void {
    if (this.#scope.signal === signal && !signal.aborted)
      this.state.value = {
        ...this.state.value,
        status: 'error',
        message:
          'Automatic plot acknowledgment is unconfirmed. Retry explicitly on this connection; the same plan and key are retained.',
      };
  }
  #current(signal: AbortSignal): boolean {
    const state = this.session.snapshot();
    const current =
      !signal.aborted &&
      state.status === 'connected' &&
      state.revision === this.#revision &&
      state.health?.daemon_id === this.#daemonId;
    if (!current) return false;
    try {
      if (!this.#sourcePlan || !this.#sourceApi || this.session.api !== this.#sourceApi)
        throw new Error('Source approval scope changed');
      this.#sourceApi.approvedRequest(this.#sourcePlan);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }
  async observeFresh(run: RunView): Promise<void> {
    if (this.#busy || this.state.value.status !== 'armed' || !this.#workflow || !this.#run) return;
    if (!this.#current(this.#scope.signal)) return;
    if (
      run.run_id !== this.#run.run_id ||
      run.plan_id !== this.#run.plan_id ||
      run.request_id !== this.#run.request_id
    )
      return;
    if (run.operation !== this.#run.operation || run.backend !== this.#run.backend) {
      this.stop();
      return;
    }
    if (!this.#acceptScope(run)) {
      this.stop();
      return;
    }
    if (run.state === 'failed' || run.state === 'cancelled') {
      this.stop();
      return;
    }
    if (
      run.state !== 'completed' ||
      run.uncertainty ||
      run.evidence?.native_pending === true ||
      run.attempt === null
    )
      return;
    if (run.backend === 'slurm' && !this.#nativeBinding) {
      this.stop();
      return;
    }
    this.#busy = true;
    const parent = this.#scope.signal;
    const signal = AbortSignal.any([parent, AbortSignal.timeout(this.options.deadlineMs ?? 15000)]);
    try {
      const client = new ArtifactClient(this.session);
      const artifacts = await client.list(run.run_id, signal);
      const candidates = artifacts.filter(
        (item) => item.attempt === run.attempt && item.path === 'checkpoint_selection.json',
      );
      candidates.sort((left, right) => {
        const a = BigInt(left.generation.slice(4)),
          b = BigInt(right.generation.slice(4));
        return a < b ? 1 : a > b ? -1 : 0;
      });
      const publications: CheckpointOption[] = [];
      let incompleteBest = false;
      for (const candidate of candidates) {
        if (!this.#current(signal)) return;
        let options: readonly CheckpointOption[];
        try {
          options = await checkpointOptions(this.session, [candidate], signal);
        } catch {
          // Hash-covered malformed metadata can be skipped. Transport, authority
          // and byte-integrity faults revoke the connection, so the scope check
          // below prevents falling back after those failures.
          if (!this.#current(signal)) return;
          continue;
        }
        const option = options[0];
        if (option?.classification.kind === 'best') {
          if (!hasInferenceSource(artifacts, candidate.generation)) {
            incompleteBest = true;
            continue;
          }
          publications.push(option);
          break;
        }
      }
      if (!this.#current(signal)) return;
      if (!publications.length && incompleteBest) {
        this.stop();
        this.state.value = {
          status: 'unavailable',
          plotRunId: null,
          message: 'Automatic plots unavailable: the published checkpoint is incomplete.',
        };
        return;
      }
      this.#intent = this.#workflow.observe({
        daemonId: this.#daemonId,
        connected: true,
        revision: this.#revision,
        freshness: 'fresh',
        run,
        publications,
      });
      if (!this.#intent) return;
      const selected = publications[0];
      if (!selected) return;
      this.#sourceFiles = artifacts.filter(
        (item) => item.generation === selected.artifact.generation,
      );
      this.#sourceSelection = selected.classification;
      this.#sourceAttempt = run.attempt;
      this.#sourceNative = JSON.stringify(run.evidence?.native_identity ?? null);
      // Re-read lifecycle after metadata downloads; it may have requeued meanwhile.
      const latest = await this.session.perform((api, scoped) => api.getRun(run.run_id, scoped), {
        signal,
      });
      if (!this.#current(signal)) return;
      if (
        latest.run_id !== run.run_id ||
        latest.plan_id !== run.plan_id ||
        latest.request_id !== run.request_id ||
        latest.backend !== run.backend ||
        latest.operation !== 'train' ||
        latest.cancellation_requested ||
        latest.attempt !== run.attempt ||
        JSON.stringify(latest.evidence?.native_identity ?? null) !== this.#sourceNative ||
        latest.state !== 'completed' ||
        latest.uncertainty ||
        latest.evidence?.native_pending === true
      ) {
        this.stop();
        return;
      }
      for (const option of publications) client.assertSelection(option.artifact);
      await this.#execute(signal);
    } catch {
      this.#error(parent);
    } finally {
      if (this.#scope.signal === parent) this.#busy = false;
    }
  }
  async #execute(signal: AbortSignal): Promise<void> {
    if (!this.#intent || !this.#workflow || !this.#current(signal)) return;
    this.state.value = { ...this.state.value, status: 'planning' };
    const intent = this.#intent;
    if (!this.#plan) {
      const plan = await this.session.perform(
        (api, scoped) => api.plan(intent.request, intent.idempotencyKey, scoped),
        { signal, timeoutMs: this.options.deadlineMs ?? 15000 },
      );
      if (!this.#current(signal)) return;
      if (!(await this.#validatePlotPlan(plan, intent, signal)) || !this.#current(signal)) return;
      this.#plan = plan;
      this.#workflow.planned();
    } else {
      const plan = this.#plan;
      const observed = await this.session.perform(
        (api, scoped) => api.getRun(plan.run_id, scoped),
        { signal },
      );
      if (!this.#current(signal)) return;
      if (observed.plan_id !== plan.plan_id || observed.request_id !== plan.request_id)
        throw new Error('Automatic plot identity changed');
      if (observed.submission_requested) {
        this.#complete(observed);
        return;
      }
    }
    if (!this.#current(signal)) return;
    const plan = this.#plan;
    const source = this.#run;
    if (!source) return;
    const sourceNow = await this.session.perform(
      (api, scoped) => api.getRun(source.run_id, scoped),
      { signal, timeoutMs: this.options.deadlineMs ?? 15000 },
    );
    if (!this.#current(signal)) return;
    if (
      sourceNow.plan_id !== source.plan_id ||
      sourceNow.request_id !== source.request_id ||
      sourceNow.attempt !== this.#sourceAttempt ||
      sourceNow.state !== 'completed' ||
      sourceNow.uncertainty ||
      sourceNow.cancellation_requested ||
      sourceNow.evidence?.native_pending === true ||
      JSON.stringify(sourceNow.evidence?.native_identity ?? null) !== this.#sourceNative
    ) {
      this.stop();
      return;
    }
    if (!this.#current(signal)) return;
    const result = await this.session.perform((api, scoped) => api.submit(plan, scoped), {
      signal,
      timeoutMs: this.options.deadlineMs ?? 15000,
    });
    if (this.#current(signal)) this.#complete(result);
  }
  async #validatePlotPlan(
    plan: PlanView,
    intent: AutoPlotIntent,
    signal: AbortSignal,
  ): Promise<boolean> {
    const parent = this.#scope.signal;
    const sourcePlan = this.#sourcePlan;
    const sourceApi = this.#sourceApi;
    const files = Object.fromEntries(
      this.#sourceFiles.map((file) => [file.path, { size: file.size, sha256: file.sha256 }]),
    );
    const selection = this.#sourceSelection ? { ...this.#sourceSelection } : null;
    const current = (): boolean =>
      this.#scope.signal === parent &&
      !signal.aborted &&
      this.#sourcePlan === sourcePlan &&
      this.#sourceApi === sourceApi &&
      this.#current(signal);
    try {
      if (!current()) return false;
      if (
        !sourcePlan ||
        typeof sourcePlan.preview.manifest_json !== 'string' ||
        typeof plan.preview.manifest_json !== 'string'
      )
        throw new Error('Missing approved manifests');
      const source = parseJson(sourcePlan.preview.manifest_json);
      const plot = parseJson(plan.preview.manifest_json);
      if (
        !object(source) ||
        !object(plot) ||
        !object(source.resolved_config) ||
        !object(plot.resolved_config) ||
        !object(plot.checkpoint_source)
      )
        throw new Error('Invalid plot manifest');
      const pin = plot.checkpoint_source;
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`${sourcePlan.preview.manifest_json}\n`),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      if (!current()) return false;
      if (
        plot.schema_version !== 1 ||
        plot.run_id !== plan.run_id ||
        plot.operation !== 'plot' ||
        plan.preview.target !== intent.request.backend ||
        canonical(plan.preview.topology ?? null) !== canonical(intent.request.topology) ||
        canonical(plot.runtime ?? null) !== canonical(source.runtime ?? null) ||
        canonical(plot.storage_map ?? []) !== canonical(source.storage_map ?? []) ||
        plot.resolved_config.data_path !== source.resolved_config.data_path ||
        canonical(plot.resolved_config.import_modules ?? []) !==
          canonical(source.resolved_config.import_modules ?? []) ||
        pin.run_id !== intent.request.checkpoint_source.run_id ||
        pin.generation !== intent.request.checkpoint_source.generation ||
        pin.manifest_sha256 !== digest ||
        typeof pin.complete_sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(pin.complete_sha256) ||
        canonical(pin.files ?? null) !== canonical(files) ||
        canonical(pin.selection ?? null) !== canonical(selection)
      )
        throw new Error('Plot normalization changed approved authority');
      for (const [key, expected] of Object.entries(intent.request.config)) {
        if (
          key !== 'data_path' &&
          key !== 'import_modules' &&
          canonical(plot.resolved_config[key] ?? null) !== canonical(expected)
        )
          throw new Error('Plot configuration changed approved intent');
      }
      return true;
    } catch {
      if (!current()) return false;
      this.stop();
      this.state.value = {
        status: 'unavailable',
        plotRunId: null,
        message:
          'Automatic plot preview differs from approved training authority. Use explicit result planning.',
      };
      return false;
    }
  }
  #acceptScope(run: RunView): boolean {
    if (
      this.#observedAttempt !== null &&
      (run.attempt === null || run.attempt < this.#observedAttempt)
    )
      return false;
    this.#observedAttempt = run.attempt;
    const identity = run.evidence?.native_identity;
    if (identity === undefined || identity === null) return this.#nativeBinding === null;
    if (
      !object(identity) ||
      identity.run_id !== run.run_id ||
      identity.request_id !== run.request_id ||
      typeof identity.cluster !== 'string' ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(identity.cluster) ||
      typeof identity.owner !== 'string' ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(identity.owner) ||
      typeof identity.job_id !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(identity.job_id) ||
      typeof identity.restart_count !== 'number' ||
      !Number.isSafeInteger(identity.restart_count) ||
      identity.restart_count < 0
    )
      return false;
    const prior = this.#nativeBinding;
    if (
      prior &&
      (prior.cluster !== identity.cluster ||
        prior.owner !== identity.owner ||
        prior.jobId !== identity.job_id ||
        identity.restart_count < prior.restart)
    )
      return false;
    this.#nativeBinding = {
      cluster: identity.cluster,
      owner: identity.owner,
      jobId: identity.job_id,
      restart: identity.restart_count,
    };
    return true;
  }
  #complete(run: RunView): void {
    if (
      !this.#plan ||
      run.run_id !== this.#plan.run_id ||
      run.plan_id !== this.#plan.plan_id ||
      run.request_id !== this.#plan.request_id ||
      run.operation !== 'plot' ||
      run.backend !== this.#run?.backend ||
      !run.submission_requested
    )
      throw new Error('Automatic plot acknowledgment does not match the persisted plan');
    this.#workflow?.submitted();
    this.state.value = {
      status: 'submitted',
      plotRunId: run.run_id,
      message: 'Daemon acknowledged the diagnostic plot run.',
    };
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
  async retry(): Promise<void> {
    if (
      this.#busy ||
      this.state.value.status !== 'error' ||
      !this.#workflow ||
      !this.#current(this.#scope.signal)
    )
      return;
    if (!this.#intent) {
      this.state.value = { ...this.state.value, status: 'armed' };
      await this.#poll();
      return;
    }
    this.#busy = true;
    const parent = this.#scope.signal;
    const signal = AbortSignal.any([parent, AbortSignal.timeout(this.options.deadlineMs ?? 15000)]);
    try {
      const source = this.#run;
      if (!source) return;
      const current = await this.session.perform(
        (api, scoped) => api.getRun(source.run_id, scoped),
        { signal },
      );
      if (
        current.plan_id !== source.plan_id ||
        current.request_id !== source.request_id ||
        current.attempt !== this.#sourceAttempt ||
        JSON.stringify(current.evidence?.native_identity ?? null) !== this.#sourceNative ||
        current.state !== 'completed' ||
        current.uncertainty ||
        current.cancellation_requested ||
        current.evidence?.native_pending === true
      ) {
        this.stop();
        return;
      }
      await this.#execute(signal);
    } catch {
      this.#error(parent);
    } finally {
      if (this.#scope.signal === parent) this.#busy = false;
    }
  }
  stop(): void {
    this.#scope.abort();
    this.#workflow?.stop();
    this.#workflow = null;
    this.#run = null;
    this.#intent = null;
    this.#sourceAttempt = null;
    this.#sourceNative = '';
    this.#observedAttempt = null;
    this.#nativeBinding = null;
    this.#plan = null;
    this.#sourcePlan = null;
    this.#sourceApi = null;
    this.#sourceFiles = [];
    this.#sourceSelection = null;
    this.#busy = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.state.value = { status: 'stopped', plotRunId: null, message: '' };
  }
  dispose(): void {
    this.stop();
    this.#unsubscribe();
  }
}

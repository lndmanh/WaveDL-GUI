import type { RunView } from '~~/types/daemon-api';

export const LIVE_RUNS_LIMIT = 100;
export const LIVE_POLL_ACTIVE_MS = 10_000;
export const LIVE_POLL_IDLE_MS = 60_000;
export const LIVE_POLL_MAX_MS = 120_000;

export interface LiveRunsSnapshot {
  readonly runs: readonly RunView[];
  readonly truncated: boolean;
}

export interface LiveRunsPollerOptions {
  list(signal: AbortSignal): Promise<RunView[]>;
  onChange(snapshot: LiveRunsSnapshot): void;
  onError(error: Error): void;
}

export function orderActiveRuns(runs: readonly RunView[]): RunView[] {
  const running: RunView[] = [];
  const stopping: RunView[] = [];
  const rest: RunView[] = [];

  for (const run of runs) {
    if (run.state === 'running') running.push(run);
    else if (run.state === 'stopping') stopping.push(run);
    else rest.push(run);
  }

  return [...running, ...stopping, ...rest];
}

export function liveRunsSignature(runs: readonly RunView[]): string {
  return JSON.stringify(
    runs.map((run) => [run.run_id, run.state, run.activity, run.progress?.epoch]),
  );
}

export function liveCountLabel(count: number, truncated: boolean): string | undefined {
  if (count === 0) return undefined;

  return truncated ? '99+' : String(count);
}

export class LiveRunsPoller {
  #started = false;
  #pendingRefresh = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #controller: AbortController | null = null;
  #delay = LIVE_POLL_ACTIVE_MS;
  #signature: string | null = null;

  constructor(private readonly options: LiveRunsPollerOptions) {}

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.refresh();
  }

  stop(): void {
    this.#started = false;
    this.#pendingRefresh = false;

    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#signature = null;
    this.#controller?.abort();
  }

  refresh(): void {
    if (!this.#started) return;

    if (this.#controller !== null) {
      this.#pendingRefresh = true;

      return;
    }

    this.#pendingRefresh = false;

    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const controller = new AbortController();
    this.#controller = controller;
    void this.#poll(controller);
  }

  async #poll(controller: AbortController): Promise<void> {
    try {
      const runs = await this.options.list(
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      );

      if (!this.#started || controller.signal.aborted || this.#controller !== controller) return;
      this.#delay = runs.length ? LIVE_POLL_ACTIVE_MS : LIVE_POLL_IDLE_MS;
      const ordered = orderActiveRuns(runs);
      const signature = liveRunsSignature(ordered);

      if (signature !== this.#signature) {
        this.#signature = signature;
        this.options.onChange({ runs: ordered, truncated: runs.length === LIVE_RUNS_LIMIT });
      }
    } catch (error) {
      if (!this.#started || controller.signal.aborted || this.#controller !== controller) return;
      this.#delay = Math.min(this.#delay * 2, LIVE_POLL_MAX_MS);
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.#controller === controller) {
        this.#controller = null;

        if (this.#started) {
          // A restart waits here until the aborted request has actually settled.
          if (controller.signal.aborted || this.#pendingRefresh) this.refresh();
          else {
            this.#timer = setTimeout(() => {
              this.#timer = null;
              this.refresh();
            }, this.#delay);
          }
        }
      }
    }
  }
}

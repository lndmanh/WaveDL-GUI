import { clientError } from '../i18n/client-messages';
import { DaemonApiError } from './daemon-api';
import { CursorStore, EventStreamParser, INITIAL_CURSOR } from './event-stream';
import { MetricHistory } from './metric-history';

import { diagnosticPayloadSchema } from '../../shared/schemas/run-monitor';
import type { ClientMessage } from '~~/types/i18n';
import type { RunView } from '~~/types/daemon-api';
import type { Cursor, RunEvent } from '~~/types/event-stream';
import type { RunTransport, RunMonitorSnapshot, ReplayTargetStatus } from '~~/types/run-monitor';

export function terminalRun(run: RunView): boolean {
  return !run.uncertainty && ['completed', 'failed', 'cancelled'].includes(run.state);
}

/** Cancellation is one durable intent; once acknowledged, the UI must not resend it. */
export function canRequestCancellation(
  run: RunView | null,
  state: RunMonitorSnapshot['cancellation'],
): boolean {
  return (
    run !== null &&
    !terminalRun(run) &&
    !run.cancellation_requested &&
    state !== 'sending' &&
    state !== 'requested'
  );
}

function message(cause: unknown): ClientMessage | Error {
  return cause instanceof DaemonApiError ? cause : clientError('lifecycleUnconfirmed');
}

function fatal(cause: unknown): boolean {
  return (
    cause instanceof DaemonApiError &&
    ['authentication', 'identity', 'protocol', 'response'].includes(cause.code)
  );
}

/** In-memory projection and cursor always move together. A fresh monitor replays from zero. */
export class RunMonitor {
  #abort = new AbortController();
  #cancelAbort = new AbortController();
  // Terminal observation stops before a user can retry; page pause still retires this action.
  #plotRetryAbort = new AbortController();
  #cursor: Cursor = { ...INITIAL_CURSOR };
  #listeners = new Set<(snapshot: RunMonitorSnapshot) => void>();
  #started = false;
  #running: Promise<void> | null = null;
  #refreshRevision = 0;
  #publicationTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingEvents = false;
  #liveEvents: RunEvent[] = [];
  #truncated = false;
  #history: MetricHistory;
  #logEvents: RunEvent[] = [];
  #logSizes: number[] = [];
  #logBytes = 0;
  #replayTarget: Cursor | null = null;
  #replayTargetStatus: ReplayTargetStatus = 'none';
  #persistence: 'disabled' | 'ready' | 'saved' | 'unavailable' = 'disabled';
  #loadedTarget = false;
  #durableCursor: Cursor | null = null;
  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #snapshot: RunMonitorSnapshot = {
    run: null,
    freshness: 'unconfirmed',
    events: [],
    liveEvents: [],
    stream: 'connecting',
    message: '',
    cancellation: 'idle',
    automaticPlotRetry: false,
    truncated: false,
    metrics: [],
    summary: { progress: null, best: null, latest: null },
  };
  constructor(
    readonly runId: string,
    private readonly transport: RunTransport,
    private readonly pollMs = 2000,
    private readonly reportFailure: (error: DaemonApiError) => void = () => undefined,
    private readonly cursorStore: CursorStore | null = null,
  ) {
    this.#history = new MetricHistory(runId);

    if (cursorStore && cursorStore.runId !== runId)
      throw DaemonApiError.fromKey('identity', 'eventCursorBelongsToAnotherRun');

    if (cursorStore) this.#persistence = 'ready';
  }
  snapshot(): RunMonitorSnapshot {
    // Explicit readers receive committed progress; subscribers remain coalesced.
    return this.#pendingEvents ? this.#eventSnapshot() : this.#snapshot;
  }
  position(): Cursor {
    return { ...this.#cursor };
  }
  replayTargetStatus(): ReplayTargetStatus {
    return this.#replayTargetStatus;
  }
  cursorPersistence(): 'disabled' | 'ready' | 'saved' | 'unavailable' {
    return this.#persistence;
  }
  #loadTarget(): void {
    if (this.#loadedTarget || !this.cursorStore || this.#abort.signal.aborted) return;
    this.#loadedTarget = true;
    const stored = this.cursorStore.read();

    if (stored.status === 'unavailable') {
      this.#persistence = 'unavailable';

      return;
    }

    if (stored.status === 'invalid') {
      this.#replayTargetStatus = 'invalidated';

      return;
    }

    if (stored.status === 'empty') return;
    this.#replayTarget = stored.cursor;
    this.#replayTargetStatus = stored.cursor.attempt === 0 ? 'verified' : 'pending';
    // A hint ahead of the authoritative runtime is stale/corrupt. It must
    // never become authority or block reconstruction of the available prefix.
    const attempt = this.#snapshot.run?.attempt;

    if (attempt !== undefined && (attempt === null || stored.cursor.attempt > attempt))
      this.#replayTargetStatus = 'invalidated';
  }
  subscribe(listener: (snapshot: RunMonitorSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);

    return () => this.#listeners.delete(listener);
  }
  #publish(patch: Partial<RunMonitorSnapshot>): void {
    if (this.#publicationTimer !== null) clearTimeout(this.#publicationTimer);
    this.#publicationTimer = null;

    if (this.#pendingEvents) {
      this.#pendingEvents = false;
      this.#snapshot = this.#eventSnapshot();
    }

    this.#snapshot = { ...this.#snapshot, ...patch };
    this.#liveEvents = [...this.#snapshot.liveEvents];

    for (const listener of this.#listeners) listener(this.#snapshot);
  }
  #eventSnapshot(): RunMonitorSnapshot {
    const fresh = this.#snapshot.freshness === 'fresh';

    return {
      ...this.#snapshot,
      events: [...this.#logEvents],
      liveEvents: [...this.#liveEvents],
      truncated: this.#truncated,
      metrics: fresh ? this.#history.metrics({ live: true }) : [],
      summary: fresh ? this.#history.summary() : { progress: null, best: null, latest: null },
    };
  }
  #verifyOwnership(run: RunView): void {
    if (run.run_id !== this.runId)
      throw DaemonApiError.fromKey('identity', 'runResponseBelongsToAnotherRun');
    const prior = this.#snapshot.run;

    if (
      prior &&
      (prior.plan_id !== run.plan_id ||
        prior.request_id !== run.request_id ||
        prior.backend !== run.backend ||
        prior.operation !== run.operation)
    ) {
      throw DaemonApiError.fromKey('identity', 'runOwnershipOrOperationChanged');
    }
  }
  #cancellationConfirmed(): boolean {
    return (
      this.#snapshot.cancellation === 'requested' ||
      this.#snapshot.run?.cancellation_requested === true
    );
  }
  #accept(run: RunView): void {
    this.#verifyOwnership(run);
    const prior = this.#snapshot.run;

    if (
      prior?.attempt !== null &&
      prior?.attempt !== undefined &&
      (run.attempt === null || run.attempt < prior.attempt)
    ) {
      throw DaemonApiError.fromKey('protocol', 'runtimeAttemptRegressed');
    }

    const changed = prior !== null && prior.attempt !== run.attempt;
    this.#history.setScope(run);
    this.#publish({
      run,
      freshness: 'fresh',
      liveEvents: changed ? [] : this.#liveEvents,
      cancellation: run.cancellation_requested ? 'requested' : this.#snapshot.cancellation,
      metrics: this.#history.metrics({ live: true }),
      summary: this.#history.summary(),
    });
  }
  async #refresh(): Promise<void> {
    const revision = ++this.#refreshRevision;

    try {
      const run = await this.transport.getRun(this.runId, this.#abort.signal);

      if (!this.#abort.signal.aborted && revision === this.#refreshRevision) this.#accept(run);
    } catch (error) {
      if (!this.#abort.signal.aborted && revision === this.#refreshRevision) {
        this.#publish({
          freshness: 'stale',
          metrics: [],
          liveEvents: [],
          summary: { progress: null, best: null, latest: null },
        });
      }

      throw error;
    }
  }
  #commit(event: RunEvent): void {
    if (this.#abort.signal.aborted) return;
    this.#history.apply(event);

    if (this.#replayTarget && this.#replayTargetStatus === 'pending') {
      const target = this.#replayTarget;

      if (event.attempt === target.attempt && event.seq === target.seq)
        this.#replayTargetStatus = 'verified';
      else if (
        event.attempt > target.attempt ||
        (event.attempt === target.attempt && event.seq > target.seq)
      )
        this.#replayTargetStatus = 'invalidated';
    }

    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    this.#logEvents.push(event);
    this.#logSizes.push(bytes);
    this.#logBytes += bytes;

    while (this.#logEvents.length > 1000 || this.#logBytes > 512 * 1024) {
      this.#logEvents.shift();
      this.#logBytes -= this.#logSizes.shift() ?? 0;
      this.#truncated = true;
    }

    const run = this.#snapshot.run;
    const fresh = this.#snapshot.freshness === 'fresh';
    const current = fresh && run !== null && event.attempt === run.attempt;

    if (current) {
      this.#liveEvents.push(event);

      if (this.#liveEvents.length > 256) this.#liveEvents.shift();
    }

    this.#pendingEvents = true;
    // Metrics/logs are ordinary high-volume telemetry: after the first event,
    // always use one bounded trailing publication. Wall-clock elapsed time must
    // not turn a slow commit into per-event rendering again.
    const immediate = this.#logEvents.length === 1 || event.type !== 'metric';

    if (immediate) {
      this.#publish({});
    } else if (this.#publicationTimer === null) {
      this.#publicationTimer = setTimeout(() => {
        this.#publicationTimer = null;

        if (!this.#abort.signal.aborted && this.#pendingEvents) {
          this.#publish({});
        }
      }, 250);
    }
    // An exit event is diagnostic, never the final lifecycle authority.
  }
  async #pause(ms: number): Promise<void> {
    if (this.#abort.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.#abort.signal.removeEventListener('abort', finish);
        resolve();
      };

      const timer = setTimeout(finish, ms);
      this.#abort.signal.addEventListener('abort', finish, { once: true });
    });
  }
  start(): Promise<void> {
    if (this.#started) return this.#running ?? Promise.resolve();
    this.#started = true;
    this.#running = Promise.all([this.#receive(), this.#poll()]).then(() => undefined);

    return this.#running;
  }
  /** Resume the retained projection and its cursor only after aborted readers settle. */
  async resume(allowed: () => boolean): Promise<void> {
    if (!this.#abort.signal.aborted) return;
    await this.#running;

    if (!allowed() || !this.#abort.signal.aborted) return;
    this.#abort = new AbortController();
    this.#plotRetryAbort = new AbortController();
    this.#started = false;
    await this.start();
  }
  async #receiveStream(parser: EventStreamParser, onData: () => void): Promise<void> {
    const streamAbort = new AbortController();
    const signal = AbortSignal.any([this.#abort.signal, streamAbort.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const response = await this.transport.openEvents(this.runId, this.#cursor, signal);

      if (signal.aborted) {
        await response.body?.cancel().catch(() => undefined);

        return;
      }

      if (!response.body) throw DaemonApiError.fromKey('response', 'missingEventStream');
      reader = response.body.getReader();
      this.#publish({ stream: 'live', message: '' });

      for (;;) {
        // The daemon emits a heartbeat every second. Five seconds without
        // bytes (including comments) allows several missed beats, not an
        // indefinitely buffered proxy response. Restart after actual bytes.
        const stalled = new Promise<never>((_, reject) => {
          if (this.transport.getEventPage)
            timer = setTimeout(() => {
              reject(DaemonApiError.fromKey('http', 'daemonResponseTimedOut'));
              streamAbort.abort();
            }, 5000);
        });

        try {
          const { value, done } = await Promise.race([reader.read(), stalled]);

          if (done || signal.aborted) break;
          await parser.push(value);
          onData();
        } finally {
          clearTimeout(timer);
        }
      }

      if (!signal.aborted) await parser.finish();
      this.#publish({});
    } finally {
      clearTimeout(timer);
      streamAbort.abort();
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
  }
  #canPollEvents(error: Error | DOMException): boolean {
    if (!this.transport.getEventPage) return false;

    if (error instanceof DaemonApiError)
      return (
        (error.code === 'http' && (error.status === undefined || error.status >= 500)) ||
        (error.code === 'response' &&
          ['expectedAnEventStream', 'missingEventStream'].includes(error.clientMessageKey ?? ''))
      );

    return (
      error instanceof TypeError ||
      (error instanceof DOMException &&
        ['NetworkError', 'TimeoutError', 'AbortError'].includes(error.name))
    );
  }
  async #receive(): Promise<void> {
    let retries = 0;
    // Keep JSON polling for this watch once a proxy rejects/buffers SSE.
    // Re-probing adds another silent gap without improving event semantics.
    let pollingEvents = false;

    while (!this.#abort.signal.aborted) {
      try {
        await this.#refresh();
        this.#loadTarget();
        this.#flushCursor();

        const parser = new EventStreamParser(
          this.runId,
          this.#cursor,
          (event) => this.#commit(event),
          (cursor) => {
            this.#cursor = cursor;
            this.#durableCursor = cursor;

            if (this.cursorStore && this.#persistTimer === null)
              this.#persistTimer = setTimeout(() => this.#flushCursor(), 250);
          },
          () => {
            throw clientError('streamRequiresReplay', {});
          },
          this.#abort.signal,
        );

        if (pollingEvents && this.transport.getEventPage) {
          let more = true;

          while (more && !this.#abort.signal.aborted) {
            const page = await this.transport.getEventPage(
              this.runId,
              this.#cursor,
              this.#abort.signal,
            );

            if (this.#abort.signal.aborted) break;

            // Use the same bounded parser, validation, dedupe, commit and
            // cursor-advance path as SSE, including sparse journal positions.
            for (const event of page.events) {
              await parser.push(
                new TextEncoder().encode(
                  `id: ${event.attempt}:${event.seq}\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            }

            more = page.more;
            this.#publish({ stream: 'live', message: '' });
          }
        } else {
          try {
            await this.#receiveStream(parser, () => {
              retries = 0;
            });
          } catch (error) {
            if (this.#abort.signal.aborted) break;

            if (
              !(error instanceof Error || error instanceof DOMException) ||
              !this.#canPollEvents(error)
            )
              throw error;
            pollingEvents = true;
            this.#publish({ stream: 'reconnecting', message: '' });
            continue;
          }
        }

        if (this.#abort.signal.aborted) break;
        retries = 0;
        await this.#refresh();

        if (this.#snapshot.run && terminalRun(this.#snapshot.run)) {
          if (this.#replayTargetStatus === 'pending') this.#replayTargetStatus = 'invalidated';
          this.#flushCursor();
          this.#publish({ stream: 'stopped' });

          if (this.#snapshot.run.auto_plot?.status !== 'pending') this.#abort.abort();
          break;
        }

        if (pollingEvents) {
          await this.#pause(2000);
          continue;
        }
      } catch (error) {
        if (this.#abort.signal.aborted) break;
        this.#publish({ stream: fatal(error) ? 'error' : 'reconnecting', message: message(error) });

        if (fatal(error)) {
          this.#abort.abort();
          this.#flushCursor();

          if (error instanceof DaemonApiError) this.reportFailure(error);
          break;
        }
      }

      this.#publish({ stream: 'reconnecting' });
      await this.#pause(Math.min(1000 * 2 ** Math.min(retries++, 5), 30000));
    }
  }
  async #poll(): Promise<void> {
    while (!this.#abort.signal.aborted) {
      await this.#pause(this.pollMs);

      if (this.#abort.signal.aborted) break;

      try {
        await this.#refresh();

        if (
          this.#snapshot.stream === 'stopped' &&
          this.#snapshot.run &&
          terminalRun(this.#snapshot.run) &&
          this.#snapshot.run.auto_plot?.status !== 'pending'
        )
          this.#abort.abort();
      } catch (error) {
        if (this.#abort.signal.aborted) break;
        this.#publish({ message: message(error) });

        if (fatal(error)) {
          this.#publish({ stream: 'error' });
          this.#abort.abort();
          this.#flushCursor();

          if (error instanceof DaemonApiError) this.reportFailure(error);
        }
      }
    }
  }
  async cancel(): Promise<void> {
    if (
      this.#abort.signal.aborted ||
      !canRequestCancellation(this.#snapshot.run, this.#snapshot.cancellation)
    )
      return;
    this.#publish({ cancellation: 'sending' });
    // A page pause must not turn an explicit durable cancellation into a lost ack.
    const signal = this.#cancelAbort.signal;
    const revision = ++this.#refreshRevision;

    try {
      const run = await this.transport.cancelRun(this.runId, signal);

      if (!signal.aborted) {
        this.#verifyOwnership(run);

        if (revision === this.#refreshRevision) this.#accept(run);
        this.#publish({
          cancellation:
            run.cancellation_requested || this.#cancellationConfirmed() ? 'requested' : 'unknown',
        });
      }
    } catch (error) {
      if (!signal.aborted)
        this.#publish({
          cancellation: this.#cancellationConfirmed() ? 'requested' : 'unknown',
          message: this.#cancellationConfirmed()
            ? this.#snapshot.message
            : clientError('cancellationAckUnknown'),
        });

      if (fatal(error)) {
        this.#abort.abort();
        this.#flushCursor();

        if (error instanceof DaemonApiError) this.reportFailure(error);
        this.stop();
      }
    }
  }
  async retryAutomaticPlots(): Promise<void> {
    const retry = this.transport.retryAutomaticPlots;
    const signal = this.#plotRetryAbort.signal;

    if (
      !retry ||
      signal.aborted ||
      this.#snapshot.automaticPlotRetry ||
      this.#snapshot.run?.auto_plot?.status !== 'failed'
    )
      return;
    this.#publish({ automaticPlotRetry: true, message: '' });

    try {
      const run = await retry(this.runId, signal);

      if (signal.aborted) return;
      this.#refreshRevision++;
      this.#accept(run);

      if (run.auto_plot?.status === 'pending' && this.#abort.signal.aborted) {
        await this.#running;

        if (signal.aborted) return;
        this.#abort = new AbortController();
        this.#running = this.#poll();
      }
    } catch (error) {
      if (!signal.aborted) {
        this.#publish({ message: error instanceof Error ? error : message(error) });

        if (fatal(error)) {
          this.#abort.abort();
          this.#flushCursor();

          if (error instanceof DaemonApiError) this.reportFailure(error);
        }
      }
    } finally {
      if (!signal.aborted) this.#publish({ automaticPlotRetry: false });
    }
  }
  stop(): void {
    this.#cancelAbort.abort();
    this.pause();
  }
  pause(): void {
    this.#plotRetryAbort.abort();
    this.#flushCursor();
    this.#abort.abort();
    this.#publish({
      stream: 'stopped',
      freshness: 'stale',
      automaticPlotRetry: false,
      liveEvents: [],
      metrics: [],
      summary: { progress: null, best: null, latest: null },
    });
  }
  #flushCursor(): void {
    if (this.#persistTimer !== null) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }

    const cursor = this.#durableCursor;

    if (!this.cursorStore || cursor === null || this.#abort.signal.aborted) return;
    this.#durableCursor = null;

    try {
      this.cursorStore.save(cursor);
      this.#persistence = 'saved';
    } catch {
      // Storage denial is a durability degradation only; replay remains safe.
      this.#persistence = 'unavailable';
    }
  }
}

export function eventDiagnostic(event: RunEvent) {
  const payload = event.payload;

  const diagnostic = diagnosticPayloadSchema.parse(payload);
  const text = diagnostic.message ?? diagnostic.text ?? JSON.stringify(payload);

  // Keep the existing 4096-code-unit presentation ceiling, reserving space
  // for a visible omission marker and never splitting a surrogate pair.
  // The authoritative event and replay cursor remain untouched.
  const truncated = text.length > 4096;
  let end = 4093;

  if (truncated && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end--;
  const rendered = truncated ? `${text.slice(0, end)} …` : text;

  return {
    text: `${event.ts} [${event.attempt}:${event.seq}] ${event.type}: ${rendered}`,
    truncated,
  };
}

export function eventText(event: RunEvent): string {
  return eventDiagnostic(event).text;
}

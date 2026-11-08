import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, onScopeDispose, shallowRef, watch } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { useRuns } from '../../app/composables/useRuns';
import { canRequestCancellation, eventDiagnostic, RunMonitor } from '../../app/lib/run-monitor';
import { DaemonApi, DaemonApiError, parseJson } from '../../app/lib/daemon-api';
import { EventStreamParser } from '../../app/lib/event-stream';
import { MetricHistory } from '../../app/lib/metric-history';
import type { RunTransport } from '../../types/run-monitor';
import type { RunView } from '../../types/daemon-api';
import type { RunEvent } from '../../types/event-stream';
import type { JsonObject } from '../../types/json';

const id = '11111111-1111-1111-1111-111111111111';

function metricEvent(
  payload: JsonObject,
  type: RunEvent['type'] = 'metric',
  attempt = 1,
  seq = 0,
): RunEvent {
  return {
    protocol: 'wavedl-run',
    version: 2,
    run_id: id,
    attempt,
    seq,
    type,
    ts: '2026-10-07T00:00:00Z',
    payload,
  };
}

describe('metric payload boundary schemas', () => {
  it('caches frozen live metrics by revision without exposing mutable history', () => {
    const history = new MetricHistory(id);
    history.setScope(view());
    history.apply(
      metricEvent({
        name: 'loss',
        value: 4,
        step: 1,
        metrics: { extra: { nested: [1, { value: 2 }] } },
      }),
    );
    const projection = history.liveMetrics();
    const first = projection[0];

    if (!first) throw new Error('Missing metric record');
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.metrics.extra)).toBe(true);
    expect(() => {
      first.active = false;
    }).toThrow();
    expect(() => {
      first.metrics.extra = null;
    }).toThrow();
    const extra = first.metrics.extra;

    if (!(extra instanceof Object) || Array.isArray(extra))
      throw new Error('Missing nested metrics');
    const nested = extra.nested;
    expect(Object.isFrozen(nested)).toBe(true);

    if (!Array.isArray(nested)) throw new Error('Missing nested metrics array');
    expect(() => nested.push(3)).toThrow();
    expect(history.liveMetrics()).toBe(projection);
    history.setScope(view());
    history.apply(metricEvent({ message: 'diagnostic' }, 'warning', 1, 1));
    expect(history.liveMetrics()).toBe(projection);
    history.apply(metricEvent({ name: 'loss', value: 3, step: 1 }, 'metric', 1, 2));
    const replacement = history.liveMetrics();
    expect(replacement).not.toBe(projection);
    expect(projection[0]?.active).toBe(true);
    expect(history.metrics({ activeOnly: false })[0]?.active).toBe(false);
    history.apply(metricEvent({ cause: 'requeue' }, 'attempt', 2, 0));
    expect(history.liveMetrics()).not.toBe(replacement);
    expect(history.liveMetrics()).toEqual([]);
    history.setScope(view({ attempt: 2 }));
    expect(history.liveMetrics()).toEqual(replacement);
  });
  it('projects numeric series without coercing details or falling back over present non-numeric fields', () => {
    const history = new MetricHistory(id);

    for (const [seq, value] of [4, null, '5', false, [6], { nested: 7 }].entries()) {
      history.apply(
        metricEvent(
          { name: 'custom', value: 99, step: seq, metrics: { custom: value } },
          'metric',
          1,
          seq,
        ),
      );
    }

    history.apply(metricEvent({ name: 'custom', value: 8, step: 6 }, 'metric', 1, 6));
    history.apply(metricEvent({ name: 'other', value: 9, step: 7 }, 'metric', 1, 7));

    expect(history.series('custom')).toEqual([
      { attempt: 1, seq: 0, step: 0, value: 4 },
      { attempt: 1, seq: 1, step: 1, value: null },
      { attempt: 1, seq: 6, step: 6, value: 8 },
    ]);
    expect(history.series('absent')).toEqual([]);
    expect(history.series('custom', { attempt: 2 })).toEqual([]);
    expect(Object.hasOwn(history.metrics()[0] ?? {}, 'numeric')).toBe(false);
    expect(Object.hasOwn(history.summary().latest ?? {}, 'numeric')).toBe(false);
  });

  it('uses ingestion-time numeric values for physical parameter summaries and isolates snapshots', () => {
    const history = new MetricHistory(id);
    history.apply(
      metricEvent({
        name: 'loss',
        value: 1,
        step: 0,
        metrics: { MAE_Phys_P2: 3, MAE_Phys_P1: null, extra: 'ignored' },
      }),
    );
    const record = history.metrics()[0];

    if (!record) throw new Error('Missing metric record');
    record.metrics.MAE_Phys_P2 = 100;
    expect(history.summary().current?.parameters).toEqual([
      { name: 'MAE_Phys_P2', value: 3 },
      { name: 'MAE_Phys_P1', value: null },
    ]);
    expect(history.series('MAE_Phys_P2')[0]?.value).toBe(3);
    expect(history.series('extra')).toEqual([]);
  });

  it('retains typed option bounds', () => {
    for (const maxPoints of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new MetricHistory(id, { maxPoints })).toThrow();
    }
  });

  it.each([
    { payload: { name: 1, step: 0, value: null }, key: 'invalidMetricPayload' },
    { payload: { name: '', step: 0, value: null, unit: null }, key: 'invalidMetricPayload' },
    { payload: { name: '', step: 0, value: null, metrics: [] }, key: 'invalidMetricDetails' },
    {
      payload: { name: '', step: 0, value: null, metrics: { lr: '1' } },
      key: 'invalidNumericMetric',
      field: 'lr',
    },
    {
      payload: { name: '', step: 0, value: null, metrics: { epoch: 0.5 } },
      key: 'invalidIntegerMetric',
      field: 'epoch',
    },
    {
      payload: { name: '', step: 0, value: null, metrics: { MAE_Phys_P1: false } },
      key: 'invalidNumericMetric',
      field: 'MAE_Phys_P1',
    },
    {
      payload: { name: '', step: 0, value: null, metrics: { mae_per_param: [true] } },
      key: 'invalidPerParameterMetrics',
    },
    {
      payload: { name: '', step: 0, value: null, metrics: { per_param_mae: { x: '1' } } },
      key: 'invalidPerParameterMetrics',
    },
    {
      payload: { name: '', step: 0, value: null, metrics: { other: Infinity } },
      key: 'invalidJsonValue',
    },
  ])('preserves failure diagnostics for $key / $field', ({ payload, key, field }) => {
    const history = new MetricHistory(id);

    try {
      history.apply(metricEvent(payload));
      throw new Error('Expected metric rejection');
    } catch (cause) {
      expect(cause).toMatchObject({ clientMessageKey: key });

      if (field !== undefined) expect(cause).toMatchObject({ clientMessageParams: { field } });
    }

    expect(history.size).toBe(0);
  });

  it('preserves legal dictionary members and validates their children', () => {
    const history = new MetricHistory(id);
    const metrics = parseJson('{"__proto__":{"value":1},"per_param_mae":{"__proto__":2}}');
    history.apply(metricEvent({ name: 'loss', value: 0, step: 0, metrics }));
    expect(Object.hasOwn(history.metrics()[0]?.metrics ?? {}, '__proto__')).toBe(true);
    expect(history.summary().current?.parameters).toEqual([{ name: '__proto__', value: 2 }]);
  });

  it('keeps additive metrics, null defaults, finite values and insertion-order diagnostics', () => {
    const history = new MetricHistory(id);
    history.apply(metricEvent({ name: '', value: -1e100, step: 0, metrics: null }));
    history.apply(
      metricEvent(
        {
          name: 'loss',
          value: null,
          step: 1,
          metrics: {
            train_loss: 1e100,
            epoch: 0,
            total_epochs: 1,
            mae_per_param: [null, 2],
            extra: { allowed: true },
          },
        },
        'metric',
        1,
        1,
      ),
    );
    expect(history.metrics()[0]?.metrics).toEqual({});
    expect(history.summary().current?.parameters).toEqual([
      { name: 'P1', value: null },
      { name: 'P2', value: 2 },
    ]);
    expect(() =>
      history.apply(
        metricEvent(
          { name: '', value: 0, step: 2, metrics: { epoch: -1, lr: 'bad' } },
          'metric',
          1,
          2,
        ),
      ),
    ).toThrow();

    try {
      history.apply(
        metricEvent(
          { name: '', value: 0, step: 2, metrics: { epoch: -1, lr: 'bad' } },
          'metric',
          1,
          2,
        ),
      );
    } catch (cause) {
      expect(cause).toMatchObject({
        clientMessageKey: 'invalidIntegerMetric',
        clientMessageParams: { field: 'epoch' },
      });
    }
  });

  it('retires earlier attempt steps from the requeued attempt resume step onward', () => {
    const history = new MetricHistory(id);

    const epoch = (attempt: number, seq: number, step: number) =>
      metricEvent(
        { name: 'epoch', value: step, step, unit: '', metrics: { epoch: step, val_r2: step } },
        'metric',
        attempt,
        seq,
      );

    history.apply(metricEvent({ cause: 'submit', restart_count: null }, 'attempt'));

    for (let step = 1; step <= 8; step++) history.apply(epoch(1, step, step));
    history.apply(metricEvent({ cause: 'requeue', restart_count: 1 }, 'attempt', 2));
    expect(history.summary()).toEqual({ progress: null, best: null, latest: null });
    history.apply(epoch(2, 1, 6));
    history.apply(epoch(2, 2, 7));

    expect(history.metrics().map((record) => [record.attempt, record.step])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [2, 6],
      [2, 7],
    ]);
    expect(history.metrics({ activeOnly: false })).toHaveLength(10);
    expect(history.summary().latest?.attempt).toBe(2);
    expect(history.summary().current?.bestR2).toBe(7);
  });

  it('keeps a missed attempt event from leaving earlier steps active', () => {
    const history = new MetricHistory(id);
    history.apply(metricEvent({ name: 'epoch', value: 1, step: 1 }, 'metric', 1, 1));
    history.apply(metricEvent({ name: 'epoch', value: 2, step: 2 }, 'metric', 1, 2));
    history.apply(metricEvent({ name: 'epoch', value: 9, step: 2 }, 'metric', 2, 3));
    expect(history.metrics().map((record) => record.value)).toEqual([1, 9]);
  });
});

describe('diagnostic payload boundary', () => {
  it('keeps message precedence, empty strings and non-string fallbacks', () => {
    expect(eventDiagnostic(metricEvent({ message: '', text: 'fallback' }, 'warning')).text).toBe(
      '2026-10-07T00:00:00Z [1:0] warning: ',
    );
    expect(
      eventDiagnostic(metricEvent({ message: false, text: 'fallback' }, 'warning')).text,
    ).toContain('warning: fallback');
    expect(eventDiagnostic(metricEvent({ message: false, text: null }, 'warning')).text).toContain(
      '{"message":false,"text":null}',
    );
  });
});

function view(patch: Partial<RunView> = {}): RunView {
  return {
    plan_id: id,
    run_id: id,
    request_id: id,
    backend: 'slurm',
    operation: 'train',
    attempt: 1,
    state: 'running',
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
    ...patch,
  };
}

function frame(seq: number, type: RunEvent['type'] = 'warning', attempt = 1): Uint8Array {
  return new TextEncoder().encode(
    `id: ${attempt}:${seq}\ndata: ${JSON.stringify({ protocol: 'wavedl-run', version: 2, run_id: id, attempt, seq, type, ts: '2026-10-07T00:00:00Z', payload: { message: '<script>never HTML</script>' } })}\n\n`,
  );
}

function harness(initial = view()) {
  let current = initial;
  let channel: ReadableStreamDefaultController<Uint8Array> | undefined;

  const transport: RunTransport = {
    getRun: vi.fn(async () => current),
    cancelRun: vi.fn(async () => view({ cancellation_requested: true, state: 'stopping' })),
    openEvents: vi.fn(
      async (_id, _cursor, signal) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              channel = controller;
              signal.addEventListener(
                'abort',
                () => {
                  try {
                    controller.close();
                  } catch {
                    /* already closed */
                  }
                },
                { once: true },
              );
            },
          }),
        ),
    ),
  };

  const reportFailure = vi.fn();
  const monitor = new RunMonitor(id, transport, 100, reportFailure);

  return {
    monitor,
    reportFailure,
    transport,
    set: (run: RunView) => {
      current = run;
    },
    send: (seq: number, type?: RunEvent['type'], attempt?: number) =>
      channel?.enqueue(frame(seq, type, attempt)),
    raw: (text: string) => channel?.enqueue(new TextEncoder().encode(text)),
    sendCombined: () => {
      const first = frame(0),
        second = frame(1);

      const combined = new Uint8Array(first.length + second.length);
      combined.set(first);
      combined.set(second, first.length);
      channel?.enqueue(combined);
    },
    end: () => channel?.close(),
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('run monitoring', () => {
  it('accepts sparse JSON events through ordered ingress without SSE re-encoding', async () => {
    const h = harness(view({ attempt: 4, state: 'completed' }));
    vi.mocked(h.transport.openEvents).mockRejectedValue(new TypeError('SSE unavailable'));
    const push = vi.spyOn(EventStreamParser.prototype, 'push');
    h.transport.getEventPage = vi.fn(async () => ({
      events: [
        metricEvent({ message: 'first' }, 'warning', 1, 3),
        metricEvent({ message: 'duplicate' }, 'warning', 1, 3),
        metricEvent({ message: 'old' }, 'warning', 1, 2),
        metricEvent({ message: 'sparse' }, 'warning', 1, 19),
        metricEvent({ message: 'requeue' }, 'warning', 4, 3),
        metricEvent({ message: 'old attempt' }, 'warning', 2, 99),
      ],
      next_cursor: { attempt: 4, seq: 3 },
      more: false,
    }));

    try {
      await h.monitor.start();
      expect(push).not.toHaveBeenCalled();
      expect(h.monitor.snapshot().events.map((event) => [event.attempt, event.seq])).toEqual([
        [1, 3],
        [1, 19],
        [4, 3],
      ]);
      expect(h.monitor.position()).toEqual({ attempt: 4, seq: 3 });
    } finally {
      push.mockRestore();
      h.monitor.stop();
    }
  });
  it('has one periodic state-refresh owner while draining JSON fallback pages', async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.mocked(h.transport.openEvents).mockRejectedValue(new TypeError('SSE unavailable'));
    h.transport.getEventPage = vi.fn(async () => ({
      events: [],
      next_cursor: { attempt: 0, seq: -1 },
      more: false,
    }));
    const task = h.monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.transport.getRun).toHaveBeenCalledTimes(1);

    for (let interval = 1; interval <= 40; interval++) {
      await vi.advanceTimersByTimeAsync(100);
      expect(h.transport.getRun).toHaveBeenCalledTimes(interval + 1);
    }

    expect(h.transport.getEventPage).toHaveBeenCalledTimes(3);
    h.set(view({ state: 'completed' }));
    await vi.advanceTimersByTimeAsync(2000);
    await task;
    expect(h.monitor.snapshot().stream).toBe('stopped');
    const calls = vi.mocked(h.transport.getRun).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.getRun).toHaveBeenCalledTimes(calls);
  });
  it('drains again when terminal authority arrives during an in-flight JSON page', async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.mocked(h.transport.openEvents).mockRejectedValue(new TypeError('SSE unavailable'));
    let finishPage: (() => void) | undefined;
    const getEventPage = vi.fn<NonNullable<RunTransport['getEventPage']>>();
    getEventPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPage = () =>
            resolve({
              events: [],
              next_cursor: { attempt: 0, seq: -1 },
              more: false,
            });
        }),
    );
    getEventPage.mockResolvedValue({
      events: [metricEvent({ message: 'final diagnostic' }, 'warning', 1, 7)],
      next_cursor: { attempt: 1, seq: 7 },
      more: false,
    });
    h.transport.getEventPage = getEventPage;
    const task = h.monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    h.set(view({ state: 'completed' }));
    await vi.advanceTimersByTimeAsync(100);
    finishPage?.();
    await task;
    expect(getEventPage).toHaveBeenCalledTimes(2);
    expect(h.monitor.position()).toEqual({ attempt: 1, seq: 7 });
    expect(h.monitor.snapshot().events.at(-1)?.payload.message).toBe('final diagnostic');
    expect(h.monitor.snapshot().stream).toBe('stopped');
  });
  it('falls back after five silent heartbeat intervals, drains pages and resumes only committed events', async () => {
    vi.useFakeTimers();
    const h = harness();
    const getEventPage = vi.fn<NonNullable<RunTransport['getEventPage']>>();
    h.transport.getEventPage = getEventPage;

    const event = (seq: number) =>
      metricEvent({ name: 'loss', value: 1 / (seq + 1), step: seq }, 'metric', 1, seq);

    getEventPage
      .mockResolvedValueOnce({
        events: [event(0), event(1), event(2)],
        next_cursor: { attempt: 1, seq: 2 },
        more: true,
      })
      .mockResolvedValueOnce({
        events: [event(3)],
        next_cursor: { attempt: 1, seq: 3 },
        more: false,
      })
      .mockResolvedValue({ events: [], next_cursor: { attempt: 1, seq: 3 }, more: false });
    const task = h.monitor.start();
    await flush();
    h.send(0);
    // The last uncommitted frame must be discarded when abandoning SSE.
    h.raw('id: 1:1\ndata: {"unfinished":');
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(getEventPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getEventPage).toHaveBeenCalledTimes(2);
    expect(getEventPage.mock.calls[0]?.[1]).toEqual({ attempt: 1, seq: 0 });
    expect(getEventPage.mock.calls[1]?.[1]).toEqual({ attempt: 1, seq: 2 });
    expect(h.monitor.snapshot().events.map((item) => item.seq)).toEqual([0, 1, 2, 3]);
    expect(h.monitor.snapshot().metrics).toHaveLength(3);
    expect(h.monitor.position()).toEqual({ attempt: 1, seq: 3 });
    expect(h.monitor.snapshot().stream).toBe('live');
    await vi.advanceTimersByTimeAsync(1999);
    expect(getEventPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(getEventPage).toHaveBeenCalledTimes(3);
    expect(h.transport.openEvents).toHaveBeenCalledTimes(1);
    h.monitor.stop();
    await task;
    await vi.advanceTimersByTimeAsync(10000);
    expect(getEventPage).toHaveBeenCalledTimes(3);
  });
  it('falls back from a completely buffered response and aborts an in-flight page on stop', async () => {
    vi.useFakeTimers();
    const h = harness();
    let pageSignal: AbortSignal | undefined;

    const getEventPage = vi.fn<NonNullable<RunTransport['getEventPage']>>(
      async (_runId, _cursor, signal) => {
        pageSignal = signal;

        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                events: [metricEvent({ message: 'late' }, 'warning')],
                next_cursor: { attempt: 1, seq: 0 },
                more: false,
              }),
            { once: true },
          );
        });
      },
    );

    h.transport.getEventPage = getEventPage;
    const task = h.monitor.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getEventPage).toHaveBeenCalledTimes(1);
    expect(getEventPage.mock.calls[0]?.[1]).toEqual({ attempt: 0, seq: -1 });
    h.monitor.stop();
    await task;
    expect(pageSignal?.aborted).toBe(true);
    expect(h.monitor.snapshot().events).toEqual([]);
    expect(h.monitor.position()).toEqual({ attempt: 0, seq: -1 });
  });
  it('counts heartbeat comments as stream bytes instead of switching healthy idle runs', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.transport.getEventPage = vi.fn();
    const task = h.monitor.start();
    await flush();

    for (let beat = 0; beat < 3; beat++) {
      await vi.advanceTimersByTimeAsync(4000);
      h.raw(': heartbeat\n\n');
      await flush();
    }

    expect(h.transport.getEventPage).not.toHaveBeenCalled();
    expect(h.monitor.position()).toEqual({ attempt: 0, seq: -1 });
    h.monitor.stop();
    await task;
  });
  it('switches a failed stream to bounded event polling and stops after draining a terminal run', async () => {
    vi.useFakeTimers();
    const h = harness(view({ state: 'completed' }));
    vi.mocked(h.transport.openEvents).mockRejectedValueOnce(new TypeError('network disconnected'));

    const events = Array.from({ length: 1010 }, (_, seq) =>
      metricEvent({ message: 'diagnostic' }, 'warning', 1, seq),
    );

    const getEventPage = vi.fn<NonNullable<RunTransport['getEventPage']>>();
    let offset = 0;
    getEventPage.mockImplementation(async () => {
      const page = events.slice(offset, offset + 256);
      offset += page.length;

      return {
        events: page,
        next_cursor: { attempt: 1, seq: offset - 1 },
        more: offset < events.length,
      };
    });
    h.transport.getEventPage = getEventPage;
    const task = h.monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await task;
    expect(getEventPage).toHaveBeenCalledTimes(4);
    expect(h.monitor.snapshot().events).toHaveLength(1000);
    expect(h.monitor.snapshot().liveEvents).toHaveLength(256);
    expect(h.monitor.snapshot().truncated).toBe(true);
    expect(h.monitor.position()).toEqual({ attempt: 1, seq: 1009 });
    expect(h.monitor.snapshot().stream).toBe('stopped');
    expect(h.reportFailure).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])('does not hide HTTP %i behind polling', async (status) => {
    vi.useFakeTimers();
    const h = harness();
    h.transport.getEventPage = vi.fn();
    vi.mocked(h.transport.openEvents).mockRejectedValue(
      DaemonApiError.fromKey(status === 401 ? 'authentication' : 'http', 'daemonRequestFailed', {
        status,
        params: { status },
      }),
    );
    const task = h.monitor.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.transport.getEventPage).not.toHaveBeenCalled();
    h.monitor.stop();
    await task;
  });
  it('keeps protocol violations fatal rather than falling back to polling', async () => {
    const h = harness();
    h.transport.getEventPage = vi.fn();
    const task = h.monitor.start();
    await flush();
    h.raw('id: 1:0\ndata: {"malformed":true}\n\n');
    await task;
    expect(h.transport.getEventPage).not.toHaveBeenCalled();
    expect(h.monitor.snapshot().stream).toBe('error');
  });
  it.each([
    { attempt: null },
    { attempt: 0 },
    { plan_id: '22222222-2222-2222-2222-222222222222' },
    { request_id: '22222222-2222-2222-2222-222222222222' },
    { backend: 'local' },
    { operation: 'plot' as const },
  ])('revokes monitoring on malformed, foreign or regressing authority %j', async (patch) => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.set(view(patch));
    await vi.advanceTimersByTimeAsync(100);
    await task;
    expect(h.reportFailure).toHaveBeenCalledTimes(1);
    expect(h.monitor.snapshot().run?.state).toBe('running');
    expect(h.monitor.snapshot().freshness).toBe('stale');
    expect(h.monitor.snapshot().stream).toBe('error');
  });
  it('aborts within an already-read chunk without advancing past undisplayed frames', async () => {
    const h = harness();
    h.monitor.subscribe((snapshot) => {
      if (snapshot.events.length === 1) h.monitor.stop();
    });
    const task = h.monitor.start();
    await flush();
    h.sendCombined();
    await task;
    expect(h.monitor.snapshot().events).toHaveLength(1);
    expect(h.monitor.position()).toEqual({ attempt: 0, seq: -1 });
  });
  it('marks lifecycle polling failure stale without replacing last authoritative state', async () => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    expect(h.monitor.snapshot().freshness).toBe('fresh');
    vi.mocked(h.transport.getRun).mockRejectedValueOnce(new Error('accounting interrupted'));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.monitor.snapshot().run?.state).toBe('running');
    expect(h.monitor.snapshot().freshness).toBe('stale');
    h.send(0);
    await flush();
    expect(h.monitor.snapshot().freshness).toBe('stale');
    expect(h.monitor.snapshot().liveEvents).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.monitor.snapshot().freshness).toBe('fresh');
    h.monitor.stop();
    await task;
  });
  it('keeps accounting loss uncertain and does not infer completion from silence', async () => {
    vi.useFakeTimers();
    const h = harness(view({ state: 'observation_unavailable', uncertainty: true }));
    const task = h.monitor.start();
    await flush();
    h.end();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(h.monitor.snapshot().run?.state).toBe('observation_unavailable');
    expect(h.transport.openEvents).toHaveBeenCalledTimes(2);
    h.monitor.stop();
    await task;
  });
  it('bounds plain-text diagnostic projection while preserving its replay cursor', async () => {
    const h = harness();
    const task = h.monitor.start();
    await flush();

    for (let seq = 0; seq < 1010; seq++) h.send(seq);

    await vi.waitFor(() => expect(h.monitor.position()).toEqual({ attempt: 1, seq: 1009 }));
    expect(h.monitor.snapshot().events).toHaveLength(1000);
    expect(h.monitor.snapshot().truncated).toBe(true);
    expect(h.monitor.snapshot().events[0]?.payload.message).toBe('<script>never HTML</script>');
    expect(h.monitor.snapshot().liveEvents).toHaveLength(256);
    h.monitor.stop();
    await task;
  });
  it('retains authoritative held/uncertain states even when runtime exit arrives', async () => {
    const h = harness(view({ state: 'held', uncertainty: true }));
    const task = h.monitor.start();
    await flush();
    h.send(0, 'exited');
    await flush();
    expect(h.monitor.snapshot().run?.state).toBe('held');
    expect(h.monitor.snapshot().run?.uncertainty).toBe(true);
    h.monitor.stop();
    await task;
  });
  it('fences old attempt events once a newer attempt is authoritative and preserves diagnostics', async () => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.send(0);
    await flush();
    expect(h.monitor.snapshot().liveEvents).toHaveLength(1);
    h.set(view({ attempt: 2 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.monitor.snapshot().liveEvents).toHaveLength(0);
    h.send(1);
    await flush();
    expect(h.monitor.snapshot().liveEvents).toHaveLength(0);
    expect(h.monitor.snapshot().events).toHaveLength(2);
    h.send(0, 'attempt', 2);
    await flush();
    expect(h.monitor.snapshot().liveEvents.map((event) => event.attempt)).toEqual([2]);
    h.monitor.stop();
    await task;
  });
  it('lost cancellation response never invents cancelled state; retry is available', async () => {
    const h = harness();
    const task = h.monitor.start();
    await flush();
    vi.mocked(h.transport.cancelRun).mockRejectedValueOnce(new Error('lost'));
    await h.monitor.cancel();
    expect(h.monitor.snapshot().cancellation).toBe('unknown');
    expect(h.monitor.snapshot().run?.state).toBe('running');
    await h.monitor.cancel();
    expect(h.monitor.snapshot().cancellation).toBe('requested');
    expect(h.monitor.snapshot().run?.state).toBe('stopping');
    h.monitor.stop();
    await task;
  });
  it('does not resend an already acknowledged cancellation intent', async () => {
    const h = harness();
    const task = h.monitor.start();
    await flush();
    await h.monitor.cancel();
    await h.monitor.cancel();
    expect(h.transport.cancelRun).toHaveBeenCalledTimes(1);
    expect(h.monitor.snapshot().cancellation).toBe('requested');
    h.monitor.stop();
    await task;
  });
  it('allows retry only after an unknown cancellation outcome', () => {
    expect(canRequestCancellation(view(), 'unknown')).toBe(true);
    expect(canRequestCancellation(view({ cancellation_requested: true }), 'idle')).toBe(false);
    expect(canRequestCancellation(view(), 'requested')).toBe(false);
  });
  it.each([
    ['no run', null, 'idle'],
    ['confirmed terminal', view({ state: 'completed' }), 'idle'],
    ['durable cancellation already set', view({ cancellation_requested: true }), 'idle'],
    ['in-flight request', view(), 'sending'],
  ] as const)('blocks cancellation for %s', (_label, run, state) => {
    expect(canRequestCancellation(run, state)).toBe(false);
  });
  it('keeps uncertain supervision loss and unallocated runs cancellable', () => {
    expect(
      canRequestCancellation(view({ state: 'supervision_lost', uncertainty: true }), 'idle'),
    ).toBe(true);
    expect(
      canRequestCancellation(
        view({ attempt: null, state: 'submission_unknown', uncertainty: true }),
        'unknown',
      ),
    ).toBe(true);
  });
  it.each(['reject', 'false', 'older-true'] as const)(
    'retains poll-confirmed cancellation across a deferred %s POST response',
    async (outcome) => {
      vi.useFakeTimers();
      const h = harness();
      const task = h.monitor.start();
      await flush();
      let resolve!: (run: RunView) => void;
      let reject!: (error: Error) => void;
      vi.mocked(h.transport.cancelRun).mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const cancellation = h.monitor.cancel();
      await h.monitor.cancel();
      expect(h.transport.cancelRun).toHaveBeenCalledTimes(1);
      h.set(view({ attempt: 2, cancellation_requested: true, state: 'stopping' }));
      await vi.advanceTimersByTimeAsync(100);
      expect(h.monitor.snapshot().cancellation).toBe('requested');

      if (outcome === 'reject') reject(new Error('lost acknowledgement'));
      else resolve(view({ cancellation_requested: outcome === 'older-true' }));
      await cancellation;
      expect(h.monitor.snapshot().cancellation).toBe('requested');
      expect(h.monitor.snapshot().run?.attempt).toBe(2);
      expect(h.monitor.snapshot().run?.state).toBe('stopping');
      h.set(view({ attempt: 2, cancellation_requested: false }));
      await vi.advanceTimersByTimeAsync(100);
      expect(h.monitor.snapshot().run?.cancellation_requested).toBe(false);
      expect(h.monitor.snapshot().cancellation).toBe('requested');
      await h.monitor.cancel();
      expect(h.transport.cancelRun).toHaveBeenCalledTimes(1);
      h.monitor.stop();
      await task;
    },
  );
  it.each(['run_id', 'plan_id', 'request_id', 'backend', 'operation'] as const)(
    'rejects a deferred foreign %s cancellation response even after a newer poll',
    async (field) => {
      vi.useFakeTimers();
      const h = harness();
      const task = h.monitor.start();
      await flush();
      let resolve!: (run: RunView) => void;
      vi.mocked(h.transport.cancelRun).mockImplementationOnce(
        () =>
          new Promise((yes) => {
            resolve = yes;
          }),
      );
      const cancellation = h.monitor.cancel();
      h.set(view({ attempt: 2 }));
      await vi.advanceTimersByTimeAsync(100);
      resolve(
        view({ ...{ [field]: 'foreign' }, cancellation_requested: true, state: 'cancelled' }),
      );
      await cancellation;
      expect(h.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'identity' }));
      expect(h.monitor.snapshot().cancellation).toBe('unknown');
      expect(h.monitor.snapshot().run?.attempt).toBe(2);
      expect(h.monitor.snapshot().run?.state).toBe('running');
      await task;
    },
  );
  it('accepts a deferred cancellation acknowledgement without replacing a newer attempt', async () => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    let resolve!: (run: RunView) => void;
    vi.mocked(h.transport.cancelRun).mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const cancellation = h.monitor.cancel();
    const newer = view({ attempt: 2 });

    h.set(newer);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.monitor.snapshot().run).toEqual(newer);
    expect(h.monitor.snapshot().cancellation).toBe('sending');
    resolve(view({ cancellation_requested: true, state: 'stopping' }));
    await cancellation;
    expect(h.reportFailure).not.toHaveBeenCalled();
    expect(h.monitor.snapshot().cancellation).toBe('requested');
    expect(h.monitor.snapshot().run).toEqual(newer);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.monitor.snapshot().run).toEqual(newer);
    expect(h.monitor.snapshot().run?.cancellation_requested).toBe(false);
    expect(h.monitor.snapshot().cancellation).toBe('requested');
    await h.monitor.cancel();
    expect(h.transport.cancelRun).toHaveBeenCalledTimes(1);
    h.monitor.stop();
    await task;
  });
  it('closing only aborts monitoring and never requests cancellation', async () => {
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.monitor.stop();
    await task;
    expect(h.transport.cancelRun).not.toHaveBeenCalled();
  });
  it('does not resurrect a monitor when a deferred stream opens after stop', async () => {
    let resolveOpen: ((response: Response) => void) | undefined;

    const transport: RunTransport = {
      getRun: vi.fn(async () => view()),
      cancelRun: vi.fn(async () => view()),
      openEvents: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveOpen = resolve;
          }),
      ),
    };

    const monitor = new RunMonitor(id, transport);
    const task = monitor.start();
    await flush();
    monitor.stop();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    resolveOpen?.(new Response(body));
    await task;
    expect(monitor.snapshot().stream).toBe('stopped');
    expect(monitor.snapshot().freshness).toBe('stale');
  });
  it('reconnect reuses committed cursor; a fresh monitor reconstructs from initial cursor', async () => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.send(3);
    await flush();
    h.end();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(vi.mocked(h.transport.openEvents).mock.calls[1]?.[1]).toEqual({ attempt: 1, seq: 3 });
    h.monitor.stop();
    await task;
    const fresh = new RunMonitor(id, h.transport);
    const next = fresh.start();
    await flush();
    expect(vi.mocked(h.transport.openEvents).mock.lastCall?.[1]).toEqual({ attempt: 0, seq: -1 });
    fresh.stop();
    await next;
  });
  it('reconstructs a requeued attempt and diagnostics from zero', async () => {
    vi.useFakeTimers();
    const h = harness(view({ attempt: 2 }));
    const task = h.monitor.start();
    await flush();

    const send = (attempt: number, seq: number, type: RunEvent['type'], payload: JsonObject) => {
      h.raw(
        `id: ${attempt}:${seq}\ndata: ${JSON.stringify({ protocol: 'wavedl-run', version: 2, run_id: id, attempt, seq, type, ts: '2026-10-07T00:00:00Z', payload })}\n\n`,
      );
    };

    send(1, 0, 'attempt', { cause: 'submit', restart_count: null });
    send(1, 1, 'metric', { name: 'loss', value: 4, step: 1 });
    send(1, 2, 'metric', { name: 'loss', value: 2, step: 2 });
    send(2, 0, 'attempt', { cause: 'requeue', restart_count: 1 });
    send(2, 1, 'metric', { name: 'loss', value: 3, step: 2 });

    for (let i = 0; i < 20; i++) await flush();
    expect(h.monitor.snapshot().metrics.map((record) => record.value)).toEqual([4, 3]);
    expect(h.monitor.snapshot().events).toHaveLength(5);
    expect(h.transport.openEvents).toHaveBeenCalledWith(
      id,
      { attempt: 0, seq: -1 },
      expect.anything(),
    );
    h.monitor.stop();
    await task;
  });
  it('does not advance a failed consumer commit or a pending cursor after fatal retirement', async () => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.send(0);
    h.send(1, 'metric'); // malformed metric payload throws before apply/cursor commit
    await flush();
    await task;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.monitor.position()).toEqual({ attempt: 1, seq: 0 });
    h.monitor.stop();
  });
  it('confirmed terminal lifecycle after EOF stops; exit alone does not', async () => {
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.send(0, 'exited');
    await flush();
    expect(h.monitor.snapshot().stream).toBe('live');
    h.set(view({ state: 'completed' }));
    h.end();
    await task;
    expect(h.monitor.snapshot().run?.state).toBe('completed');
    expect(h.monitor.snapshot().stream).toBe('stopped');
  });
  it('stops polling after a confirmed terminal run without reopening SSE', async () => {
    vi.useFakeTimers();
    const h = harness(view({ state: 'completed' }));
    const task = h.monitor.start();
    await flush();
    h.end();
    await task;
    const calls = vi.mocked(h.transport.getRun).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.transport.getRun).toHaveBeenCalledTimes(calls);
    expect(h.transport.openEvents).toHaveBeenCalledTimes(1);
    expect(h.monitor.snapshot().stream).toBe('stopped');
  });

  it('identity/protocol failure halts instead of reconnecting to a replacement daemon', async () => {
    const h = harness();
    vi.mocked(h.transport.getRun).mockRejectedValue(new DaemonApiError('identity', 'changed'));
    await h.monitor.start();
    expect(h.monitor.snapshot().stream).toBe('error');
    expect(h.transport.openEvents).not.toHaveBeenCalled();
  });
});

const existingId = '11111111-1111-1111-1111-111111111111';
const submittedId = '22222222-2222-2222-2222-222222222222';

function run(runId: string, state: RunView['state']): RunView {
  return {
    plan_id: runId,
    run_id: runId,
    request_id: runId,
    backend: 'local',
    operation: 'train',
    attempt: 1,
    state,
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
  };
}

describe('kept-alive experiments list', () => {
  beforeEach(() => {
    vi.stubGlobal('computed', computed);
    vi.stubGlobal('shallowRef', shallowRef);
    vi.stubGlobal('watch', watch);
    vi.stubGlobal('onScopeDispose', onScopeDispose);
    vi.stubGlobal('useIntervalFn', useIntervalFn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['empty', 'completed', 'running'])(
    'loads a submitted run on return to a recently refreshed %s list',
    async (initial) => {
      let available =
        initial === 'empty'
          ? []
          : [run(existingId, initial === 'completed' ? 'completed' : 'running')];

      const api = new DaemonApi('http://127.0.0.1:8765', {}, async (input, init) => {
        const url = new URL(String(input));
        const headers = { 'Content-Type': 'application/json' };

        if (url.pathname === '/api/health')
          return new Response(
            JSON.stringify({
              daemon_id: 'daemon-one',
              build_id: 'build-one',
              protocol_min: 1,
              protocol_max: 1,
            }),
            { headers },
          );

        if (url.pathname === `/api/runs/${submittedId}/events`)
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          );

        if (url.pathname === `/api/runs/${submittedId}`)
          return new Response(JSON.stringify(run(submittedId, 'running')), { headers });

        if (url.pathname === '/api/runs')
          return new Response(JSON.stringify({ runs: available }), { headers });

        throw new Error(`Unexpected request: ${url.pathname}`);
      });

      api.setToken('test-session');
      const scope = effectScope();

      const runs = scope.run(() =>
        useRuns(
          api,
          (error) => {
            throw error;
          },
          true,
        ),
      );

      if (!runs) throw new Error('Missing runs scope');

      try {
        runs.resume();
        await vi.waitFor(() => expect(runs.loading.value).toBe(false));
        expect(runs.message.value).toBe('');
        expect(runs.runs.value.map((item) => item.run_id)).toEqual(
          initial === 'empty' ? [] : [existingId],
        );

        runs.pause();
        available = [...available, run(submittedId, 'running')];
        runs.select(submittedId);
        expect(runs.selected.value?.run).toBeNull();
        runs.resume();
        await vi.waitFor(() => expect(runs.loading.value).toBe(false));
        await vi.waitFor(() => expect(runs.selected.value?.freshness).toBe('fresh'));

        expect(runs.runs.value.map((item) => item.run_id)).toEqual(
          initial === 'empty' ? [submittedId] : [existingId, submittedId],
        );
        expect(runs.selected.value?.run?.run_id).toBe(submittedId);
      } finally {
        scope.stop();
      }
    },
  );
});

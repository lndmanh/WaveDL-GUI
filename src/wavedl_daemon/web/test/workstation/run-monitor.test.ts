import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRequestCancellation, RunMonitor, type RunTransport } from '../../app/lib/run-monitor';
import { DaemonApiError, type RunView } from '../../app/lib/daemon-api';
import { CursorStore } from '../../app/lib/event-stream';

const id = '11111111-1111-1111-1111-111111111111';

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

function frame(seq: number, type = 'log', attempt = 1): Uint8Array {
  return new TextEncoder().encode(
    `id: ${attempt}:${seq}\ndata: ${JSON.stringify({ protocol: 'wavedl-jsonl', version: 1, run_id: id, attempt, seq, type, ts: '2026-10-07T00:00:00Z', payload: { message: '<script>never HTML</script>' } })}\n\n`,
  );
}

function harness(initial = view(), store: CursorStore | null = null) {
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
  const monitor = new RunMonitor(id, transport, 100, reportFailure, store);

  return {
    monitor,
    reportFailure,
    transport,
    set: (run: RunView) => {
      current = run;
    },
    send: (seq: number, type?: string, attempt?: number) =>
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
  it.each([{ restart_count: 0 }, { owner: 'other' }, { job_id: '13' }, { cluster: 'other' }])(
    'rejects changed native ownership or generation %j',
    async (patch) => {
      vi.useFakeTimers();

      const identity = {
        run_id: id,
        request_id: id,
        cluster: 'test',
        job_id: '12',
        owner: 'tester',
        restart_count: 1,
      };

      const h = harness(view({ evidence: { native_pending: true, native_identity: identity } }));
      const task = h.monitor.start();
      await flush();
      h.set(
        view({ evidence: { native_pending: true, native_identity: { ...identity, ...patch } } }),
      );
      await vi.advanceTimersByTimeAsync(100);
      await task;
      expect(h.reportFailure).toHaveBeenCalledTimes(1);
      expect(h.monitor.snapshot().stream).toBe('error');
    },
  );
  it.each([
    { attempt: null },
    { attempt: 0 },
    { plan_id: '22222222-2222-2222-2222-222222222222' },
    { request_id: '22222222-2222-2222-2222-222222222222' },
    { backend: 'local' },
    { operation: 'plot' as const },
    { evidence: { native_pending: 'yes' } },
    { evidence: { native_pending: true, native_identity: null } },
    {
      evidence: {
        native_identity: {
          run_id: id,
          request_id: '22222222-2222-2222-2222-222222222222',
          cluster: 'test',
          job_id: '12',
          owner: 'tester',
          restart_count: 0,
        },
      },
    },
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
  it('aborts within an already-read chunk without persisting undisplayed frames', async () => {
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

    for (let i = 0; i < 10000 && h.monitor.snapshot().events.at(-1)?.seq !== 1009; i++)
      await Promise.resolve();
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
    h.send(0, 'exit');
    await flush();
    expect(h.monitor.snapshot().run?.state).toBe('held');
    expect(h.monitor.snapshot().run?.uncertainty).toBe(true);
    h.monitor.stop();
    await task;
  });
  it('fences old runtime events while native generation is pending and preserves diagnostics', async () => {
    vi.useFakeTimers();
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.send(0);
    await flush();
    expect(h.monitor.snapshot().liveEvents).toHaveLength(1);
    h.set(
      view({
        evidence: {
          native_pending: true,
          native_identity: {
            run_id: id,
            request_id: id,
            cluster: 'test',
            job_id: '12',
            owner: 'tester',
            restart_count: 1,
          },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    h.send(1);
    await flush();
    expect(h.monitor.snapshot().liveEvents).toHaveLength(0);
    expect(h.monitor.snapshot().events).toHaveLength(2);
    h.set(
      view({
        attempt: 2,
        evidence: {
          native_pending: false,
          native_identity: {
            run_id: id,
            request_id: id,
            cluster: 'test',
            job_id: '12',
            owner: 'tester',
            restart_count: 1,
          },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    h.send(0, 'hello', 2);
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
  it('keeps uncertain supervision loss and native-pending runs cancellable', () => {
    expect(
      canRequestCancellation(view({ state: 'supervision_lost', uncertainty: true }), 'idle'),
    ).toBe(true);
    expect(
      canRequestCancellation(
        view({
          attempt: null,
          uncertainty: true,
          evidence: {
            native_pending: true,
            native_identity: {
              run_id: id,
              request_id: id,
              cluster: 'qa',
              job_id: '12',
              owner: 'tester',
              restart_count: 1,
            },
          },
        }),
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
  it.each(['cluster', 'job_id', 'owner'] as const)(
    'rejects a deferred foreign native %s cancellation response after a newer poll',
    async (field) => {
      vi.useFakeTimers();

      const identity = {
        run_id: id,
        request_id: id,
        cluster: 'test',
        job_id: '12',
        owner: 'tester',
        restart_count: 0,
      };

      const h = harness(view({ evidence: { native_identity: identity } }));
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

      const newer = view({
        attempt: 2,
        evidence: { native_identity: { ...identity, restart_count: 1 } },
      });

      h.set(newer);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.monitor.snapshot().run).toEqual(newer);
      resolve(
        view({
          cancellation_requested: true,
          state: 'cancelled',
          evidence: {
            native_identity: { ...identity, [field]: field === 'job_id' ? '13' : 'foreign' },
          },
        }),
      );
      await cancellation;
      expect(h.reportFailure).toHaveBeenCalledTimes(1);
      expect(h.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'identity' }));
      expect(h.monitor.snapshot().cancellation).toBe('unknown');
      expect(h.monitor.snapshot().run).toEqual(newer);
      await task;
    },
  );
  it.each(['older-generation', 'formerly-unbound'] as const)(
    'accepts a deferred %s cancellation acknowledgement without replacing a newer native head',
    async (outcome) => {
      vi.useFakeTimers();

      const identity = {
        run_id: id,
        request_id: id,
        cluster: 'test',
        job_id: '12',
        owner: 'tester',
        restart_count: 0,
      };

      const olderEvidence = outcome === 'older-generation' ? { native_identity: identity } : null;
      const h = harness(view({ evidence: olderEvidence }));
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

      const newer = view({
        attempt: 2,
        evidence: { native_identity: { ...identity, restart_count: 1 } },
      });

      h.set(newer);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.monitor.snapshot().run).toEqual(newer);
      expect(h.monitor.snapshot().cancellation).toBe('sending');
      resolve(view({ cancellation_requested: true, state: 'stopping', evidence: olderEvidence }));
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
    },
  );
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
  it('replays from zero while consuming and verifying the persisted watermark', async () => {
    vi.useFakeTimers();
    const values = new Map<string, string>();

    const store = new CursorStore(id, id, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });

    store.save({ attempt: 1, seq: 0 });
    const h = harness(view(), store);
    const task = h.monitor.start();
    await flush();
    expect(h.transport.openEvents).toHaveBeenCalledWith(
      id,
      { attempt: 0, seq: -1 },
      expect.anything(),
    );
    expect(h.monitor.replayTargetStatus()).toBe('pending');
    h.send(0);
    await flush();
    expect(h.monitor.replayTargetStatus()).toBe('verified');
    h.monitor.stop();
    await task;
    expect(store.load()).toEqual({ attempt: 1, seq: 0 });
  });
  it('reconstructs checkpoint supersession and logs before verifying a cold watermark', async () => {
    vi.useFakeTimers();
    let saved = JSON.stringify({ attempt: 2, seq: 1 });

    const store = new CursorStore('daemon-a', id, {
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    });

    const h = harness(view({ attempt: 2 }), store);
    const task = h.monitor.start();
    await flush();

    const send = (attempt: number, seq: number, type: string, payload: object) => {
      h.raw(
        `id: ${attempt}:${seq}\ndata: ${JSON.stringify({ protocol: 'wavedl-jsonl', version: 1, run_id: id, attempt, seq, type, ts: '2026-10-07T00:00:00Z', payload })}\n\n`,
      );
    };

    send(1, 0, 'hello', {});
    send(1, 1, 'metric', { name: 'loss', value: 4, step: 1 });
    send(1, 2, 'metric', { name: 'loss', value: 2, step: 2 });
    send(2, 0, 'supersede', { source_attempt: 1, step: 1, generation: 'checkpoint-a' });
    send(2, 1, 'metric', { name: 'loss', value: 3, step: 2 });

    for (let i = 0; i < 20; i++) await flush();
    expect(h.monitor.replayTargetStatus()).toBe('verified');
    expect(h.monitor.snapshot().metrics.map((record) => record.value)).toEqual([4, 3]);
    expect(h.monitor.snapshot().events).toHaveLength(5);
    expect(h.transport.openEvents).toHaveBeenCalledWith(
      id,
      { attempt: 0, seq: -1 },
      expect.anything(),
    );
    h.monitor.stop();
    await task;
    expect(JSON.parse(saved)).toEqual({ attempt: 2, seq: 1 });
  });
  it('verifies a historical watermark even when fresh authority selects a newer attempt', async () => {
    const store = new CursorStore('daemon-a', id, {
      getItem: () => JSON.stringify({ attempt: 1, seq: 0 }),
      setItem: () => undefined,
    });

    const h = harness(view({ attempt: 2 }), store);
    const task = h.monitor.start();
    await flush();
    expect(h.monitor.replayTargetStatus()).toBe('pending');
    h.send(0);
    await flush();
    expect(h.monitor.replayTargetStatus()).toBe('verified');
    expect(h.monitor.snapshot().run?.attempt).toBe(2);
    expect(h.monitor.snapshot().liveEvents).toEqual([]);
    h.monitor.stop();
    await task;
  });
  it.each([
    ['malformed', '{bad-json', 'invalidated'],
    ['ahead attempt', JSON.stringify({ attempt: 2, seq: 9 }), 'invalidated'],
    ['ahead seq', JSON.stringify({ attempt: 1, seq: 999 }), 'pending'],
    ['absent sparse event', JSON.stringify({ attempt: 1, seq: 1 }), 'invalidated'],
  ])(
    'never skips replay or withholds fresh authority for a %s hint',
    async (_label, raw, status) => {
      const store = new CursorStore('daemon-a', id, {
        getItem: () => raw,
        setItem: () => undefined,
      });

      const h = harness(view(), store);
      const task = h.monitor.start();
      await flush();
      h.send(2);
      await flush();
      expect(h.monitor.replayTargetStatus()).toBe(status);
      expect(h.monitor.snapshot().freshness).toBe('fresh');
      expect(h.monitor.snapshot().events).toHaveLength(1);
      expect(h.monitor.position()).toEqual({ attempt: 1, seq: 2 });
      h.monitor.stop();
      await task;
    },
  );
  it('coalesces persistence and never stores event payloads or control cursors', async () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    const store = new CursorStore('daemon-a', id, { getItem: () => null, setItem });
    const h = harness(view(), store);
    const task = h.monitor.start();
    await flush();
    h.sendCombined();
    await flush();
    expect(setItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenLastCalledWith(store.key, JSON.stringify({ attempt: 1, seq: 1 }));
    h.raw('event: overflow\ndata: {"resumePosition":{"attempt":1,"seq":1}}\n\n');
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(setItem).toHaveBeenCalledTimes(1);
    h.monitor.stop();
    await task;
  });
  it('reports storage denial without stopping safe in-memory monitoring', async () => {
    const store = new CursorStore('daemon-a', id, {
      getItem: () => {
        throw new Error('private storage body');
      },
      setItem: () => {
        throw new Error('private storage body');
      },
    });

    const h = harness(view(), store);
    const task = h.monitor.start();
    await flush();
    expect(h.monitor.cursorPersistence()).toBe('unavailable');
    h.send(2);
    await flush();
    expect(h.monitor.position()).toEqual({ attempt: 1, seq: 2 });
    expect(h.monitor.snapshot().stream).toBe('live');
    expect(h.monitor.snapshot().message).not.toContain('private');
    h.monitor.stop();
    await task;
    expect(h.monitor.cursorPersistence()).toBe('unavailable');
  });
  it('does not load private cursor state before fresh authentication and ownership', async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const store = new CursorStore('daemon-a', id, { getItem, setItem });
    const h = harness(view(), store);
    vi.mocked(h.transport.getRun).mockRejectedValue(
      new DaemonApiError('authentication', 'Sign in'),
    );
    await h.monitor.start();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
  it('does not persist a failed consumer commit or a pending cursor after fatal retirement', async () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    const store = new CursorStore('daemon-a', id, { getItem: () => null, setItem });
    const h = harness(view(), store);
    const task = h.monitor.start();
    await flush();
    h.send(0);
    h.send(1, 'metric'); // malformed metric payload throws before apply/cursor commit
    await flush();
    await task;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.monitor.position()).toEqual({ attempt: 1, seq: 0 });
    expect(setItem).not.toHaveBeenCalled();
    h.monitor.stop();
    expect(setItem).not.toHaveBeenCalled();
  });
  it('confirmed terminal lifecycle after EOF stops; exit alone does not', async () => {
    const h = harness();
    const task = h.monitor.start();
    await flush();
    h.send(0, 'exit');
    await flush();
    expect(h.monitor.snapshot().stream).toBe('live');
    h.set(view({ state: 'completed' }));
    h.end();
    await task;
    expect(h.monitor.snapshot().run?.state).toBe('completed');
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

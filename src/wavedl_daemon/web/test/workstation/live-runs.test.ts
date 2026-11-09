import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_RUNS_LIMIT,
  LIVE_POLL_ACTIVE_MS,
  LIVE_POLL_IDLE_MS,
  LIVE_POLL_MAX_MS,
  LiveRunsPoller,
  liveCountLabel,
  liveRunsSignature,
  orderActiveRuns,
} from '../../app/lib/live-runs';
import { isLiveRun } from '../../app/lib/run-overview';
import { RUN_STATES } from '../../shared/schemas/daemon-api';
import type { RunView } from '../../types/daemon-api';

// The existing run-monitor view fixture is private to its test module.
const running: RunView = {
  plan_id: '11111111-1111-1111-1111-111111111111',
  run_id: '11111111-1111-1111-1111-111111111111',
  request_id: '11111111-1111-1111-1111-111111111111',
  backend: 'slurm',
  operation: 'train',
  attempt: 1,
  state: 'running',
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: null,
};

function harness() {
  const requests: {
    signal: AbortSignal;
    resolve(runs: RunView[]): void;
    reject(error: Error): void;
  }[] = [];

  const list = vi.fn(
    (signal: AbortSignal) => new Promise<RunView[]>((resolve, reject) => {
      requests.push({ signal, resolve, reject });
    }),
  );

  const onChange = vi.fn();
  const onError = vi.fn();
  const poller = new LiveRunsPoller({ list, onChange, onError });

  function request(index: number) {
    const value = requests[index];

    if (!value) throw new Error(`Missing request ${index}`);

    return value;
  }

  async function settle(index: number, runs: RunView[] = [running]) {
    request(index).resolve(runs);
    await vi.advanceTimersByTimeAsync(0);
  }

  return { poller, list, onChange, onError, request, settle };
}

describe('LiveRunsPoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the specified limits and intervals', () => {
    expect(LIVE_RUNS_LIMIT).toBe(100);
    expect(LIVE_POLL_ACTIVE_MS).toBe(10_000);
    expect(LIVE_POLL_IDLE_MS).toBe(60_000);
    expect(LIVE_POLL_MAX_MS).toBe(120_000);
  });

  it('polls immediately on start and every 10 s while runs are live', async () => {
    const h = harness();
    h.poller.start();
    h.poller.start();
    expect(h.list).toHaveBeenCalledTimes(1);
    await h.settle(0);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.list).toHaveBeenCalledTimes(2);
    await h.settle(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.list).toHaveBeenCalledTimes(3);
    h.poller.stop();
  });

  it('polls every 60 s when nothing is live and switches back to 10 s', async () => {
    const h = harness();
    h.poller.start();
    await h.settle(0, []);
    expect(h.onChange).toHaveBeenCalledWith({ runs: [], truncated: false });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(h.list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await h.settle(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.list).toHaveBeenCalledTimes(3);
    h.poller.stop();
  });

  it.each(['success', 'failure'])('queues one refresh until an in-flight %s settles', async (outcome) => {
    const h = harness();
    h.poller.start();
    h.poller.refresh();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.list).toHaveBeenCalledTimes(1);

    if (outcome === 'success') await h.settle(0);
    else {
      h.request(0).reject(new Error('offline'));
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(h.list).toHaveBeenCalledTimes(2);
    await h.settle(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.list).toHaveBeenCalledTimes(3);
    h.poller.stop();
  });

  it('collapses multiple in-flight refreshes into one follow-up request', async () => {
    const h = harness();
    h.poller.start();
    h.poller.refresh();
    h.poller.refresh();
    h.poller.refresh();
    expect(h.list).toHaveBeenCalledTimes(1);
    await h.settle(0);
    expect(h.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.list).toHaveBeenCalledTimes(2);
    await h.settle(1);
    expect(h.list).toHaveBeenCalledTimes(2);
    h.poller.stop();
  });

  it('stop discards a pending refresh, including after a restart', async () => {
    const h = harness();
    h.poller.start();
    h.poller.refresh();
    h.poller.stop();
    await h.settle(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.list).toHaveBeenCalledTimes(1);
    h.poller.start();
    await h.settle(1);
    expect(h.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.list).toHaveBeenCalledTimes(3);
    h.poller.stop();
  });

  it('refresh replaces the scheduled timer and reschedules after settling', async () => {
    const h = harness();
    h.poller.start();
    await h.settle(0);
    await vi.advanceTimersByTimeAsync(5_000);
    h.poller.refresh();
    expect(h.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(h.list).toHaveBeenCalledTimes(2);
    await h.settle(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.list).toHaveBeenCalledTimes(3);
    h.poller.stop();
  });

  it('stop aborts the in-flight request and never calls onChange afterwards', async () => {
    const h = harness();
    h.poller.start();
    const signal = h.request(0).signal;
    expect(signal.aborted).toBe(false);
    h.poller.stop();
    expect(signal.aborted).toBe(true);
    await h.settle(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('swallows rejection after stop and clears scheduled polling', async () => {
    const h = harness();
    h.poller.start();
    h.poller.stop();
    h.request(0).reject(new Error('aborted'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onError).not.toHaveBeenCalled();
    h.poller.start();
    await h.settle(1);
    h.poller.stop();
    h.poller.refresh();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it('defers restart until asynchronous abort settlement with at most one unsettled request', async () => {
    let unsettled = 0;
    let maximumUnsettled = 0;

    const list = vi.fn((signal: AbortSignal) => {
      unsettled++;
      maximumUnsettled = Math.max(maximumUnsettled, unsettled);

      return new Promise<RunView[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          void Promise.resolve().then(() => reject(new Error('aborted')));
        }, { once: true });
      }).finally(() => {
        unsettled--;
      });
    });

    const onChange = vi.fn();
    const onError = vi.fn();
    const poller = new LiveRunsPoller({ list, onChange, onError });
    poller.start();
    poller.stop();
    poller.start();
    expect(list).toHaveBeenCalledTimes(1);
    expect(unsettled).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(2);
    expect(maximumUnsettled).toBe(1);
    expect(unsettled).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    poller.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(unsettled).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('publishes an identical snapshot again after stop and restart', async () => {
    const h = harness();
    h.poller.start();
    await h.settle(0);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    h.poller.stop();
    h.poller.start();
    await h.settle(1, [{ ...running }]);
    expect(h.onChange).toHaveBeenCalledTimes(2);
    expect(h.onChange).toHaveBeenLastCalledWith({ runs: [running], truncated: false });
    h.poller.stop();
  });

  it.each(['success', 'failure'])(
    'ignores stale %s after stop and restart without disturbing the new request',
    async (outcome) => {
      const h = harness();
      h.poller.start();
      h.poller.stop();
      h.poller.start();
      expect(h.list).toHaveBeenCalledTimes(1);

      if (outcome === 'success') await h.settle(0);
      else {
        h.request(0).reject(new Error('stale failure'));
        await vi.advanceTimersByTimeAsync(0);
      }

      h.poller.refresh();
      expect(h.onChange).not.toHaveBeenCalled();
      expect(h.onError).not.toHaveBeenCalled();
      expect(h.list).toHaveBeenCalledTimes(2);
      await h.settle(1);
      expect(h.onChange).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.list).toHaveBeenCalledTimes(3);
      h.poller.stop();
    },
  );

  it('backs off 20 s, 40 s, 80 s, 120 s, 120 s on failures and resets after a success', async () => {
    const h = harness();
    h.poller.start();
    await h.settle(0);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = new Error('offline');
    const delays = [20_000, 40_000, 80_000, 120_000, 120_000];

    for (const [index, delay] of delays.entries()) {
      h.request(index + 1).reject(error);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.onError).toHaveBeenLastCalledWith(error);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.list).toHaveBeenCalledTimes(index + 2);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.list).toHaveBeenCalledTimes(index + 3);
    }

    expect(h.onError).toHaveBeenCalledTimes(5);
    await h.settle(6);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.list).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.list).toHaveBeenCalledTimes(8);
    h.poller.stop();
  });

  it('backs off from the idle interval and restores idle polling after success', async () => {
    const h = harness();
    h.poller.start();
    await h.settle(0, []);
    await vi.advanceTimersByTimeAsync(60_000);
    h.request(1).reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(119_999);
    expect(h.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await h.settle(2, []);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.list).toHaveBeenCalledTimes(4);
    h.poller.stop();
  });

  it('combines the stop signal with a 15 s timeout and reports timeout failures', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const h = harness();
    h.poller.start();
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    timeout.abort(new Error('timeout'));
    expect(h.request(0).signal.aborted).toBe(true);
    h.request(0).reject(timeout.signal.reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onError).toHaveBeenCalledWith(timeout.signal.reason);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.list).toHaveBeenCalledTimes(2);
    h.poller.stop();
  });

  it('does not call onChange when the signature is unchanged and publishes an advancing epoch', async () => {
    const h = harness();
    const run: RunView = { ...running, progress: { epoch: 1, totalEpochs: 10, fraction: 0.1 } };
    h.poller.start();
    await h.settle(0, [run]);
    h.poller.refresh();
    await h.settle(1, [{ ...run }]);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    h.poller.refresh();
    await h.settle(2, [{ ...run, progress: { epoch: 2, totalEpochs: 10, fraction: 0.2 } }]);
    expect(h.onChange).toHaveBeenCalledTimes(2);
    h.poller.stop();
  });

  it('marks the snapshot truncated when the daemon returns 100 runs', async () => {
    const h = harness();

    const runs = Array.from({ length: 100 }, (_, index) => ({
      ...running,
      run_id: `run-${index}`,
    }));

    h.poller.start();
    await h.settle(0, runs);
    expect(h.onChange).toHaveBeenLastCalledWith({ runs, truncated: true });
    h.poller.refresh();
    await h.settle(1, runs.slice(1));
    expect(h.onChange).toHaveBeenLastCalledWith({ runs: runs.slice(1), truncated: false });
    h.poller.stop();
  });

  it('publishes runs in active priority order', async () => {
    const h = harness();
    const queued: RunView = { ...running, run_id: 'queued', state: 'queued' };
    h.poller.start();
    await h.settle(0, [queued, running]);
    expect(h.onChange).toHaveBeenCalledWith({ runs: [running, queued], truncated: false });
    h.poller.stop();
  });
});

describe('live run projections', () => {
  it.each([
    { count: 0, truncated: false, expected: undefined },
    { count: 0, truncated: true, expected: undefined },
    { count: 1, truncated: false, expected: '1' },
    { count: 99, truncated: false, expected: '99' },
    { count: 100, truncated: false, expected: '100' },
    { count: 100, truncated: true, expected: '99+' },
  ])('labels count $count with truncated=$truncated', ({ count, truncated, expected }) => {
    expect(liveCountLabel(count, truncated)).toBe(expected);
  });

  it('orders running and stopping runs first, keeping server order otherwise', () => {
    const states: RunView['state'][] = [
      'queued', 'stopping', 'running', 'held', 'running', 'stopping', 'pending',
    ];

    const runs = states.map((state, index) => ({ ...running, run_id: String(index), state }));
    const original = [...runs];
    expect(orderActiveRuns(runs).map((run) => run.run_id)).toEqual([
      '2', '4', '1', '5', '0', '3', '6',
    ]);
    expect(runs).toEqual(original);
    expect(orderActiveRuns([])).toEqual([]);
  });

  it('signs only run_id, state, activity and progress epoch, preserving order', () => {
    const run: RunView = {
      ...running,
      activity: 'training',
      progress: { epoch: 1, totalEpochs: 10, fraction: 0.1 },
    };

    const signature = liveRunsSignature([run]);
    expect(liveRunsSignature([{
      ...run,
      attempt: 2,
      progress: { epoch: 1, totalEpochs: 20, fraction: 0.5 },
    }])).toBe(signature);
    expect(liveRunsSignature([{ ...run, run_id: 'other' }])).not.toBe(signature);
    expect(liveRunsSignature([{ ...run, state: 'stopping' }])).not.toBe(signature);
    expect(liveRunsSignature([{ ...run, activity: 'finalizing' }])).not.toBe(signature);
    expect(liveRunsSignature([{
      ...run,
      progress: { epoch: 2, totalEpochs: 10, fraction: 0.2 },
    }])).not.toBe(signature);
    const other: RunView = { ...run, run_id: 'other' };
    expect(liveRunsSignature([run, other])).not.toBe(liveRunsSignature([other, run]));
  });

  it('handles null or missing progress in signatures', () => {
    expect(liveRunsSignature([{ ...running, progress: null }])).toBe(liveRunsSignature([running]));
    expect(liveRunsSignature([])).not.toBe(liveRunsSignature([running]));
  });

  it('isLiveRun matches exactly pending, submitted, queued, held, running, stopping', () => {
    const live = new Set(['pending', 'submitted', 'queued', 'held', 'running', 'stopping']);

    for (const state of RUN_STATES) {
      expect(isLiveRun({ ...running, state }), state).toBe(live.has(state));
    }
  });
});

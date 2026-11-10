import { describe, expect, it, vi } from 'vitest';
import { DaemonApi } from '../../app/lib/daemon-api';
import { runMonitorTransport } from '../../app/lib/run-monitor-transport';

const id = '11111111-1111-1111-1111-111111111111';

describe('runMonitorTransport', () => {
  it('bounds authority reads and cancellation to 15 seconds while retaining caller cancellation', async () => {
    const api = new DaemonApi('http://localhost');
    const getRun = vi.spyOn(api, 'getRun').mockImplementation(async () => { throw new Error('read'); });
    const cancelRun = vi.spyOn(api, 'cancelRun').mockImplementation(async () => { throw new Error('cancel'); });
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const transport = runMonitorTransport(api);
    const controller = new AbortController();

    try {
      await expect(transport.getRun(id, controller.signal)).rejects.toThrow('read');
      await expect(transport.cancelRun(id, controller.signal)).rejects.toThrow('cancel');
      expect(timeoutSpy.mock.calls).toEqual([[15000], [15000]]);
      const readSignal = getRun.mock.calls[0]?.[1];
      const cancelSignal = cancelRun.mock.calls[0]?.[1];
      expect(readSignal?.aborted).toBe(false);
      expect(cancelSignal?.aborted).toBe(false);
      timeout.abort();
      expect(readSignal?.aborted).toBe(true);
      expect(cancelSignal?.aborted).toBe(true);

      const caller = new AbortController();
      timeoutSpy.mockReturnValue(new AbortController().signal);
      await expect(transport.cancelRun(id, caller.signal)).rejects.toThrow('cancel');
      caller.abort();
      expect(cancelRun.mock.calls[1]?.[1]?.aborted).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('pins event requests to the daemon identity captured when the monitor was created', async () => {
    const api = new DaemonApi('http://localhost', { daemonId: id });
    const openEvents = vi.spyOn(api, 'openEvents').mockResolvedValue(new Response());
    const getEventPage = vi.spyOn(api, 'getEventPage').mockResolvedValue({ events: [], next_cursor: { attempt: 1, seq: 0 }, more: false });
    const transport = runMonitorTransport(api);
    vi.spyOn(api, 'daemonId', 'get').mockReturnValue('22222222-2222-2222-2222-222222222222');
    const controller = new AbortController();
    const cursor = { attempt: 0, seq: -1 };

    try {
      await transport.openEvents(id, cursor, controller.signal);
      await transport.getEventPage?.(id, cursor, controller.signal);
      expect(openEvents).toHaveBeenCalledWith(id, cursor, controller.signal, id);
      expect(getEventPage).toHaveBeenCalledWith(id, cursor, controller.signal, id);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

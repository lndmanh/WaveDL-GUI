import type { DaemonApi } from './daemon-api';
import type { RunTransport } from '~~/types/run-monitor';

/** Keep monitor authority reads, cancellation deadlines and event identity pins identical. */
export function runMonitorTransport(api: DaemonApi): RunTransport {
  const daemonId = api.daemonId;

  return {
    getRun: (id, signal) =>
      api.getRun(id, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
    openEvents: (id, cursor, signal) => api.openEvents(id, cursor, signal, daemonId),
    getEventPage: (id, cursor, signal) => api.getEventPage(id, cursor, signal, daemonId),
    cancelRun: (id, signal) =>
      api.cancelRun(id, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
  };
}

import { runClone } from '../lib/run-clone';
import type { PlanView } from '~~/types/daemon-api';
import type { PendingRunClone } from '~~/types/run-clone';

/** Explicit one-shot handoff to /new, scoped to the daemon that owns the stored plan. */
export function useRunClone() {
  const pending = useState<PendingRunClone | null>('pending-run-clone', () => null);

  function prepare(plan: PlanView, daemonId: string): boolean {
    const value = runClone(plan, daemonId);

    if (!value) return false;
    pending.value = value;

    return true;
  }

  function consume(daemonId: string): PendingRunClone | null {
    const value = pending.value;
    pending.value = null;

    return value?.draft.daemonId === daemonId ? value : null;
  }

  function clear() {
    pending.value = null;
  }

  return { pending: shallowReadonly(pending), prepare, consume, clear };
}

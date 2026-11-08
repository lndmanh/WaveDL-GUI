import { unbindProjectDraft } from '../lib/project-draft';

/** Draft association only; a stored run ID never conveys approval to submit. */
export function usePlannedRunBinding() {
  const state = useState<{ daemonId: string; runId: string } | null>(
    'project-planned-run-binding',
    () => null,
  );

  const retired = useState<{ daemonId: string; runId: string } | null>(
    'retired-project-planned-run',
    () => null,
  );

  function runId(daemonId: string | null): string | null {
    return state.value?.daemonId === daemonId ? state.value.runId : null;
  }

  function bind(daemonId: string, id: string | null) {
    state.value = id ? { daemonId, runId: id } : null;
  }

  function unbind(daemonId: string, id: string) {
    if (runId(daemonId) === id) state.value = null;
    unbindProjectDraft(daemonId, id);
    retired.value = { daemonId, runId: id };
  }

  return { state: shallowReadonly(state), retired: shallowReadonly(retired), runId, bind, unbind };
}

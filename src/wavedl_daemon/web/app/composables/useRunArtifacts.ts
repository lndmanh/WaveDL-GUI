import type { ConnectionSession } from '../lib/connection-session';
import { ArtifactClient } from '../lib/artifact-client';
import { artifactDownloadName } from '../lib/artifact-download';
import type { Artifact, Inventory } from '~~/types/artifact-client';

export type RunArtifacts = ReturnType<typeof useRunArtifacts>;

/** Keep verified artifact reads scoped to the selected run and connected daemon. */
export function useRunArtifacts(
  owner: MaybeRefOrGetter<ConnectionSession>,
  runId: MaybeRefOrGetter<string | null>,
  active: MaybeRefOrGetter<boolean> = true,
) {
  const session = computed(() => toRaw(toValue(owner)));
  const connected = shallowRef(false);
  const scopeGeneration = shallowRef(0);
  const emptyInventory: Inventory = { files: [], checkpoints: [] };
  const inventory = shallowRef<Inventory>(emptyInventory);
  const busy = shallowRef(false);
  // Only the first read per run and connection loads on its own; later reads wait for Refresh.
  const loaded = shallowRef(false);
  const message = shallowRef('');
  const downloadStatus = shallowRef('');
  const { isActive } = usePageActive();
  const resourceActive = computed(() => isActive.value && toValue(active));
  let scope = new AbortController();
  let epoch = 0;

  function cancel() {
    scope.abort();
    scope = new AbortController();
    epoch++;
    busy.value = false;
  }

  function reset() {
    cancel();
    scopeGeneration.value++;
    inventory.value = emptyInventory;
    loaded.value = false;
    message.value = '';
    downloadStatus.value = '';
  }

  watch(
    session,
    (current, _prior, onCleanup) => {
      reset();
      let active = true;
      let revision = current.snapshot().revision;

      const unsubscribe = current.subscribe((state) => {
        if (!active || current !== session.value) return;
        connected.value = state.status === 'connected';

        if (state.status !== 'connected' || revision !== state.revision) reset();
        revision = state.revision;
      });

      onCleanup(() => {
        active = false;
        unsubscribe();
      });
    },
    { immediate: true, flush: 'sync' },
  );

  watch(() => toValue(runId), reset, { flush: 'sync' });

  async function refresh() {
    const id = toValue(runId);

    if (!id || !connected.value || !resourceActive.value || busy.value) return;
    const current = epoch;
    busy.value = true;
    message.value = '';

    try {
      const items = await new ArtifactClient(session.value).list(id, scope.signal);

      if (current === epoch) {
        inventory.value = items;
        loaded.value = true;
      }
    } catch {
      if (current === epoch) message.value = 'results.artifactsFailed';
    } finally {
      if (current === epoch) busy.value = false;
    }
  }

  async function consume(artifact: Artifact) {
    if (busy.value || !connected.value || !resourceActive.value) return;
    const current = epoch;
    busy.value = true;
    message.value = '';

    try {
      const blob = await new ArtifactClient(session.value).verifiedBlob(artifact, scope.signal);

      if (current !== epoch) return;
      const name = await artifactDownloadName(artifact, inventory.value.files);

      if (current !== epoch) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      downloadStatus.value = 'results.downloadRequested';
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (current === epoch)
        message.value =
          artifact.size > 64 * 1024 * 1024 ? 'results.budget' : 'results.verificationFailed';
    } finally {
      if (current === epoch) busy.value = false;
    }
  }

  watch(
    resourceActive,
    (active) => {
      if (!active) cancel();
    },
    { flush: 'sync' },
  );

  watch(
    [resourceActive, connected, () => toValue(runId), scopeGeneration],
    () => {
      if (!loaded.value) void refresh();
    },
    { immediate: true },
  );

  onBeforeUnmount(reset);

  return {
    session,
    connected,
    scopeGeneration,
    inventory,
    busy,
    message,
    downloadStatus,
    refresh,
    consume,
  };
}

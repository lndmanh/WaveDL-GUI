import type { DataSelection } from '../lib/catalog-api';
import type { ConnectionSession } from '../lib/connection-session';
import {
  DatasetPreviewApi,
  DatasetPreviewPickleRequiredError,
  type DatasetPreview,
} from '../lib/dataset-preview';

type PreviewMessage =
  | { kind: 'key'; key: string }
  | { kind: 'error'; value: Error }
  | { kind: 'pickle' };

// Trust is browser-memory only and never crosses a connection or daemon identity.
const trustedFiles = new WeakMap<ConnectionSession, Set<string>>();

function fileKey(selection: DataSelection): string {
  return JSON.stringify([selection.daemonId, selection.root, selection.relativePath]);
}

export function useDatasetPreview(
  session: () => ConnectionSession,
  selected: () => DataSelection | null,
) {
  const data = shallowRef<DatasetPreview | null>(null);
  const loading = shallowRef(false);
  const available = shallowRef(false);
  const message = shallowRef<PreviewMessage | null>(null);
  let request: AbortController | null = null;
  let sequence = 0;
  let unsubscribe: (() => void) | null = null;

  function revoke() {
    sequence++;
    request?.abort();
    request = null;
    data.value = null;
    loading.value = false;
  }

  function stop() {
    if (!loading.value) return;
    revoke();
    message.value = { kind: 'key', key: 'datasets.previewStopped' };
  }

  async function load() {
    revoke();
    message.value = null;
    const selection = selected();

    if (!selection) return;

    if (!available.value) {
      message.value = { kind: 'key', key: 'datasets.previewReconnect' };

      return;
    }

    const connection = toRaw(session());
    const controller = new AbortController();
    request = controller;
    const current = sequence;
    loading.value = true;

    try {
      const result = await new DatasetPreviewApi(connection).preview(toRaw(selection), {
        allow_pickle: trustedFiles.get(connection)?.has(fileKey(selection)) ?? false,
        signal: controller.signal,
      });

      if (current === sequence && !controller.signal.aborted) data.value = result;
    } catch (error) {
      if (current === sequence && !controller.signal.aborted)
        message.value =
          error instanceof DatasetPreviewPickleRequiredError
            ? { kind: 'pickle' }
            : error instanceof Error
              ? { kind: 'error', value: error }
              : { kind: 'key', key: 'datasets.previewUnavailable' };
    } finally {
      if (current === sequence) {
        loading.value = false;
        request = null;
      }
    }
  }

  function trust() {
    const selection = selected();

    if (!selection || !available.value || message.value?.kind !== 'pickle') return;
    const connection = toRaw(session());
    const files = trustedFiles.get(connection) ?? new Set<string>();
    files.add(fileKey(selection));
    trustedFiles.set(connection, files);
    void load();
  }

  watch(
    session,
    (current) => {
      unsubscribe?.();
      revoke();
      const connection = toRaw(current);
      let revision = connection.snapshot().revision;
      unsubscribe = connection.subscribe((state) => {
        available.value = state.status === 'connected';

        if (state.revision !== revision || state.status !== 'connected') {
          revision = state.revision;
          revoke();
          message.value = { kind: 'key', key: 'datasets.previewReconnect' };
        }
      });
    },
    { immediate: true },
  );

  watch([selected, session], load, { immediate: true });

  onBeforeUnmount(() => {
    unsubscribe?.();
    revoke();
  });

  return { data, loading, available, message, load, stop, trust };
}

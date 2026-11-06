import { useDocumentVisibility, useTimeoutFn } from '@vueuse/core';
import { DaemonApiError } from '../lib/daemon-api';
import { terminalRun } from '../lib/run-monitor';
import { TrainerOutputBuffer } from '../lib/trainer-output';
import type { RunView } from '~~/types/daemon-api';

const POLL_INTERVAL = 2000;
const MAX_RETRY_INTERVAL = 30_000;

/** Poll only the visible log reader; byte cursors belong to one daemon/run/attempt. */
export function useTrainerOutput(options: {
  run: MaybeRefOrGetter<RunView | null>;
  active: MaybeRefOrGetter<boolean>;
}) {
  const { api, state } = useWorkstation();
  const { isActive } = usePageActive();
  const visibility = useDocumentVisibility();
  const mounted = shallowRef(false);
  const output = shallowRef({ text: '', omitted: false });
  const error = shallowRef<'retrying' | 'missing' | null>(null);
  const delay = shallowRef(POLL_INTERVAL);
  const run = computed(() => toValue(options.run));
  const terminal = computed(() => run.value !== null && terminalRun(run.value));
  const enabled = computed(
    () =>
      mounted.value &&
      isActive.value &&
      toValue(options.active) &&
      visibility.value !== 'hidden' &&
      state.value.status === 'connected' &&
      api.value !== null &&
      run.value !== null,
  );
  let buffer = new TrainerOutputBuffer();
  let offset: number | undefined;
  let controller: AbortController | null = null;
  let failures = 0;
  let drained = false;
  let missing = false;
  const { start, stop } = useTimeoutFn(() => void poll(), delay, { immediate: false });

  function pause(): void {
    stop();
    controller?.abort();
    controller = null;
  }

  function reset(): void {
    pause();
    buffer = new TrainerOutputBuffer();
    output.value = buffer.snapshot();
    offset = undefined;
    error.value = null;
    failures = 0;
    drained = false;
    missing = false;
  }

  async function poll(): Promise<void> {
    const client = api.value;
    const currentRun = run.value;

    if (!enabled.value || !client || !currentRun || controller || missing || drained) return;
    const request = new AbortController();
    controller = request;
    let nextDelay: number | null = null;

    try {
      const chunk = await client.getOutput(
        currentRun.run_id,
        { attempt: currentRun.attempt ?? undefined, offset },
        request.signal,
        state.value.health?.daemon_id,
      );

      if (request.signal.aborted || controller !== request) return;
      const previousOffset = offset;

      // A replaced/truncated output file must not append a new head to old text.
      // Re-tail it rather than skipping the replacement's already-written bytes.
      if (previousOffset !== undefined && chunk.offset < previousOffset) {
        buffer = new TrainerOutputBuffer();
        output.value = buffer.snapshot();
        offset = undefined;
        nextDelay = 0;

        return;
      }

      if (previousOffset === undefined) buffer = new TrainerOutputBuffer(chunk.offset > 0);
      buffer.append(chunk.text);
      output.value = buffer.snapshot();
      offset = chunk.next_offset;
      failures = 0;
      error.value = null;
      drained = terminal.value && chunk.eof;

      if (!drained) {
        // An incomplete live UTF-8 character can report !eof without advancing.
        // Wait for its writer instead of spinning on the same byte cursor.
        const advanced = chunk.next_offset > (previousOffset ?? chunk.offset);
        nextDelay = !chunk.eof && advanced ? 0 : POLL_INTERVAL;
      }
    } catch (cause) {
      if (request.signal.aborted || controller !== request) return;
      missing = cause instanceof DaemonApiError && cause.status === 404;
      error.value = missing ? 'missing' : 'retrying';

      if (!missing) {
        failures++;
        nextDelay = Math.min(MAX_RETRY_INTERVAL, POLL_INTERVAL * 2 ** Math.min(failures - 1, 4));
      }
    } finally {
      if (controller === request) {
        controller = null;

        if (nextDelay !== null && enabled.value) {
          delay.value = nextDelay;
          start();
        }
      }
    }
  }

  watch(
    [() => run.value?.run_id, () => run.value?.attempt, api, () => state.value.health?.daemon_id],
    () => {
      reset();

      if (enabled.value) void poll();
    },
    { immediate: true, flush: 'sync' },
  );
  watch(
    [enabled, terminal],
    () => {
      pause();

      if (!terminal.value) drained = false;

      if (enabled.value) void poll();
    },
    { flush: 'sync' },
  );
  onMounted(() => {
    mounted.value = true;
  });
  onBeforeUnmount(() => {
    mounted.value = false;
    pause();
  });

  return { output: shallowReadonly(output), error: shallowReadonly(error), terminal };
}

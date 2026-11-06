import { useTimeoutFn } from '@vueuse/core';
import type { z } from 'zod';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Validate the current snapshot, never a stale or partially valid form. */
export function useAutosaveForm<T>(options: {
  schema: z.ZodType<T>;
  values: () => unknown;
  save: (value: T) => boolean;
}) {
  const status = shallowRef<AutosaveStatus>('idle');
  let pending = false;

  function persist(): void {
    stop();
    pending = false;
    const parsed = options.schema.safeParse(options.values());

    if (!parsed.success) {
      status.value = 'idle';

      return;
    }

    try {
      status.value = options.save(parsed.data) ? 'saved' : 'error';
    } catch {
      status.value = 'error';
    }
  }

  const { start, stop } = useTimeoutFn(persist, 500, { immediate: false });

  function queue(immediate = false): void {
    stop();
    pending = true;
    status.value = 'saving';

    if (immediate) persist();
    else start();
  }

  function flush(): void {
    if (pending) persist();
  }

  function cancel(): void {
    stop();
    pending = false;
    status.value = 'idle';
  }

  function report(saved: boolean): void {
    cancel();
    status.value = saved ? 'saved' : 'error';
  }

  // A section switch must not discard the last valid edit during its debounce.
  onBeforeUnmount(flush);

  return { status: shallowReadonly(status), queue, flush, cancel, report };
}

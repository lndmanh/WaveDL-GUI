import { useReducedMotion } from 'motion-v';

const FOLD_DURATION = 340;

interface SplitWorkspaceOptions<FocusIntent> {
  width: MaybeRefOrGetter<number>;
  active: MaybeRefOrGetter<boolean>;
  stacked: MaybeRefOrGetter<boolean>;
  folded: MaybeRefOrGetter<boolean>;
  expanded?: MaybeRefOrGetter<boolean>;
  card: () => HTMLElement | null | undefined;
  beforeResizeFrame?: () => void;
  focus: {
    initial: () => FocusIntent | null;
    settle: (intent: FocusIntent) => void;
    clear?: () => void;
    request?: (intent: FocusIntent) => void;
    ready?: () => void;
  };
}

/** Shared fold geometry and cancellable focus work; feature navigation stays with its owner. */
export function useSplitWorkspace<FocusIntent>(options: SplitWorkspaceOptions<FocusIntent>) {
  const reducedMotion = useReducedMotion();
  const entered = shallowRef(false);
  const resizing = shallowRef(false);
  let resizeFrame: number | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingFocus: FocusIntent | null = null;

  const animate = computed(
    () =>
      entered.value &&
      toValue(options.active) &&
      !resizing.value &&
      !toValue(options.stacked) &&
      !reducedMotion.value,
  );

  const paneWidth = computed(() =>
    toValue(options.stacked)
      ? toValue(options.width)
      : Math.round(Math.max(250, toValue(options.width) * 0.3)),
  );

  const cardWidth = computed(() =>
    toValue(options.folded) && !toValue(options.stacked) ? paneWidth.value : toValue(options.width),
  );

  const detailWidth = computed(() =>
    toValue(options.expanded) || toValue(options.stacked)
      ? toValue(options.width)
      : Math.max(0, toValue(options.width) - paneWidth.value - 16),
  );

  const cardTransition = computed(() => ({
    duration: animate.value ? 0.25 : 0,
    delay: animate.value ? 0.09 : 0,
    ease: [0.22, 1, 0.36, 1],
  }));

  const seamTransition = computed(() => ({
    duration: animate.value ? 0.17 : 0,
    delay: animate.value ? 0.17 : 0,
    ease: [0.22, 1, 0.36, 1],
  }));

  const seamExit = computed(() => ({
    opacity: [null, 0, 0],
    x: [null, 32, 32],
    transition: {
      duration: animate.value ? 0.34 : 0,
      times: [0, 0.35, 1],
      ease: [0.22, 1, 0.36, 1],
    },
  }));

  function clearFocusWork() {
    clearTimeout(focusTimer);
    pendingFocus = null;
    options.focus.clear?.();
  }

  function settleFocus() {
    clearTimeout(focusTimer);
    const intent = pendingFocus;
    pendingFocus = null;

    if (intent !== null && toValue(options.active)) options.focus.settle(intent);
  }

  async function requestFocus(intent: FocusIntent, wait: boolean) {
    clearFocusWork();
    pendingFocus = intent;
    options.focus.request?.(intent);
    await nextTick();

    if (pendingFocus !== intent) return;
    options.focus.ready?.();

    if (wait) focusTimer = setTimeout(settleFocus, FOLD_DURATION + 30);
    else settleFocus();
  }

  function onCardAnimationComplete() {
    const card = options.card();

    if (card && Math.abs(card.offsetWidth - cardWidth.value) < 1) settleFocus();
  }

  watch(
    [() => toValue(options.width), () => toValue(options.stacked), () => toValue(options.active)],
    async ([measured, , active], _previous, onCleanup) => {
      const intent = pendingFocus;
      clearFocusWork();

      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;

        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      });
      resizing.value = true;

      if (!active || measured <= 0) return;
      const firstEntry = !entered.value;
      await nextTick();

      if (cancelled) return;
      options.beforeResizeFrame?.();
      resizeFrame = requestAnimationFrame(() => {
        resizing.value = false;
        entered.value = true;
        const initial = firstEntry ? options.focus.initial() : null;

        if (intent !== null) void requestFocus(intent, false);
        else if (initial !== null) void requestFocus(initial, false);
      });
    },
  );

  onScopeDispose(() => {
    clearFocusWork();

    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  });

  return {
    animate,
    paneWidth,
    cardWidth,
    detailWidth,
    cardTransition,
    seamTransition,
    seamExit,
    requestFocus,
    onCardAnimationComplete,
  };
}

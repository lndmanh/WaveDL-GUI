<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v';
import { cn } from '@/lib/utils';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '~~/types/catalog-api';

const styles = {
  root: cn('flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden'),
  stage: cn('relative flex min-h-0 min-w-0 flex-1 flex-nowrap overflow-hidden'),
  browser: cn('flex min-h-0 shrink-0 flex-col overflow-hidden'),
  seam: cn('flex min-h-0 shrink-0 flex-col overflow-hidden'),
};

type FocusIntent = { kind: 'detail'; path: string } | { kind: 'browser'; selection: DataSelection };

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ session: ConnectionSession }>();
const { isActive } = usePageActive();
const shellLayout = useShellLayout();
const stage = useTemplateRef<HTMLElement>('stage');
const browserRegion = useTemplateRef<HTMLElement>('browserRegion');
const detailRegion = useTemplateRef<HTMLElement>('detailRegion');
const picker = useTemplateRef('picker');
const detail = useTemplateRef('detail');
const { width } = useElementSize(() => (isActive.value ? stage.value : null));
const selection = shallowRef<DataSelection | null>(null);
let unsubscribe: (() => void) | undefined;

const stacked = computed(() => width.value > 0 && width.value < 720);
const folded = computed(() => selection.value !== null);

const {
  animate,
  cardWidth,
  detailWidth,
  cardTransition,
  seamTransition,
  seamExit,
  requestFocus,
  onCardAnimationComplete,
} = useSplitWorkspace<FocusIntent>({
  width,
  active: isActive,
  stacked,
  folded,
  card: () => browserRegion.value?.parentElement,
  focus: {
    initial: () => (selection.value ? { kind: 'detail', path: selection.value.path } : null),
    settle: settleFocus,
  },
});

function choose(value: DataSelection) {
  if (isActive.value && value.kind === 'file') selection.value = value;
}

function dismiss() {
  if (isActive.value) selection.value = null;
}

async function focusDetail() {
  await nextTick();

  if (isActive.value && selection.value) detail.value?.focusTitle();
}

function settleFocus(intent: FocusIntent) {
  if (intent.kind === 'detail') {
    if (selection.value?.path === intent.path) void focusDetail();
  } else if (!selection.value) void picker.value?.focusSelection(intent.selection);
}

const overlayContent =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"], [role="tooltip"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="combobox-content"]';

function isOverlay(element: Element): boolean {
  // The browser's permanent listboxes are not dismissible overlays.
  return element.getAttribute('role') !== 'listbox' || !browserRegion.value?.contains(element);
}

function onEscape(event: KeyboardEvent) {
  if (
    event.key !== 'Escape' ||
    !isActive.value ||
    !selection.value ||
    event.defaultPrevented ||
    event.isComposing
  )
    return;

  if (
    shellLayout.commandPaletteOpen.value ||
    shellLayout.isFocusMode.value ||
    (!shellLayout.isDockedLayout.value && shellLayout.isPanelSheetVisible.value)
  )
    return;

  const overlay = event.target instanceof Element ? event.target.closest(overlayContent) : null;

  if (overlay && isOverlay(overlay)) return;

  const openOverlay = Array.from(document.querySelectorAll<HTMLElement>(overlayContent)).some(
    (element) =>
      isOverlay(element) &&
      element.dataset.state !== 'closed' &&
      (element.getAttribute('role') !== 'combobox' ||
        element.getAttribute('aria-expanded') === 'true') &&
      !element.closest('[inert], [aria-hidden="true"]') &&
      element.getClientRects().length > 0,
  );

  if (openOverlay) return;
  event.preventDefault();
  dismiss();
}

watch(
  () => props.session,
  (session) => {
    unsubscribe?.();
    let revision = -1;
    unsubscribe = toRaw(session).subscribe((state) => {
      if (state.revision !== revision || state.status !== 'connected') selection.value = null;

      revision = state.revision;
    });
  },
  { immediate: true },
);

watch(
  selection,
  (value, previous) => {
    if (!value) detailRegion.value?.setAttribute('inert', '');
    else detailRegion.value?.removeAttribute('inert');

    if (value)
      void requestFocus({ kind: 'detail', path: value.path }, previous === null && animate.value);
    else if (previous) void requestFocus({ kind: 'browser', selection: previous }, animate.value);
  },
  { flush: 'sync' },
);

onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <section
    :class="styles.root"
    :aria-label="t('shell.datasets')"
    :data-stacked="stacked"
    @keydown="onEscape"
  >
    <MotionConfig reduced-motion="user">
      <div ref="stage" :class="styles.stage">
        <motion.div
          v-show="!(stacked && folded)"
          :class="styles.browser"
          :initial="false"
          :animate="{ width: cardWidth || '100%' }"
          :transition="cardTransition"
          @animation-complete="onCardAnimationComplete"
        >
          <div ref="browserRegion" class="flex min-h-0 min-w-0 flex-1 flex-col">
            <DatasetPathPicker
              ref="picker"
              :session="session"
              :selected="selection"
              immediate
              fill
              @select="choose"
            />
          </div>
        </motion.div>
        <AnimatePresence :initial="false">
          <motion.div
            v-if="folded"
            key="detail"
            :class="styles.seam"
            :style="{ width: `${detailWidth}px`, marginLeft: stacked ? '0px' : '16px' }"
            :initial="{ opacity: animate ? 0 : 1, x: animate ? 32 : 0 }"
            :animate="{ opacity: 1, x: 0 }"
            :exit="seamExit"
            :transition="seamTransition"
          >
            <div ref="detailRegion" class="h-full min-h-0 min-w-0 px-px pb-1">
              <DatasetDetail
                v-if="selection"
                ref="detail"
                :key="selection.path"
                :session="session"
                :selection="selection"
                :back="stacked"
                @close="dismiss"
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </MotionConfig>
  </section>
</template>

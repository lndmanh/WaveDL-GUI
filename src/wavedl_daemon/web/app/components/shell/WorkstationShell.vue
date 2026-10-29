<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose } from 'vue';
import { useI18n } from 'vue-i18n';
import { X, Import } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import ShellRail from './ShellRail.vue';
import ShellCanvas from './ShellCanvas.vue';
import ShellHeader from './ShellHeader.vue';
import ShellCompanion from './ShellCompanion.vue';
import ShellDock from './ShellDock.vue';
import ShellCommandPalette from './ShellCommandPalette.vue';
import { useShellLayout, useShellNavigation } from '../../composables/useShellLayout';
import type { ConnectionStatus } from '../../lib/connection-session';
import {
  sectionForPath,
  sectionPath,
  SHELL_ACTION_NAVIGATION,
  SHELL_PRIMARY_NAVIGATION,
} from '../../shell/sections';
import {
  workstationNavTestId,
  type WorkstationSection,
} from '../../lib/shell-test-ids';
type Overlay = 'adopt';
const props = defineProps<{
  status: ConnectionStatus;
  section: WorkstationSection;
  overlay: Overlay | null;
}>();
const emit = defineEmits<{
  navigate: [section: WorkstationSection];
  'update:overlay': [overlay: Overlay | null];
}>();
const { t } = useI18n({ useScope: 'global' });
const layout = useShellLayout();
const navigateTo = useShellNavigation();
const { isDockedLayout, isRailVisible, commandPaletteOpen: paletteOpen } = layout;
const connectionAnnouncement = computed(() =>
  props.status === 'connected'
    ? t('shell.connected')
    : props.status === 'connecting'
      ? t('shell.connecting')
      : props.status === 'offline'
        ? t('shell.offline')
        : t('shell.notConnected'),
);
let overlayOpener: HTMLElement | null = null;
let focusObserver: MutationObserver | null = null;
const overlayTitle = computed(() => t('shell.adoptStandaloneRun'));
function setOverlay(value: Overlay | null) {
  if (
    value &&
    !props.overlay &&
    typeof document !== 'undefined' &&
    document.activeElement instanceof HTMLElement
  )
    overlayOpener = document.activeElement;
  emit('update:overlay', value);
}
function restoreOverlayFocus(event: Event) {
  focusObserver?.disconnect();
  event.preventDefault();
  if (overlayOpener?.isConnected) overlayOpener.focus();
}
function focusOverlay(event: Event) {
  event.preventDefault();
  void nextTick(() => {
    const body = document.querySelector<HTMLElement>('.shell-overlay-body');
    if (!body) return;
    const focusFirst = () => {
      const control =
        body.querySelector<HTMLElement>('[role="combobox"]') ??
        body.querySelector<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [tabindex="0"]',
        );
      if (!control) return false;
      control.focus();
      focusObserver?.disconnect();
      return true;
    };
    if (focusFirst()) return;
    body.focus();
    focusObserver = new MutationObserver(focusFirst);
    focusObserver.observe(body, { childList: true, subtree: true });
  });
}
async function navigate(section: WorkstationSection) {
  paletteOpen.value = false;
  const destination = SHELL_PRIMARY_NAVIGATION.find((item) => item.id === section);
  if (destination) {
    setOverlay(null);
    if (navigateTo) navigateTo(sectionPath(destination.id));
    else emit('navigate', destination.id);
    return;
  }
  const action = SHELL_ACTION_NAVIGATION.find((item) => item.id === section);
  if (!action) return;
  if (action.id === 'adopt') {
    // props.section lags behind the router, so trust where navigation landed.
    if (props.section !== 'experiments' && navigateTo) {
      if (sectionForPath(await navigateTo('/experiments', false)) !== 'experiments') return;
    }
    setOverlay('adopt');
    return;
  }
  setOverlay(null);
  if (navigateTo) navigateTo(action.path);
  else emit('navigate', section);
}
function shortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setOverlay(null);
    paletteOpen.value = !paletteOpen.value;
  }
}
function updateViewport() {
  layout.setDockedLayout(window.innerWidth >= 1024);
}
onMounted(() => {
  updateViewport();
  window.addEventListener('keydown', shortcut);
  window.addEventListener('resize', updateViewport);
});
onScopeDispose(() => {
  focusObserver?.disconnect();
  window.removeEventListener('keydown', shortcut);
  window.removeEventListener('resize', updateViewport);
});
</script>
<template>
  <div data-shell class="shell-ground h-dvh flex min-h-0 min-w-0 overflow-hidden">
    <span class="sr-only" aria-live="polite" aria-atomic="true">{{ connectionAnnouncement }}</span>
    <a class="shell-skip-link" href="#workspace">{{ t('shell.skipToWorkspace') }}</a>
    <div class="shell-frame flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ShellRail
        v-if="isDockedLayout && isRailVisible"
        :section="section"
        :status="status"
        @navigate="navigate"
        @command="paletteOpen = true"
      />
      <ShellCanvas
        ><template #header
          ><ShellHeader
            :section="section"
            :status="status"
            @navigate="navigate"
            @command="paletteOpen = true"
            @toggle-panel="layout.togglePanel()"
            ><template #actions
              ><slot name="actions" /><Button
                v-if="section === 'experiments'"
                variant="outline"
                :size="isDockedLayout ? 'sm' : 'icon'"
                :data-testid="workstationNavTestId('adopt')"
                :data-compact="isDockedLayout ? undefined : 'true'"
                :aria-label="t('shell.adoptStandaloneRun')"
                :title="t('shell.adoptStandaloneRun')"
                @click="navigate('adopt')"
                ><Import aria-hidden="true" /><span :class="{ 'sr-only': !isDockedLayout }">{{
                  t('shell.adoptStandaloneRun')
                }}</span></Button
              ></template
            ></ShellHeader
          ></template
        ><slot
      /></ShellCanvas>
      <ShellCompanion />
    </div>
    <ShellDock
      v-if="!isDockedLayout"
      data-testid="workstation-nav"
      :section="section"
      :status="status"
      @navigate="navigate"
      @command="paletteOpen = true"
    />
    <ShellCommandPalette v-model:open="paletteOpen" @navigate="navigate" />
    <Dialog :open="props.overlay !== null" @update:open="!$event && setOverlay(null)"
      ><DialogContent
        class="shell-overlay shell-overlay-wide"
        :show-close-button="false"
        :aria-describedby="undefined"
        @open-auto-focus="focusOverlay"
        @close-auto-focus="restoreOverlayFocus"
        ><div class="shell-overlay-header">
          <DialogTitle class="sr-only">{{
            overlayTitle
          }}</DialogTitle>
          <DialogClose as-child
            ><Button
              class="shell-overlay-close"
              variant="ghost"
              size="icon"
              :aria-label="t('shell.closeOverlay')"
              ><X aria-hidden="true" /></Button
          ></DialogClose>
        </div>
        <div class="shell-overlay-body" tabindex="-1">
          <slot v-if="props.overlay === 'adopt'" name="adopt" /></div></DialogContent
    ></Dialog>
  </div>
</template>

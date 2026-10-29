<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { WorkstationSection } from '../../lib/shell-test-ids';
import { computed } from 'vue';
import { useMotionValue, useReducedMotion } from 'motion-v';
import { Activity, Search, Settings2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConnectionStatus } from '../../lib/connection-session';
import { SHELL_PRIMARY_NAVIGATION } from '../../shell/sections';
import {
  WORKSTATION_SECTIONS,
  WORKSTATION_SHELL_TEST_IDS,
  workstationNavTestId,
} from '../../lib/shell-test-ids';
import ShellRailItem from './ShellRailItem.vue';

const props = defineProps<{
  section: WorkstationSection;
  status: ConnectionStatus;
}>();

const emit = defineEmits<{
  navigate: [section: WorkstationSection];
  command: [];
}>();

const reducedMotion = useReducedMotion();
const pointerY = useMotionValue(Number.POSITIVE_INFINITY);
const { t } = useI18n({ useScope: 'global' });

const statusKey: Record<ConnectionStatus, string> = {
  connected: 'shell.connected',
  connecting: 'shell.connecting',
  disconnected: 'shell.notConnected',
  authentication: 'shell.notConnected',
  skew: 'shell.notConnected',
  offline: 'shell.offline',
  error: 'shell.notConnected',
};

const statusLabel = computed(() => t(statusKey[props.status]));

function trackPointer(event: PointerEvent): void {
  if (reducedMotion.value || event.pointerType !== 'mouse') return;
  pointerY.set(event.clientY);
}

function trackFocus(event: FocusEvent): void {
  if (reducedMotion.value || !(event.target instanceof HTMLElement)) return;
  const rect = event.target.getBoundingClientRect();
  pointerY.set(rect.y + rect.height / 2);
}

function releasePointer(): void {
  pointerY.set(Number.POSITIVE_INFINITY);
}

function activate(section: WorkstationSection): void {
  emit('navigate', section);
}

function onNavigationKeydown(event: KeyboardEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  if (!(document.activeElement instanceof HTMLElement)) return;

  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-testid^="nav-"]'),
  );
  const currentIndex = controls.findIndex((control) => control === document.activeElement);
  if (currentIndex < 0 || controls.length === 0) return;

  let nextIndex: number;
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % controls.length;
  else if (event.key === 'ArrowUp')
    nextIndex = (currentIndex - 1 + controls.length) % controls.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = controls.length - 1;
  else return;

  event.preventDefault();
  controls[nextIndex]?.focus();
}
</script>

<template>
  <TooltipProvider :delay-duration="280">
    <nav
      class="shell-rail flex h-full min-h-0 w-16 shrink-0 flex-col items-center gap-3 py-3"
      :aria-label="t('shell.sections')"
      :data-testid="WORKSTATION_SHELL_TEST_IDS.navigation"
      @pointermove="trackPointer"
      @pointerleave="releasePointer"
      @focusin="trackFocus"
      @focusout="releasePointer"
      @keydown="onNavigationKeydown"
    >
      <div class="shell-rail-island flex shrink-0 flex-col items-center gap-1 p-2">
        <div class="shell-rail-mark" aria-hidden="true">W</div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="shell-rail-control rounded-full"
              :aria-label="t('shell.commandPalette')"
              :title="t('shell.commandPalette')"
              @click="emit('command')"
            >
              <Search class="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="10">
            {{ t('shell.commandPalette') }}
          </TooltipContent>
        </Tooltip>
      </div>

      <div class="shell-rail-island flex min-h-0 w-full flex-1 flex-col items-center gap-1 p-2">
        <ShellRailItem
          v-for="item in SHELL_PRIMARY_NAVIGATION"
          :key="item.id"
          :item="item"
          :label="t(item.labelKey)"
          :active="props.section === item.id"
          :pointer-y="pointerY"
          @select="emit('navigate', $event.id)"
        />
      </div>

      <div class="shell-rail-island flex shrink-0 flex-col items-center gap-1 p-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="shell-rail-control rounded-full"
              :data-testid="workstationNavTestId('connection')"
              :aria-label="t('shell.connection')"
              :title="t('shell.connection')"
              @click="activate(WORKSTATION_SECTIONS.connection)"
            >
              <span class="shell-status-dot" :data-status="props.status" aria-hidden="true" />
              <span class="sr-only">{{ statusLabel }}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="10">
            <span class="flex items-center gap-2">
              <Activity class="size-3.5" aria-hidden="true" />{{ statusLabel }}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="shell-rail-control rounded-full"
              :data-testid="workstationNavTestId('settings')"
              :aria-label="t('shell.settings')"
              :title="t('shell.settings')"
              @click="activate(WORKSTATION_SECTIONS.settings)"
            >
              <Settings2 class="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="10">{{ t('shell.settings') }}</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  </TooltipProvider>
</template>

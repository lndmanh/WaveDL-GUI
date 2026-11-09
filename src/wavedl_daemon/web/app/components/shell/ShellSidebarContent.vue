<script setup lang="ts">
import { Search } from '@lucide/vue';
import { primaryShortcut } from '../../lib/utils';
import { SHELL_ACTION_NAVIGATION, SHELL_PRIMARY_NAVIGATION } from '../../shell/sections';
import ShellSidebarHost from './ShellSidebarHost.vue';
import ShellSidebarItem from './ShellSidebarItem.vue';
import type { WorkstationSection } from '~~/types/shell';
import type { ConnectionStatus } from '~~/types/connection-session';

const props = defineProps<{ section: WorkstationSection; status: ConnectionStatus; collapsed: boolean }>();
const emit = defineEmits<{ navigate: [section: WorkstationSection]; command: []; dismiss: [] }>();
const { t } = useI18n({ useScope: 'global' });
const searchShortcut = primaryShortcut('K');
const project = SHELL_PRIMARY_NAVIGATION.find((item) => item.id === 'project');
const workspace = SHELL_PRIMARY_NAVIGATION.filter((item) => item.id !== 'project');
const utilities = [...SHELL_ACTION_NAVIGATION].reverse();

function navigate(section: WorkstationSection): void {
  emit('dismiss');
  emit('navigate', section);
}

function command(): void {
  emit('dismiss');
  emit('command');
}

function onNavigationKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;

  if (!(event.currentTarget instanceof HTMLElement)) return;

  if (!(document.activeElement instanceof HTMLElement)) return;

  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-testid^="nav-"]'),
  );

  const currentIndex = controls.findIndex((control) => control === document.activeElement);

  if (currentIndex < 0 || controls.length === 0) return;

  let nextIndex: number;

  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % controls.length;
  else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + controls.length) % controls.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = controls.length - 1;
  else return;

  // Own navigation keys before the host dropdown's ArrowDown handler runs.
  event.preventDefault();
  event.stopPropagation();
  controls[nextIndex]?.focus();
}
</script>

<template>
  <TooltipProvider :delay-duration="280">
    <nav
      class="shell-sidebar-content"
      :data-collapsed="props.collapsed"
      :aria-label="t('shell.sections')"
      data-testid="workstation-nav"
      @keydown.capture="onNavigationKeydown"
    >
      <ShellSidebarHost :status="props.status" :collapsed="props.collapsed" @navigate="navigate" @dismiss="emit('dismiss')" />
      <ShellSidebarItem id="search" :icon="Search" :label="t('shell.search')" :collapsed="props.collapsed" :hint="searchShortcut.hint" :aria-keyshortcuts="searchShortcut.ariaKeyshortcuts" @select="command" />
      <ShellSidebarItem
        v-if="project"
        :id="project.id"
        :icon="project.icon"
        :label="t(project.labelKey)"
        :active="props.section === project.id"
        :collapsed="props.collapsed"
        primary
        @select="navigate(project.id)"
      />
      <div class="shell-sidebar-workspace shell-hide-scrollbar">
        <p class="shell-sidebar-group">{{ t('shell.workspace') }}</p>
        <ShellSidebarItem
          v-for="item in workspace"
          :id="item.id"
          :key="item.id"
          :icon="item.icon"
          :label="t(item.labelKey)"
          :active="props.section === item.id"
          :collapsed="props.collapsed"
          @select="navigate(item.id)"
        />
      </div>
      <div class="shell-sidebar-footer" role="group" :aria-label="t('shell.utilities')">
        <ShellSidebarItem
          v-for="item in utilities"
          :id="item.id"
          :key="item.id"
          :icon="item.icon"
          :label="t(item.labelKey)"
          :active="props.section === item.id"
          :collapsed="props.collapsed"
          @select="navigate(item.id)"
        />
        <slot name="footer" />
      </div>
    </nav>
  </TooltipProvider>
</template>

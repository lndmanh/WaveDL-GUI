<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Command } from '@lucide/vue';
import type { ConnectionStatus } from '../../lib/connection-session';
import type { WorkstationSection } from '../../lib/shell-test-ids';
import {
  SHELL_ACTION_NAVIGATION,
  SHELL_PRIMARY_NAVIGATION,
  type ShellNavigationDescriptor,
} from '../../shell/sections';
import ShellDockAction from './ShellDockAction.vue';

const props = defineProps<{ section: WorkstationSection; status: ConnectionStatus }>();
const emit = defineEmits<{
  navigate: [section: WorkstationSection];
  command: [];
}>();
const { t } = useI18n({ useScope: 'global' });
const actions = [
  ...SHELL_PRIMARY_NAVIGATION,
  ...SHELL_ACTION_NAVIGATION.filter((item) => item.id !== 'adopt'),
];

function activate(item: ShellNavigationDescriptor): void {
  emit('navigate', item.id);
}
</script>

<template>
  <nav class="shell-dock md:hidden" :aria-label="t('shell.sections')">
    <div class="shell-dock-inner">
      <ShellDockAction
        v-for="item in actions"
        :key="item.id"
        :item="item"
        :active="item.id === props.section"
        @select="activate"
      />
      <button
        type="button"
        class="shell-dock-command"
        :aria-label="t('shell.commandPalette')"
        :title="t('shell.commandPalette')"
        @click="emit('command')"
      >
        <Command aria-hidden="true" class="size-4" />
        <span class="sr-only">{{ t('shell.commandPaletteShortcut') }}</span>
      </button>
    </div>
  </nav>
</template>

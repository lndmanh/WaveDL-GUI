<script setup lang="ts">
import { PanelLeft } from '@lucide/vue';
import { motion } from 'motion-v';
import { primaryShortcut } from '../../lib/utils';
import ShellSidebarContent from './ShellSidebarContent.vue';
import ShellSidebarItem from './ShellSidebarItem.vue';
import type { WorkstationSection } from '~~/types/shell';
import type { ConnectionStatus } from '~~/types/connection-session';

const props = defineProps<{ section: WorkstationSection; status: ConnectionStatus }>();
const emit = defineEmits<{ navigate: [section: WorkstationSection]; command: [] }>();
const { t } = useI18n({ useScope: 'global' });
const preferences = useShellPreferencesStore();
const reducedMotion = useReducedMotion();
const collapseShortcut = primaryShortcut('B');
</script>

<template>
  <motion.div
    class="shell-sidebar shell-sidebar-island"
    :initial="{ opacity: 0, y: reducedMotion ? 0 : 8 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }"
  >
    <ShellSidebarContent
      :section="props.section"
      :status="props.status"
      :collapsed="preferences.sidebar.collapsed"
      @navigate="emit('navigate', $event)"
      @command="emit('command')"
    >
      <template #footer>
        <ShellSidebarItem
          id="collapse-sidebar"
          :icon="PanelLeft"
          :label="t(preferences.sidebar.collapsed ? 'shell.expandSidebar' : 'shell.collapseSidebar')"
          :collapsed="preferences.sidebar.collapsed"
          :hint="collapseShortcut.hint"
          :aria-keyshortcuts="collapseShortcut.ariaKeyshortcuts"
          @select="preferences.toggleSidebarCollapsed()"
        />
      </template>
    </ShellSidebarContent>
  </motion.div>
</template>

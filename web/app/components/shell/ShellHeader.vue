<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Command, PanelRight } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import type { ConnectionStatus } from '../../lib/connection-session';
import type { PrimaryWorkstationSection, WorkstationSection } from '../../lib/shell-test-ids';
import { workstationNavigationMessageKeys } from '../../i18n/dynamic-keys';
import { useShellLayout } from '../../composables/useShellLayout';

const props = defineProps<{
  section: PrimaryWorkstationSection;
  status: ConnectionStatus;
}>();

const emit = defineEmits<{
  togglePanel: [];
  navigate: [section: WorkstationSection];
  command: [];
}>();

const titleKey = computed(() => workstationNavigationMessageKeys[props.section]);
const { t } = useI18n({ useScope: 'global' });
const { isDockedLayout } = useShellLayout();
const statusKey: Record<ConnectionStatus, string> = {
  connected: 'shell.connected',
  connecting: 'shell.connecting',
  disconnected: 'shell.notConnected',
  authentication: 'shell.notConnected',
  skew: 'shell.notConnected',
  offline: 'shell.offline',
  error: 'shell.notConnected',
};
</script>

<template>
  <header class="shell-header" :data-layout="isDockedLayout ? 'docked' : 'compact'">
    <div class="min-w-0 flex-1">
      <p class="shell-header-kicker">{{ t('shell.workstation') }}</p>
      <h1 class="shell-header-title">{{ t(titleKey) }}</h1>
    </div>
    <div class="shell-header-actions">
      <Button
        type="button"
        variant="ghost"
        :size="isDockedLayout ? 'default' : 'icon'"
        class="shell-connection-chip"
        :data-testid="'connection-status'"
        :data-status="props.status"
        :data-compact="isDockedLayout ? undefined : 'true'"
        :aria-label="`${t('shell.connectionStatus')}: ${t(statusKey[props.status])}`"
        :title="t('shell.connection')"
        @click="emit('navigate', 'connection')"
      >
        <span class="shell-status-dot" :data-status="props.status" aria-hidden="true" />
        <span :class="{ 'sr-only': !isDockedLayout }">{{ t(statusKey[props.status]) }}</span>
      </Button>
      <slot name="actions" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="shell-header-icon"
        :aria-label="t('shell.commandPalette')"
        :title="t('shell.commandPalette')"
        @click="emit('command')"
      >
        <Command class="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="shell-header-icon"
        :aria-label="t('shell.openCompanionPanel')"
        :title="t('shell.openCompanionPanel')"
        @click="emit('togglePanel')"
      >
        <PanelRight class="size-4" aria-hidden="true" />
      </Button>
    </div>
  </header>
</template>

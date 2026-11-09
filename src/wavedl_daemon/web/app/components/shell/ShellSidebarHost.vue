<script setup lang="ts">
import { Activity, ChevronsUpDown, Settings2, Unplug } from '@lucide/vue';
import { connectionStatusKey } from '../../constants/shellConnection';
import type { WorkstationSection } from '~~/types/shell';
import type { ConnectionStatus } from '~~/types/connection-session';

const props = defineProps<{ status: ConnectionStatus; collapsed: boolean }>();
const emit = defineEmits<{ navigate: [section: WorkstationSection]; dismiss: [] }>();
const { t } = useI18n({ useScope: 'global' });
const { connection, session, state } = useWorkstation();
const host = useHostProfile(session);
const menuOpen = shallowRef(false);
const collisionPadding = useSafeAreaCollisionPadding();
const statusLabel = computed(() => t(connectionStatusKey[props.status]));
const hostname = computed(() => host.profile.value?.hostname || t('builder.thisMachine'));

watch(
  [() => props.status, () => state.value.revision],
  ([status]) => {
    // useHostProfile also loads on connection revisions; don't restart that request.
    if (status === 'connected' && !host.busy.value && !host.profile.value) void host.load();
  },
  { immediate: true },
);

function signOut(): void {
  emit('dismiss');
  connection.detach();
}
</script>

<template>
  <DropdownMenu v-model:open="menuOpen">
    <Tooltip :disabled="!props.collapsed || menuOpen">
      <TooltipTrigger as-child>
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            class="shell-sidebar-row shell-sidebar-host"
            :aria-label="`WaveDL · ${hostname} · ${t('shell.connectionStatus')}: ${statusLabel}`"
            data-testid="nav-host"
          >
            <span class="shell-sidebar-icon" aria-hidden="true">
              <img src="/favicon.svg" alt="" class="size-7 rounded-lg" />
            </span>
            <span class="shell-sidebar-label shell-sidebar-host-label">
              <span class="shell-sidebar-brand">WaveDL</span>
              <span class="shell-sidebar-hostname">
                <span class="shell-status-dot" :data-status="props.status" aria-hidden="true" />
                <span class="truncate">{{ hostname }}</span>
              </span>
            </span>
            <span class="shell-sidebar-trailing" aria-hidden="true"><ChevronsUpDown class="size-3.5" /></span>
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent v-if="props.collapsed" side="right" :side-offset="10">
        WaveDL · {{ hostname }} · {{ statusLabel }}
      </TooltipContent>
    </Tooltip>
    <DropdownMenuContent
      class="min-w-56 rounded-lg"
      :side="props.collapsed ? 'right' : 'bottom'"
      align="start"
      :side-offset="10"
      :collision-padding="collisionPadding"
    >
      <DropdownMenuLabel>{{ statusLabel }}</DropdownMenuLabel>
      <DropdownMenuGroup>
        <DropdownMenuItem @select="emit('navigate', 'connection')">
          <Activity aria-hidden="true" />{{ t('shell.connection') }}
        </DropdownMenuItem>
        <DropdownMenuItem @select="emit('navigate', 'settings')">
          <Settings2 aria-hidden="true" />{{ t('shell.settings') }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="props.status === 'disconnected'" @select="signOut">
          <Unplug aria-hidden="true" />{{ t('shell.signOut') }}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

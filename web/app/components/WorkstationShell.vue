<script setup lang="ts">
import { useWorkstationI18n } from '../composables/useWorkstationI18n';
import { shellSettingsMessages } from '../i18n/shell-settings';
import { Activity, Database, FileChartColumn, Layers, Plus, Settings2, Waves } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ConnectionStatus } from '../lib/connection-session';
import {
  WORKSTATION_SECTIONS,
  WORKSTATION_SHELL_TEST_IDS,
  workstationNavTestId,
  type WorkstationSection,
} from '../lib/shell-test-ids';

type Section = WorkstationSection;
defineProps<{ status: ConnectionStatus; section: Section }>();
const emit = defineEmits<{ navigate: [section: Section] }>();

const navigation = [
  { label: 'Experiments', icon: Layers, section: WORKSTATION_SECTIONS.experiments },
  { label: 'New training run', icon: Plus, section: WORKSTATION_SECTIONS.project },
  { label: 'Datasets', icon: Database, section: WORKSTATION_SECTIONS.datasets },
  { label: 'Results', icon: FileChartColumn, section: WORKSTATION_SECTIONS.results },
  { label: 'Adopt standalone run', icon: Plus, section: WORKSTATION_SECTIONS.adopt },
  { label: 'Connection', icon: Settings2, section: WORKSTATION_SECTIONS.connection },
  { label: 'Settings', icon: Settings2, section: WORKSTATION_SECTIONS.settings },
] as const;
function navigate(value: Section) {
  emit('navigate', value);
}
const { translateKnownMessage } = useWorkstationI18n(shellSettingsMessages);
</script>

<template>
  <a class="skip-link" href="#workspace">{{ translateKnownMessage('Skip to workspace') }}</a>
  <div class="workstation">
    <aside class="sidebar" :aria-label="translateKnownMessage('Workstation navigation')">
      <div class="brand"><Waves aria-hidden="true" /><span>WaveDL</span></div>
      <p class="sidebar-label">{{ translateKnownMessage('WORKSPACE') }}</p>
      <nav
        class="navigation"
        :aria-label="translateKnownMessage('Sections')"
        :data-testid="WORKSTATION_SHELL_TEST_IDS.navigation"
      >
        <Button
          v-for="item in navigation"
          :key="item.section"
          :variant="item.section === section ? 'secondary' : 'ghost'"
          :disabled="item.section === null"
          :aria-current="item.section === section ? 'page' : undefined"
          :data-testid="workstationNavTestId(item.section)"
          @click="navigate(item.section)"
        >
          <component :is="item.icon" data-icon="inline-start" aria-hidden="true" />
          {{ translateKnownMessage(item.label) }}
        </Button>
      </nav>
      <p class="sidebar-note">
        {{ translateKnownMessage('Your compute. Your workspace.') }}<br />{{
          translateKnownMessage('Execution belongs to the daemon.')
        }}
      </p>
      <div class="sidebar-footer">
        <Activity aria-hidden="true" /><span>{{
          translateKnownMessage('Local-first computation')
        }}</span>
      </div>
    </aside>
    <div class="workspace">
      <header class="toolbar">
        <span class="toolbar-title">{{ translateKnownMessage('Workstation') }}</span>
        <div class="toolbar-actions">
          <Badge variant="outline" :data-testid="WORKSTATION_SHELL_TEST_IDS.connectionStatus">{{
            status === 'connected'
              ? translateKnownMessage('Connected')
              : status === 'connecting'
                ? translateKnownMessage('Connecting')
                : status === 'offline'
                  ? translateKnownMessage('Offline')
                  : translateKnownMessage('Not connected')
          }}</Badge>
          <Button
            v-if="section !== 'connection'"
            variant="ghost"
            size="sm"
            @click="emit('navigate', 'connection')"
            >{{ translateKnownMessage('Connection') }}</Button
          >
        </div>
      </header>
      <main
        id="workspace"
        class="content"
        tabindex="-1"
        :data-testid="WORKSTATION_SHELL_TEST_IDS.content"
      >
        <slot />
      </main>
      <footer class="footer">
        {{ translateKnownMessage('WaveDL daemon interface · Development foundation') }}
      </footer>
    </div>
  </div>
</template>

<style scoped>
.workstation {
  display: grid;
  grid-template-columns: 228px 1fr;
  min-height: 100svh;
}
.sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 36px 20px 22px;
  background: var(--sidebar);
  border-right: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -1px;
  padding: 0 10px;
}
.brand svg {
  color: var(--primary);
  width: 30px;
  height: 30px;
}
.sidebar-label {
  margin: 44px 12px 12px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 1.5px;
  color: var(--muted-foreground);
}
.navigation {
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: stretch;
}
.navigation :deep(button) {
  justify-content: flex-start;
}
.sidebar-note {
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted-foreground);
  margin: 26px 12px;
}
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: auto 10px 0;
  color: var(--muted-foreground);
  font-size: 11px;
}
.sidebar-footer svg {
  width: 14px;
  height: 14px;
}
.workspace {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  height: 76px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 36px;
}
.toolbar-title {
  font-weight: 600;
  font-size: 14px;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding: 64px 44px;
}
.footer {
  padding: 20px 36px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.skip-link {
  position: fixed;
  top: -80px;
  left: 16px;
  padding: 12px;
  background: var(--background);
}
.skip-link:focus {
  top: 12px;
}
@media (max-width: 720px) {
  .workstation {
    grid-template-columns: minmax(0, 1fr);
  }
  .sidebar {
    padding: 18px 24px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .sidebar-label,
  .sidebar-note,
  .sidebar-footer {
    display: none;
  }
  .brand {
    font-size: 20px;
    padding: 0;
  }
  .navigation {
    flex-direction: row;
    overflow-x: auto;
    gap: 8px;
    padding-block: 12px 4px;
  }
  .navigation :deep(button) {
    flex-shrink: 0;
  }
  .toolbar {
    height: 64px;
    padding: 0 24px;
  }
  .content {
    padding: 44px 18px;
  }
  .footer {
    padding: 18px 24px;
  }
}
</style>

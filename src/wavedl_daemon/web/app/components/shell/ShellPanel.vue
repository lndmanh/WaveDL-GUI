<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { PanelRightClose } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SHELL_PANEL_DEFAULT_WIDTH,
  SHELL_PANEL_MAX_WIDTH,
  SHELL_PANEL_MIN_WIDTH,
  type ShellPanelTabDefinition,
  type ShellPanelTabId,
} from '../../shell/constants';

const props = defineProps<{
  tabs: readonly ShellPanelTabDefinition[];
  activeTab: ShellPanelTabId;
  width: number;
}>();

const emit = defineEmits<{
  'update:activeTab': [tab: ShellPanelTabId];
  resize: [width: number];
  collapse: [];
}>();

const { t } = useI18n({ useScope: 'global' });
const isResizing = shallowRef(false);
let startX = 0;
let startWidth = 0;

const activeTabValue = computed({
  get: () => props.activeTab,
  set: (value: string) => {
    const tab = props.tabs.find((candidate) => candidate.id === value);
    if (tab) emit('update:activeTab', tab.id);
  },
});

function onResizeStart(event: PointerEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  isResizing.value = true;
  startX = event.clientX;
  startWidth = props.width;
  if (typeof event.currentTarget.setPointerCapture === 'function') {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}

function onResizeMove(event: PointerEvent): void {
  if (isResizing.value) emit('resize', startWidth - (event.clientX - startX));
}

function onResizeEnd(event: PointerEvent): void {
  if (!isResizing.value) return;
  isResizing.value = false;
  if (
    event.currentTarget instanceof HTMLElement &&
    typeof event.currentTarget.hasPointerCapture === 'function' &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function onResizeKey(event: KeyboardEvent): void {
  const step = 24;
  if (event.key === 'ArrowLeft') emit('resize', props.width + step);
  else if (event.key === 'ArrowRight') emit('resize', props.width - step);
  else if (event.key === 'Home') emit('resize', SHELL_PANEL_DEFAULT_WIDTH);
  else return;
  event.preventDefault();
}
</script>

<template>
  <aside
    class="shell-panel relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    :style="{ width: `${props.width}px` }"
    :data-testid="'shell-companion'"
    :aria-label="t('shell.companionPanel')"
    @keydown.esc.prevent="emit('collapse')"
  >
    <div
      class="shell-panel-resize-handle hidden lg:block"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="t('shell.resizeCompanionPanel')"
      :aria-valuenow="props.width"
      :aria-valuemin="SHELL_PANEL_MIN_WIDTH"
      :aria-valuemax="SHELL_PANEL_MAX_WIDTH"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
      @keydown="onResizeKey"
      @dblclick="emit('resize', SHELL_PANEL_DEFAULT_WIDTH)"
    >
      <span :class="{ 'shell-panel-resize-line-active': isResizing }" />
    </div>

    <div class="shell-panel-header">
      <Tabs v-model="activeTabValue" class="min-w-0 flex-1">
        <TabsList class="shell-panel-tabs">
          <TabsTrigger
            v-for="tab in props.tabs"
            :key="tab.id"
            :value="tab.id"
            :id="`shell-panel-tab-trigger-${tab.id}`"
            :aria-controls="`shell-panel-body-${tab.id}`"
            class="shell-panel-tab"
          >
            <component :is="tab.icon" class="size-3.5" aria-hidden="true" />
            {{ t(tab.labelKey) }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="shell-panel-close lg:hidden"
        :aria-label="t('shell.collapseCompanionPanel')"
        :title="t('shell.collapseCompanionPanel')"
        @click="emit('collapse')"
      >
        <PanelRightClose class="size-4" aria-hidden="true" />
      </Button>
    </div>

    <div class="shell-panel-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <template v-for="tab in props.tabs" :key="tab.id">
        <section
          :id="`shell-panel-body-${tab.id}`"
          v-show="props.activeTab === tab.id"
          class="shell-panel-tab-body"
          role="tabpanel"
          :aria-label="t(tab.labelKey)"
          :aria-labelledby="`shell-panel-tab-trigger-${tab.id}`"
          :aria-hidden="props.activeTab !== tab.id"
          :inert="props.activeTab !== tab.id"
        >
          <slot :name="tab.id" />
        </section>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, watch } from 'vue';
import { FocusScope } from 'reka-ui';
import { useShellLayout } from '../../composables/useShellLayout';
import ShellPanel from './ShellPanel.vue';
import ShellPanelTarget from './ShellPanelTarget.vue';

const {
  activeTab,
  closePanel,
  isPanelVisible,
  isDockedLayout,
  panelTabs,
  panelWidth,
  setActiveTab,
  setPanelWidth,
} = useShellLayout();
let opener: HTMLElement | null = null;
watch(isPanelVisible, (visible) => {
  if (visible && !isDockedLayout.value) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void nextTick(() => document.querySelector<HTMLElement>('#shell-companion button')?.focus());
  } else if (!visible && opener?.isConnected) {
    const target = opener;
    void nextTick(() => nextTick(() => target.focus()));
    opener = null;
  }
});
</script>

<template>
  <div
    v-if="!isDockedLayout && isPanelVisible"
    class="shell-panel-scrim"
    aria-hidden="true"
    @pointerdown="closePanel()"
  />
  <FocusScope
    as-child
    :loop="!isDockedLayout && isPanelVisible"
    :trapped="!isDockedLayout && isPanelVisible"
    @mount-auto-focus="$event.preventDefault()"
    @unmount-auto-focus="$event.preventDefault()"
  >
    <ShellPanel
      id="shell-companion"
      v-show="isPanelVisible"
      class="shell-companion"
      :role="isDockedLayout ? 'complementary' : 'dialog'"
      :aria-modal="!isDockedLayout && isPanelVisible ? true : undefined"
      :tabs="panelTabs"
      :active-tab="activeTab"
      :width="panelWidth"
      @update:active-tab="setActiveTab"
      @resize="setPanelWidth"
      @collapse="closePanel"
      @keydown.esc.prevent="closePanel()"
    >
      <template v-for="tab in panelTabs" :key="tab.id" #[tab.id]>
        <ShellPanelTarget :tab="tab">
          <slot :name="tab.id" />
        </ShellPanelTarget>
      </template>
    </ShellPanel>
  </FocusScope>
</template>

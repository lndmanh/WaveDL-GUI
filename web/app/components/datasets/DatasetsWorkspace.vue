<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { datasetMessages } from '../../i18n/datasets';
import { shallowRef } from 'vue';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '../../lib/catalog-api';
import BrowseContainer from '../catalog/BrowseContainer.vue';
import DatasetPreviewPanel from './DatasetPreviewPanel.vue';
import DatasetInfoPanel from './DatasetInfoPanel.vue';

const { t } = useWorkstationI18n(datasetMessages);

defineProps<{ session: ConnectionSession }>();
const selection = shallowRef<DataSelection | null>(null);
</script>

<template>
  <section class="dataset-workspace">
    <header>
      <h1>{{ t('workspaceTitle') }}</h1>
      <p>{{ t('workspaceHelp') }}</p>
    </header>
    <BrowseContainer :session="session" @select="selection = $event" />
    <DatasetInfoPanel :session="session" :selection="selection" />
    <DatasetPreviewPanel :session="session" :selection="selection" />
  </section>
</template>

<style scoped>
.dataset-workspace {
  display: flex;
  flex-direction: column;
  gap: 28px;
  min-width: 0;
}
.dataset-workspace p {
  color: var(--muted-foreground);
}
</style>

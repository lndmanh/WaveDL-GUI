<script setup lang="ts">
import DatasetPathPicker from '../datasets/DatasetPathPicker.vue';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '../../lib/catalog-api';

defineProps<{ session: ConnectionSession; allowDirectory?: boolean; label?: string }>();
defineEmits<{ select: [selection: DataSelection] }>();
</script>

<template>
  <DatasetPathPicker
    :session="session"
    :allow-directory="allowDirectory"
    :label="label"
    @select="$emit('select', $event)"
  />
</template>

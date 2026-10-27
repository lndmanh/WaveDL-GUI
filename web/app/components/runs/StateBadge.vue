<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Badge } from '@/components/ui/badge';
import type { RunView } from '../../lib/daemon-api';
import { runStateMessageKeys } from '../../i18n/dynamic-keys';
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ run: RunView; stale?: boolean }>();
const label = computed(() => t(runStateMessageKeys[props.run.state]));
</script>
<template>
  <Badge :variant="run.uncertainty || stale ? 'outline' : 'secondary'"
    >{{ label }}<span v-if="stale">{{ t('runs.stale') }}</span
    ><span v-else-if="run.uncertainty">{{ t('runs.uncertain') }}</span></Badge
  >
</template>

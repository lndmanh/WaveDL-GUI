<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import type { RunView } from '../../lib/daemon-api';
const { t, translateKnownMessage } = useWorkstationI18n(runMessages);
const props = defineProps<{ run: RunView; stale?: boolean }>();
const label = computed(() => translateKnownMessage(props.run.state.replaceAll('_', ' ')));
</script>
<template>
  <Badge :variant="run.uncertainty || stale ? 'outline' : 'secondary'"
    >{{ label }}<span v-if="stale">{{ t('stale') }}</span
    ><span v-else-if="run.uncertainty">{{ t('uncertain') }}</span></Badge
  >
</template>

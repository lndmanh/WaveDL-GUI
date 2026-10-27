<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { resultsMessages } from '../../i18n/results';
import { useClientMessages } from '../../composables/useClientMessages';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { AutomaticPlotState } from '../../lib/autoplot-controller';
const { t } = useWorkstationI18n(resultsMessages);
const { clientMessage } = useClientMessages();
defineProps<{ state: AutomaticPlotState }>();
defineEmits<{ retry: []; stop: []; monitor: [runId: string] }>();
</script>

<template>
  <Alert v-if="state.status !== 'stopped'" class="mb-6" aria-live="polite">
    <AlertTitle>{{ t('diagnosticPlots') }}</AlertTitle>
    <AlertDescription>
      <p>{{ clientMessage(state.message) }}</p>
      <p v-if="state.status === 'armed' || state.status === 'planning'">{{ t('automaticHelp') }}</p>
      <div class="mt-3 flex flex-wrap gap-3">
        <Button
          v-if="state.status === 'error'"
          type="button"
          variant="outline"
          @click="$emit('retry')"
          >{{ t('retryPlots') }}</Button
        >
        <Button
          v-if="state.plotRunId"
          type="button"
          variant="outline"
          @click="$emit('monitor', state.plotRunId)"
          >{{ t('monitorPlot') }}</Button
        >
        <Button type="button" variant="outline" @click="$emit('stop')">{{
          state.status === 'submitted' ? t('dismiss') : t('disablePlots')
        }}</Button>
      </div>
    </AlertDescription>
  </Alert>
</template>

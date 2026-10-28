<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, shallowRef } from 'vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import InfoChip from '../common/InfoChip.vue';
import type { TrainingRequest } from '../../../shared/schemas/training-request';
import { trainingYaml, trainingCommand } from '../../lib/training-export';
import { useClientMessages } from '../../composables/useClientMessages';

const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const props = defineProps<{ draft: TrainingRequest; disabled: boolean }>();
const message = shallowRef<string | Error>('');
const displayMessage = computed(() =>
  typeof message.value === 'string' && message.value.startsWith('project.')
    ? t(message.value)
    : clientMessage(message.value),
);
const command = shallowRef('');
function download() {
  let blob: Blob;
  try {
    blob = new Blob([trainingYaml(props.draft)], { type: 'application/yaml;charset=utf-8' });
  } catch {
    message.value = 'project.exportValidationRequired';
    return;
  }
  let url: string | undefined;
  try {
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wavedl-training.yaml';
    link.click();
    message.value = 'project.yamlExportRequested';
  } catch {
    message.value = 'project.yamlExportFailed';
  } finally {
    // An anchor click has no browser save receipt; allow the download to consume
    // the URL before releasing it, including when the browser rejects the click.
    if (url) {
      const requestedUrl = url;
      setTimeout(() => URL.revokeObjectURL(requestedUrl), 1000);
    }
  }
}
async function copy() {
  try {
    command.value = trainingCommand(props.draft);
    await navigator.clipboard.writeText(command.value);
    message.value = 'project.standalonePosixCommandCopied';
  } catch (error) {
    message.value = error instanceof Error ? error : 'project.clipboardUnavailable';
  }
}
</script>
<template>
  <Collapsible :default-open="true">
    <CollapsibleTrigger class="flex w-full items-center justify-between text-left font-medium">
      {{ t('project.standaloneConfigurationExport') }}
    </CollapsibleTrigger>
    <CollapsibleContent class="mt-4 flex flex-col gap-4">
      <p>{{ t('project.exportHelp') }}</p>
      <div class="flex flex-wrap gap-2">
        <Badge variant="outline">{{ t('project.exportSamePaths') }}</Badge>
        <Badge variant="outline">{{ t('project.exportNoSlurm') }}</Badge>
        <Badge variant="outline">{{ t('project.exportNoCredentials') }}</Badge>
        <Badge variant="outline">{{ t('project.exportOutputLocation') }}</Badge>
      </div>
      <div class="flex flex-wrap gap-3">
        <Button type="button" variant="outline" :disabled="disabled" @click="download">{{
          t('project.downloadYaml')
        }}</Button
        ><Button type="button" variant="outline" :disabled="disabled" @click="copy">{{
          t('project.copyStandaloneCliCommand')
        }}</Button>
      </div>
      <div v-if="message" role="status" aria-live="polite">
        <InfoChip
          v-if="message === 'project.yamlExportRequested'"
          :label="t('project.yamlExportRequested')"
          :text="t('project.yamlExportRequestedDetails')"
        />
        <p v-else>{{ displayMessage }}</p>
      </div>
      <div
        v-if="command"
        class="max-h-64 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs whitespace-pre-wrap break-all"
        role="region"
        :aria-label="t('project.copiedCommand')"
        tabindex="0"
      >
        <code>{{ command }}</code>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

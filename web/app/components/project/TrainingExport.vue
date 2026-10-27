<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, shallowRef } from 'vue';
import { Button } from '@/components/ui/button';
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
  <details>
    <summary class="cursor-pointer font-medium">
      {{ t('project.standaloneConfigurationExport') }}
    </summary>
    <div class="mt-4 flex flex-col gap-4">
      <p>
        {{ t('project.exportHelp') }}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button type="button" variant="outline" :disabled="disabled" @click="download">{{
          t('project.downloadYaml')
        }}</Button
        ><Button type="button" variant="outline" :disabled="disabled" @click="copy">{{
          t('project.copyStandaloneCliCommand')
        }}</Button>
      </div>
      <p v-if="message" role="status">{{ displayMessage }}</p>
      <pre v-if="command" class="overflow-auto rounded-lg bg-muted p-4 text-xs" tabindex="0">{{
        command
      }}</pre>
    </div>
  </details>
</template>

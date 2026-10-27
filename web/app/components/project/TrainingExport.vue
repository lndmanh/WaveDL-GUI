<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { shallowRef } from 'vue';
import { Button } from '@/components/ui/button';
import type { TrainingRequest } from '../../../shared/schemas/training-request';
import { trainingYaml, trainingCommand } from '../../lib/training-export';

const { translateKnownMessage } = useWorkstationI18n(projectMessages);
const props = defineProps<{ draft: TrainingRequest; disabled: boolean }>();
const message = shallowRef('');
const command = shallowRef('');
function download() {
  let blob: Blob;
  try {
    blob = new Blob([trainingYaml(props.draft)], { type: 'application/yaml;charset=utf-8' });
  } catch {
    message.value = 'Validate all training and execution fields before exporting.';
    return;
  }
  let url: string | undefined;
  try {
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wavedl-training.yaml';
    link.click();
    message.value =
      'Validated training YAML export requested. Your browser controls where it is saved; runtime environment and credentials omitted.';
  } catch {
    message.value =
      'YAML export could not be requested. Check your browser download settings and retry.';
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
    message.value = 'Standalone POSIX command copied.';
  } catch (error) {
    message.value =
      error instanceof Error
        ? error.message
        : 'Clipboard unavailable; select the displayed command manually.';
  }
}
</script>
<template>
  <details>
    <summary class="cursor-pointer font-medium">
      {{ translateKnownMessage('Standalone configuration export') }}
    </summary>
    <div class="mt-4 flex flex-col gap-4">
      <p>
        {{
          translateKnownMessage(
            'These exports reflect your validated draft, never an approved daemon plan. Run the POSIX command on the selected Python host with the same dataset paths. Output goes to ./results there. This does not submit Slurm work, reproduce scheduler policy, or configure credentials.',
          )
        }}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button type="button" variant="outline" :disabled="disabled" @click="download">{{
          translateKnownMessage('Download YAML')
        }}</Button
        ><Button type="button" variant="outline" :disabled="disabled" @click="copy">{{
          translateKnownMessage('Copy standalone CLI command')
        }}</Button>
      </div>
      <p v-if="message" role="status">{{ translateKnownMessage(message) }}</p>
      <pre v-if="command" class="overflow-auto rounded-lg bg-muted p-4 text-xs" tabindex="0">{{
        command
      }}</pre>
    </div>
  </details>
</template>

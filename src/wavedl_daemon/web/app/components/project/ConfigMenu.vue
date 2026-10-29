<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ChevronDown, Download, FileUp, TerminalSquare } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TrainingRequest } from '../../../shared/schemas/training-request';
import { trainingCommand, trainingYaml } from '../../lib/training-export';

const props = defineProps<{ draft: TrainingRequest; disabled: boolean }>();
const emit = defineEmits<{
  import: [];
  notice: [message: string | Error, ok: boolean, detail?: string];
}>();
const { t } = useI18n({ useScope: 'global' });

function download() {
  let blob: Blob;
  try {
    blob = new Blob([trainingYaml(props.draft)], { type: 'application/yaml;charset=utf-8' });
  } catch {
    emit('notice', 'project.exportValidationRequired', false);
    return;
  }
  let url: string | undefined;
  try {
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wavedl-training.yaml';
    link.click();
    emit('notice', 'project.yamlExportRequested', true, 'builder.exportSavedDetail');
  } catch {
    emit('notice', 'project.yamlExportFailed', false);
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
    await navigator.clipboard.writeText(trainingCommand(props.draft));
    emit('notice', 'project.standalonePosixCommandCopied', true);
  } catch (error) {
    emit('notice', error instanceof Error ? error : 'project.clipboardUnavailable', false);
  }
}
</script>
<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button type="button" variant="outline" class="rounded-xl bg-surface" data-testid="config-menu">
        {{ t('builder.importExport') }}<ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72 rounded-xl p-1.5">
      <DropdownMenuItem class="config-item" :disabled="disabled" @select="emit('import')">
        <FileUp aria-hidden="true" />
        <span class="flex flex-col">
          <span>{{ t('builder.importConfig') }}</span>
          <span class="text-xs text-muted-foreground">{{ t('builder.importConfigHelp') }}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="config-item" :disabled="disabled" @select="download">
        <Download aria-hidden="true" />
        <span class="flex flex-col">
          <span>{{ t('project.downloadYaml') }}</span>
          <span class="text-xs text-muted-foreground">{{ t('project.exportNoCredentials') }}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem class="config-item" :disabled="disabled" @select="copy">
        <TerminalSquare aria-hidden="true" />
        <span class="flex flex-col">
          <span>{{ t('project.copyStandaloneCliCommand') }}</span>
          <span class="text-xs text-muted-foreground">{{ t('project.exportSamePaths') }}</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
<style>
.config-item {
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.55rem 0.6rem;
  border-radius: 0.6rem;
}
.config-item svg {
  margin-top: 0.15rem;
}
</style>

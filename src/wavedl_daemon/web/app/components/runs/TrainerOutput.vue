<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { RunView } from '~~/types/daemon-api';

const styles = {
  reader: cn('flex min-h-0 min-w-0 flex-1 flex-col gap-3'),
  text: cn(
    'log-text whitespace-pre-wrap wrap-anywhere max-h-104 overflow-auto',
    '[font:0.8rem/1.6_ui-monospace,_monospace] p-4 bg-muted rounded-[0.75rem]',
  ),
};

const props = defineProps<{ run: RunView | null; active: boolean }>();
const { t } = useI18n({ useScope: 'global' });

const { output, error, terminal } = useTrainerOutput({
  run: () => props.run,
  active: () => props.active,
});

const reader = useTemplateRef<HTMLPreElement>('reader');
const following = shallowRef(true);

function trackScroll(): void {
  const element = reader.value;

  // Hiding a kept-mounted tab can emit a scroll event with zero dimensions.
  if (props.active && element && element.clientHeight > 0)
    following.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
}

watch(
  [() => props.run?.run_id, () => props.run?.attempt],
  () => {
    following.value = true;
  },
  { flush: 'sync' },
);

watch([() => output.value.text, () => props.active], async () => {
  await nextTick();
  const element = reader.value;

  if (element && props.active && following.value) element.scrollTop = element.scrollHeight;
});
</script>

<template>
  <div :class="styles.reader">
    <InfoChip
      v-if="output.omitted"
      :label="t('runs.boundedOutput')"
      :text="t('runs.omittedOutput')"
      uncertain
    />
    <Alert v-if="error" role="status">
      <AlertDescription>{{
        error === 'missing' ? t('runs.outputRunMissing') : t('runs.outputRetrying')
      }}</AlertDescription>
    </Alert>
    <pre
      ref="reader"
      :class="styles.text"
      role="log"
      tabindex="0"
      aria-live="off"
      :aria-label="t('runs.trainerOutput')"
      @scroll="trackScroll"
      >{{
        output.text || (terminal ? t('runs.noTrainerOutput') : t('runs.waitingTrainerOutput'))
      }}</pre>
  </div>
</template>

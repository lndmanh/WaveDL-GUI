<script setup lang="ts">
import { cn } from '@/lib/utils';
import { eventDiagnostic } from '../../lib/run-monitor';
import type { RunView } from '~~/types/daemon-api';
import type { RunEvent } from '~~/types/event-stream';

// Utility bundles keep state and descendant styling beside their component.
const styles = {
  logs: cn('flex min-w-0 flex-col gap-3'),
  logsPanel: cn(
    'h-full min-h-0 [&_.log-text]:max-h-none [&_.log-text]:flex-1',
    '[&_.log-text]:min-h-0',
  ),
  tabs: cn('flex min-h-0 flex-1 flex-col gap-3'),
  tabList: cn('h-auto w-fit max-w-full shrink-0 flex-wrap'),
  tabTrigger: cn('min-w-0 whitespace-normal'),
  content: cn('flex min-h-0 flex-1 flex-col gap-3 data-[state=inactive]:hidden'),
  text: cn(
    'log-text whitespace-pre-wrap wrap-anywhere max-h-104 overflow-auto',
    '[font:0.8rem/1.6_ui-monospace,_monospace] p-4 bg-muted rounded-[0.75rem]',
  ),
};

const { t } = useI18n({ useScope: 'global' });

const props = withDefaults(
  defineProps<{
    run: RunView | null;
    events: readonly RunEvent[];
    truncated: boolean;
    panel?: boolean;
    active?: boolean;
  }>(),
  { panel: false, active: true },
);

const tab = shallowRef('output');

const diagnostics = computed<{ text: string; shortened: boolean; truncated: boolean }>(
  (previous) => {
    if (!props.active || tab.value !== 'events')
      return previous ?? { text: '', shortened: false, truncated: false };
    const events = props.events.map(eventDiagnostic);

    return {
      text: events.map((event) => event.text).join('\n'),
      shortened: events.some((event) => event.truncated),
      truncated: props.truncated,
    };
  },
);
</script>
<template>
  <section
    :class="cn(styles.logs, panel && styles.logsPanel)"
    :aria-label="t('runs.runtimeDiagnostics')"
  >
    <Tabs v-model="tab" :unmount-on-hide="false" :class="styles.tabs">
      <TabsList :class="styles.tabList" :aria-label="t('runs.runtimeDiagnostics')">
        <TabsTrigger value="output" :class="styles.tabTrigger">{{
          t('runs.trainerOutput')
        }}</TabsTrigger>
        <TabsTrigger value="events" :class="styles.tabTrigger">{{
          t('runs.runEvents')
        }}</TabsTrigger>
      </TabsList>
      <TabsContent value="output" :class="styles.content">
        <TrainerOutput :run="run" :active="active && tab === 'output'" />
      </TabsContent>
      <TabsContent value="events" :class="styles.content">
        <InfoChip
          v-if="diagnostics.truncated"
          :label="t('runs.boundedDiagnostics')"
          :text="t('runs.omittedDiagnostics')"
          uncertain
        />
        <InfoChip
          v-if="diagnostics.shortened"
          :label="t('runs.shortDiagnostics')"
          :text="t('runs.shortenedDiagnostics')"
        />
        <pre
          :class="styles.text"
          role="log"
          tabindex="0"
          aria-live="off"
          :aria-label="t('runs.runEvents')"
          >{{ diagnostics.text || t('runs.noEvents') }}</pre>
      </TabsContent>
    </Tabs>
  </section>
</template>

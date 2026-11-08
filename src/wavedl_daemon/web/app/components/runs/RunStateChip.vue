<script setup lang="ts">
import { cn } from '@/lib/utils';
import {
  Ban,
  CircleCheck,
  CircleHelp,
  CircleStop,
  CircleX,
  Clock,
  EyeOff,
  FileText,
  ListOrdered,
  Loader2,
  PauseCircle,
  Send,
  Unplug,
  WifiOff,
} from '@lucide/vue';

import { runActivityMessageKeysFor, runStateMessageKeys } from '../../i18n/dynamic-keys';
import type { RunState, RunView } from '~~/types/daemon-api';

type StateTone = 'outline' | 'secondary' | 'blue' | 'warning' | 'success' | 'destructive';

// Utility bundles keep state and descendant styling beside their component.
const styles = {
  runStateChip: cn(
    'min-h-7 gap-[0.35rem] [transition:opacity_160ms_ease] max-w-full min-w-0 whitespace-normal flex-wrap',
    'motion-reduce:transition-none',
  ),
  runStateChipDashed: cn('border-dashed border-2'),
  runStateChipDimmed: cn('opacity-[0.58]'),
  runStateChipBlue: cn(
    'border-transparent! bg-[rgb(2_132_199)] text-white dark:bg-[rgb(14_116_144)]',
  ),
  runStateChipBlueOutline: cn(
    'border-[rgb(125_211_252)]! bg-[rgb(240_249_255)] text-[rgb(3_105_161)] dark:border-[rgb(7_89_133)]!',
    'dark:bg-[rgb(8_47_73)] dark:text-[rgb(186_230_253)]',
  ),
};

const stateMeta: Readonly<
  Record<RunState, { icon: Component; iconName: string; tone: StateTone; dashed?: boolean }>
> = {
  planned: { icon: FileText, iconName: 'file-text', tone: 'outline' },
  pending: { icon: Clock, iconName: 'clock', tone: 'secondary' },
  submitted: { icon: Send, iconName: 'send', tone: 'blue' },
  queued: { icon: ListOrdered, iconName: 'list-ordered', tone: 'blue' },
  held: { icon: PauseCircle, iconName: 'pause-circle', tone: 'warning' },
  running: { icon: Loader2, iconName: 'loader-2', tone: 'blue' },
  stopping: { icon: CircleStop, iconName: 'circle-stop', tone: 'warning' },
  completed: { icon: CircleCheck, iconName: 'circle-check', tone: 'success' },
  failed: { icon: CircleX, iconName: 'circle-x', tone: 'destructive' },
  cancelled: { icon: Ban, iconName: 'ban', tone: 'secondary' },
  submission_unknown: { icon: CircleHelp, iconName: 'circle-help', tone: 'warning', dashed: true },
  terminal_unknown: { icon: CircleHelp, iconName: 'circle-help', tone: 'warning', dashed: true },
  observation_unavailable: { icon: EyeOff, iconName: 'eye-off', tone: 'secondary', dashed: true },
  supervision_lost: { icon: Unplug, iconName: 'unplug', tone: 'warning', dashed: true },
};

const props = defineProps<{
  run: RunView;
  stale?: boolean;
  explanation?: string;
  compact?: boolean;
}>();

const { t } = useI18n({ useScope: 'global' });
const tooltipOpen = shallowRef(false);
const metadata = computed(() => stateMeta[props.run.state]);
const uncertain = computed(() => Boolean(props.run.uncertainty || metadata.value.dashed));
const activity = computed(() => runActivityMessageKeysFor(props.run));
const activityLabel = computed(() => (activity.value ? t(activity.value.label) : null));
const activityHint = computed(() => (activity.value?.hint ? t(activity.value.hint) : null));
const label = computed(() => t(runStateMessageKeys[props.run.state]));

const accessibleLabel = computed(() =>
  [label.value, activityLabel.value, activityHint.value].filter(Boolean).join(' · '),
);

const chipClasses = computed(() => ({
  [cn('run-state-chip', styles.runStateChip)]: true,
  [cn(styles.runStateChipDashed)]: uncertain.value,
  [cn(styles.runStateChipDimmed)]: props.stale,
  [cn(styles.runStateChipBlue)]: metadata.value.tone === 'blue',
  [cn(styles.runStateChipBlueOutline)]:
    metadata.value.tone === 'blue' && props.run.state !== 'running',
}));

const badgeVariant = computed<'outline' | Exclude<StateTone, 'blue'>>(() =>
  metadata.value.tone === 'blue' ? 'outline' : metadata.value.tone,
);

const tooltipNeeded = computed(
  () => uncertain.value || props.stale === true || Boolean(props.explanation || activityHint.value),
);

const tooltipNotes = computed(() => [
  ...(uncertain.value || props.stale ? [t('runs.lifecycleNote')] : []),
  ...(props.explanation ? [props.explanation] : []),
  ...(activityHint.value ? [activityHint.value] : []),
]);
</script>
<template>
  <TooltipProvider>
    <span class="inline-flex flex-col items-start gap-1 min-w-0 max-w-full">
      <!-- Announce only activity transitions, not every epoch tick or every list row. -->
      <span v-if="!compact" class="sr-only" aria-live="polite" aria-atomic="true">{{
        activityLabel ?? ''
      }}</span>
      <Tooltip :open="tooltipOpen" @update:open="tooltipOpen = $event">
        <TooltipTrigger as-child>
          <Badge
            :variant="badgeVariant"
            :class="chipClasses"
            :data-run-state="run.state"
            :title="accessibleLabel"
            :data-run-icon="metadata.iconName"
            :data-effective-icon="
              run.uncertainty && run.state !== 'running' ? 'circle-help' : metadata.iconName
            "
            :data-uncertainty-icon="
              run.uncertainty && run.state === 'running' ? 'circle-help' : undefined
            "
            :data-run-tone="metadata.tone"
            :data-uncertain="uncertain ? 'true' : 'false'"
            :data-stale="stale ? 'true' : 'false'"
            :data-prefix="stale ? 'wifi-off' : undefined"
            role="note"
            @click.stop="tooltipOpen = !tooltipOpen"
            @keydown.enter.prevent.stop="tooltipOpen = !tooltipOpen"
            @keydown.space.prevent.stop="tooltipOpen = !tooltipOpen"
            :tabindex="tooltipNeeded ? 0 : undefined"
            :aria-label="`${accessibleLabel}${stale ? t('runs.stale') : ''}${run.uncertainty ? t('runs.uncertain') : ''}`"
          >
            <WifiOff v-if="stale" data-lucide-icon="wifi-off" aria-hidden="true" />
            <component
              :is="run.uncertainty && run.state !== 'running' ? CircleHelp : metadata.icon"
              :data-lucide-icon="
                run.uncertainty && run.state !== 'running' ? 'circle-help' : metadata.iconName
              "
              :class="
                run.state === 'running' ? 'animate-spin motion-reduce:animate-none' : undefined
              "
              aria-hidden="true"
            />
            <CircleHelp
              v-if="run.uncertainty && run.state === 'running'"
              data-lucide-icon="circle-help"
              aria-hidden="true"
            />
            <span>{{ activityLabel ?? label }}</span>
            <span v-if="stale">{{ t('runs.stale') }}</span>
            <span v-if="run.uncertainty">{{ t('runs.uncertain') }}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent v-if="tooltipNeeded">
          <p v-for="note in tooltipNotes" :key="note">{{ note }}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, shallowRef, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
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
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { RunState, RunView } from '../../lib/daemon-api';
import type { MetricSummary } from '../../lib/metric-history';
import { runStateMessageKeys } from '../../i18n/dynamic-keys';

type StateTone = 'outline' | 'secondary' | 'blue' | 'warning' | 'success' | 'destructive';
type StateProgress = NonNullable<MetricSummary['progress']>;

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
  progress?: StateProgress | null;
  explanation?: string;
}>();
const { t } = useI18n({ useScope: 'global' });
const tooltipOpen = shallowRef(false);
const metadata = computed(() => stateMeta[props.run.state]);
const uncertain = computed(() => Boolean(props.run.uncertainty || metadata.value.dashed));
const label = computed(() => t(runStateMessageKeys[props.run.state]));
const progressPercent = computed(() => {
  const fraction = props.progress?.fraction;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return 0;
  return Math.min(100, Math.max(0, fraction * 100));
});
const hasProgress = computed(
  () => props.run.state === 'running' && props.progress !== null && props.progress !== undefined,
);
const chipClasses = computed(() => ({
  'run-state-chip': true,
  'run-state-chip--dashed': uncertain.value,
  'run-state-chip--dimmed': props.stale,
  'run-state-chip--blue': metadata.value.tone === 'blue',
  'run-state-chip--blue-outline': metadata.value.tone === 'blue' && props.run.state !== 'running',
}));
const badgeVariant = computed<'outline' | Exclude<StateTone, 'blue'>>(() =>
  metadata.value.tone === 'blue' ? 'outline' : metadata.value.tone,
);
const tooltipNeeded = computed(
  () => uncertain.value || props.stale === true || Boolean(props.explanation),
);
const tooltipNotes = computed(() => [
  ...(uncertain.value || props.stale ? [t('runs.lifecycleNote')] : []),
  ...(props.explanation ? [props.explanation] : []),
]);
</script>
<template>
  <TooltipProvider>
    <span class="run-state-container">
      <Tooltip :open="tooltipOpen" @update:open="tooltipOpen = $event">
        <TooltipTrigger as-child>
          <Badge
            :variant="badgeVariant"
            :class="chipClasses"
            :data-run-state="run.state"
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
            :aria-label="`${label}${stale ? t('runs.stale') : ''}${run.uncertainty ? t('runs.uncertain') : ''}`"
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
            <span>{{ label }}</span>
            <span v-if="stale">{{ t('runs.stale') }}</span>
            <span v-if="run.uncertainty">{{ t('runs.uncertain') }}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent v-if="tooltipNeeded">
          <p v-for="note in tooltipNotes" :key="note">{{ note }}</p>
        </TooltipContent>
      </Tooltip>
      <div v-if="hasProgress" class="run-state-progress">
        <Progress
          :model-value="progressPercent"
          class="run-state-chip__progress"
          :aria-label="t('runs.epochProgress')"
        />
        <span>{{ t('runs.epoch', { epoch: progress?.epoch, total: progress?.totalEpochs }) }}</span>
      </div>
    </span>
  </TooltipProvider>
</template>
<style scoped>
.run-state-container {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}
.run-state-chip {
  min-height: 1.75rem;
  gap: 0.35rem;
  transition: opacity 160ms ease;
}
.run-state-chip--dashed {
  border-style: dashed;
  border-width: 2px;
}
.run-state-chip--dimmed {
  opacity: 0.58;
}
.run-state-chip--blue {
  border-color: transparent;
  background: rgb(2 132 199);
  color: white;
}
.run-state-chip--blue-outline {
  border-color: rgb(125 211 252);
  background: rgb(240 249 255);
  color: rgb(3 105 161);
}
:global(.dark) .run-state-chip--blue {
  background: rgb(14 116 144);
}
:global(.dark) .run-state-chip--blue-outline {
  border-color: rgb(7 89 133);
  background: rgb(8 47 73);
  color: rgb(186 230 253);
}
.run-state-chip__progress {
  width: 5rem;
  min-width: 5rem;
}
.run-state-progress {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--muted-foreground);
  font-size: 0.7rem;
}
@media (prefers-reduced-motion: reduce) {
  .run-state-chip {
    transition: none;
  }
}
</style>

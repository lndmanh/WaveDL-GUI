<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Check, Circle, LoaderCircle, Play, RefreshCw } from '@lucide/vue';
import type { ProjectBlock } from '../../../shared/schemas/project-draft';
import type { PlanView, RunView } from '~~/types/daemon-api';
import type { PlanCommand, ReadinessItem } from '~~/types/plan-summary';

const props = defineProps<{
  plan: PlanView | null;
  command: PlanCommand | null;
  acknowledged: RunView | null;
  readiness: readonly ReadinessItem[];
  canPreview: boolean;
  busy: boolean;
  connected: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  status: [];
  open: [];
  stop: [];
  fresh: [];
  go: [block: ProjectBlock];
}>();

const { t } = useI18n({ useScope: 'global' });
const labels = useRunLabels();
const { api, revision } = useWorkstation();

/** Only the exact plan the daemon acknowledged is locked; an edited draft plans anew. */
const submitted = computed(
  () => !!props.plan && props.acknowledged?.request_id === props.plan.request_id,
);

const projectStyles = {
  planApprove: cn(
    'min-w-48 h-[2.9rem] rounded-[0.9rem] max-sm:w-full',
    'shadow-[inset_0_1px_0_rgb(255_255_255_/_0.2),_0_8px_20px_-10px_color-mix(in_srgb,_var(--primary)_80%,_transparent)]',
  ),
  planCheck: cn(
    '[&_+_.plan-check]:[border-top:0.5px_solid_color-mix(in_srgb,_var(--foreground)_12%,_transparent)]',
  ),
  planCheckMark: cn(
    "grid size-[1.4rem] flex-none place-items-center rounded-full text-muted-foreground [&[data-done='true']]:text-white",
    "[&[data-done='true']]:bg-success [&_svg]:size-[0.8rem] [&_svg]:stroke-[3] [&[data-done='false']_svg]:size-[1.2rem]",
    "[&[data-done='false']_svg]:stroke-[1.5]",
  ),
  planCta: cn('flex flex-wrap items-center gap-4 py-[1.1rem] px-5'),
};
</script>
<template>
  <TrainingSubmitted
    v-if="submitted && acknowledged"
    :key="`${revision}:${api ? 'live' : 'offline'}:${acknowledged.run_id}`"
    :api="api"
    :acknowledged="acknowledged"
    :connected="connected"
    @open="emit('open')"
    @fresh="emit('fresh')"
  />
  <InspectorPanel
    v-else
    :title="t('builder.planTitle')"
    :description="t('builder.planDescription')"
  >
    <template v-if="plan">
      <PlanPresentation :plan="plan" :command="command" />
      <div :class="cn('surface-group', projectStyles.planCta)">
        <div class="min-w-0 flex-1 basis-56">
          <p class="text-[0.9rem] font-medium">{{ t('project.leaveDoesNotCancel') }}</p>
          <p class="text-xs text-muted-foreground">{{ t('project.planRetryHelp') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 max-sm:w-full">
          <Button v-if="busy" type="button" variant="ghost" @click="emit('stop')">
            {{ t('project.stopWaiting') }}
          </Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="emit('status')">
            <RefreshCw aria-hidden="true" />{{ t('project.checkSubmissionStatus') }}
          </Button>
          <Button
            type="button"
            size="lg"
            :class="projectStyles.planApprove"
            :disabled="busy || !connected || submitted"
            @click="emit('submit')"
          >
            <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
            <Play v-else aria-hidden="true" />
            {{ t(submitted ? 'project.submissionAcknowledged' : 'project.startTraining') }}
          </Button>
        </div>
      </div>
    </template>

    <!-- Not reviewed yet: a checklist and the review action. -->
    <template v-else>
      <div v-if="acknowledged" class="surface-group surface-row" :aria-label="t('project.lastRun')">
        <span :class="projectStyles.planCheckMark" data-done="true" aria-hidden="true"
          ><Check
        /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-xs text-muted-foreground">{{ t('project.lastRun') }}</span>
          <span class="block truncate text-[0.9rem] font-medium">{{
            labels.title(acknowledged)
          }}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-primary"
          :disabled="!connected"
          @click="emit('open')"
        >
          {{ t('project.viewRun') }}
        </Button>
      </div>
      <ul class="surface-group overflow-hidden" :aria-label="t('builder.readiness')">
        <li
          v-for="item in readiness"
          :key="item.block"
          :class="cn('plan-check surface-row', projectStyles.planCheck)"
        >
          <span :class="projectStyles.planCheckMark" :data-done="item.done" aria-hidden="true">
            <Check v-if="item.done" />
            <Circle v-else />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[0.9rem] font-medium">{{ item.label }}</span>
            <span class="block truncate text-xs text-muted-foreground">{{ item.detail }}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="text-primary"
            @click="emit('go', item.block)"
          >
            {{ item.done ? t('builder.edit') : t('builder.fix') }}
          </Button>
        </li>
      </ul>
      <div :class="cn('surface-group', projectStyles.planCta)">
        <div class="min-w-0 flex-1">
          <p class="text-[1rem] font-semibold">
            {{ canPreview ? t('builder.readyToPlan') : t('builder.notReady') }}
          </p>
          <p class="text-xs text-muted-foreground">{{ t('project.noAutomaticStart') }}</p>
        </div>
        <Button v-if="busy" type="button" variant="ghost" @click="emit('stop')">
          {{ t('project.stopWaiting') }}
        </Button>
        <Button type="submit" size="lg" :class="projectStyles.planApprove" :disabled="!canPreview">
          <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
          {{ t(busy ? 'project.waitingForDaemon' : 'builder.createPlan') }}
        </Button>
      </div>
    </template>
  </InspectorPanel>
</template>

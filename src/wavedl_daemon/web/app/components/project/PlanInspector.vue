<script setup lang="ts">
import { cn } from '@/lib/utils';
import { motion } from 'motion-v';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  LoaderCircle,
  Play,
  RefreshCw,
  TriangleAlert,
} from '@lucide/vue';
import type { ProjectBlock } from '../../../shared/schemas/project-draft';
import type { PlanView, RunView } from '../../lib/daemon-api';

export interface ReadinessItem {
  readonly block: ProjectBlock;
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
}

const props = defineProps<{
  plan: PlanView | null;
  acknowledged: RunView | null;
  readiness: readonly ReadinessItem[];
  canPreview: boolean;
  busy: boolean;
  connected: boolean;
  stateLabel: string;
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
const titleId = useId();
const settingsId = useId();
const { differences, context, sections, warnings } = usePlanSummary(() => props.plan);

const submitted = computed(
  () => !!props.plan && props.acknowledged?.request_id === props.plan.request_id,
);

const projectStyles = {
  planSuccess: cn(
    'flex flex-col items-center gap-[0.6rem] p-[2.5rem_1.5rem_2rem] text-center',
    '[background:radial-gradient(60%_80%_at_50%_0%,_color-mix(in_srgb,_var(--success)_12%,_transparent),_transparent),_var(--surface)]',
  ),
  planSuccessMark: cn('size-17 mb-2 text-success'),
  planFact: cn(
    'min-w-0 py-2',
    '[&_dt]:text-muted-foreground [&_dt]:text-[0.7rem] [&_dd]:m-[0.15rem_0_0] [&_dd]:text-[0.92rem] [&_dd]:font-semibold',
    '[&_dd]:[overflow-wrap:anywhere]',
  ),
  planDifferences: cn(
    'flex flex-col p-[0_0.5rem_0.75rem] [&_li]:grid [&_li]:items-center [&_li]:gap-[0.6rem] [&_li]:py-[0.45rem]',
    '[&_li]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:[&_li]:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto_minmax(0,0.8fr)]',
    '[&_li]:px-3 [&_li]:rounded-[0.6rem] [&_li]:text-[0.85rem]',
    '[&_li:nth-child(odd)]:[background:color-mix(in_srgb,_var(--foreground)_3%,_transparent)]',
  ),
  planDefault: cn(
    "min-w-0 overflow-hidden text-muted-foreground [font-family:ui-monospace,_'SF_Mono',_monospace] text-xs/[inherit]",
    'line-through text-ellipsis whitespace-nowrap',
  ),
  planValue: cn(
    "min-w-0 overflow-hidden [font-family:ui-monospace,_'SF_Mono',_monospace] text-[0.78rem] font-semibold",
    'text-ellipsis whitespace-nowrap',
  ),
  planSettingsTrigger: cn(
    'flex w-full items-center gap-[0.6rem] py-[0.8rem] px-5 text-[0.85rem] font-medium',
    "[&[data-state='open']_.plan-settings-chevron]:[transform:rotate(90deg)]",
  ),
  planSettingsChevron: cn(
    'size-4 text-muted-foreground [transition:transform_260ms_cubic-bezier(0.22,_1,_0.36,_1)]',
  ),
  planApprove: cn(
    'min-w-48 h-[2.9rem] rounded-[0.9rem]',
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
  <InspectorPanel :title="t('project.reviewAndStart')" :description="t('project.checkWhatWillRun')">
    <section
      v-if="submitted && acknowledged"
      :class="cn('surface-group', projectStyles.planSuccess)"
      :aria-label="t('project.trainingRunSubmitted')"
    >
      <svg :class="projectStyles.planSuccessMark" viewBox="0 0 64 64" aria-hidden="true">
        <motion.circle
          cx="32"
          cy="32"
          r="29"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          :initial="{ pathLength: 0, opacity: 0.2 }"
          :animate="{ pathLength: 1, opacity: 1 }"
          :transition="{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }"
        />
        <motion.path
          d="M20 33.5 28.5 42 44.5 24"
          fill="none"
          stroke="currentColor"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
          :initial="{ pathLength: 0 }"
          :animate="{ pathLength: 1 }"
          :transition="{ duration: 0.4, delay: 0.45, ease: 'easeOut' }"
        />
      </svg>
      <h3 class="text-[1.4rem] font-semibold tracking-[-0.02em]">
        {{ t('project.trainingRunSubmitted') }}
      </h3>
      <p class="max-w-[52ch] text-sm text-muted-foreground">
        {{
          t('project.runSubmittedOpenItToFollowProgress', {
            run: acknowledged.run_id,
            state: stateLabel,
          })
        }}
      </p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          size="lg"
          class="rounded-xl"
          :disabled="!connected"
          @click="emit('open')"
        >
          {{ t('project.viewTrainingRun') }}<ArrowRight aria-hidden="true" />
        </Button>
        <Button type="button" size="lg" variant="ghost" class="rounded-xl" @click="emit('fresh')">
          {{ t('builder.startAnother') }}
        </Button>
      </div>
    </section>

    <template v-else-if="plan">
      <section class="surface-group overflow-hidden" :aria-labelledby="titleId">
        <header class="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 text-xs font-semibold text-success">
              <Check class="size-3.5" aria-hidden="true" />{{ t('project.readyToStart') }}
            </p>
            <h3 :id="titleId" class="mt-1 text-[1.15rem] font-semibold">
              {{ t('project.reviewYourTrainingRun') }}
            </h3>
          </div>
        </header>
        <dl
          class="grid grid-cols-1 gap-x-5 px-5 pt-3 min-[400px]:grid-cols-2 lg:grid-cols-3"
          :aria-label="t('project.runSummary')"
        >
          <div v-for="item in context" :key="item.label" :class="projectStyles.planFact">
            <dt>{{ item.label }}</dt>
            <dd :title="item.fullValue">
              <span :aria-hidden="item.fullValue ? true : undefined">{{ item.value }}</span>
              <span v-if="item.fullValue" class="sr-only">{{ item.fullValue }}</span>
            </dd>
          </div>
        </dl>
        <Alert v-if="warnings.length" variant="warning" class="mx-5 mt-4 w-auto min-w-0">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{{ t('project.beforeYouStart') }}</AlertTitle>
          <AlertDescription>
            <ul class="list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
              <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
            </ul>
          </AlertDescription>
        </Alert>
        <div class="px-5 pt-5 pb-2">
          <h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {{ t('project.whatYouChanged') }}
          </h4>
        </div>
        <ul v-if="differences.length" :class="projectStyles.planDifferences">
          <li v-for="item in differences" :key="item.name">
            <span class="col-span-3 min-w-0 [overflow-wrap:anywhere] sm:col-span-1">{{ item.label }}</span>
            <span :class="projectStyles.planDefault" :title="item.defaultValue">{{
              item.defaultValue
            }}</span>
            <ArrowRight class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
            <span :class="projectStyles.planValue" :title="item.value">{{ item.value }}</span>
          </li>
        </ul>
        <p v-else class="px-5 pb-4 text-sm text-muted-foreground">
          {{ t('project.usingDefaultTrainingSettings') }}
        </p>
        <Collapsible
          v-if="sections.length"
          class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]"
        >
          <CollapsibleTrigger :id="settingsId" :class="projectStyles.planSettingsTrigger">
            <ChevronRight
              :class="cn('plan-settings-chevron', projectStyles.planSettingsChevron)"
              aria-hidden="true"
            />
            {{ t('project.allSettings') }}
          </CollapsibleTrigger>
          <CollapsibleContent class="collapsible-motion" :aria-labelledby="settingsId">
            <div class="flex min-w-0 flex-col gap-5 px-5 pb-5">
              <section
                v-for="section in sections"
                :key="section.id"
                :aria-labelledby="`${settingsId}-${section.id}`"
              >
                <h4 :id="`${settingsId}-${section.id}`" class="mb-2 text-sm font-semibold">
                  {{ section.title }}
                </h4>
                <dl class="min-w-0 divide-y divide-border">
                  <div
                    v-for="row in section.rows"
                    :key="row.name"
                    class="grid min-w-0 gap-1 py-2 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4"
                  >
                    <dt class="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                      {{ row.label }}
                    </dt>
                    <dd class="min-w-0 [overflow-wrap:anywhere]">
                      {{ row.value }}
                      <span
                        v-if="row.changed"
                        class="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />{{ t('project.changed') }}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <div class="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          :class="projectStyles.planApprove"
          :disabled="busy || !connected || submitted"
          @click="emit('submit')"
        >
          <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
          <Play v-else aria-hidden="true" />
          {{ t('project.startTraining') }}
        </Button>
        <Button type="button" variant="ghost" :disabled="busy" @click="emit('status')">
          <RefreshCw aria-hidden="true" />{{ t('project.refreshStatus') }}
        </Button>
        <Button v-if="busy" type="button" variant="ghost" @click="emit('stop')">
          {{ t('project.stopWaiting') }}
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('project.connectionDropsRefreshOrRetrySameRun') }}
        {{ t('project.leavingThisPageDoesNotStopTheRun') }}
      </p>
    </template>

    <template v-else>
      <div
        v-if="acknowledged"
        class="surface-group surface-row"
        :aria-label="t('project.trainingRunSubmitted')"
      >
        <span :class="projectStyles.planCheckMark" data-done="true" aria-hidden="true"
          ><Check
        /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[0.9rem] font-medium">{{
            t('project.trainingRunSubmitted')
          }}</span>
          <span class="block truncate font-mono text-xs text-muted-foreground">{{
            acknowledged.run_id
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
          {{ t('project.viewTrainingRun') }}
        </Button>
      </div>
      <ul class="surface-group overflow-hidden" :aria-label="t('project.beforeYouReview')">
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
            {{ canPreview ? t('project.readyToReview') : t('project.finishTheStepsAbove') }}
          </p>
          <p class="text-xs text-muted-foreground">{{ t('project.noAutomaticStart') }}</p>
        </div>
        <Button v-if="busy" type="button" variant="ghost" @click="emit('stop')">
          {{ t('project.stopWaiting') }}
        </Button>
        <Button type="submit" size="lg" :class="projectStyles.planApprove" :disabled="!canPreview">
          <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
          {{ t(busy ? 'project.checkingYourSettings' : 'project.reviewTraining') }}
        </Button>
      </div>
    </template>
  </InspectorPanel>
</template>

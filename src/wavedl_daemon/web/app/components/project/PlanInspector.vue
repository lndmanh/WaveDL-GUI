<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { motion } from 'motion-v';
import { ArrowRight, Check, ChevronRight, Circle, LoaderCircle, Play, RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ProjectBlock } from '../../../shared/schemas/project-draft';
import type { PlanView, RunView } from '../../lib/daemon-api';
import { usePlanSummary } from '../../composables/usePlanSummary';
import InspectorPanel from './InspectorPanel.vue';

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
const rawId = useId();
const { manifest, differences, context, rawPlan } = usePlanSummary(() => props.plan);
/** Only the exact plan the daemon acknowledged is locked; an edited draft plans anew. */
const submitted = computed(
  () => !!props.plan && props.acknowledged?.request_id === props.plan.request_id,
);
</script>
<template>
  <InspectorPanel :title="t('builder.planTitle')" :description="t('builder.planDescription')">
    <!-- Acknowledged: the daemon accepted this exact plan. -->
    <section
      v-if="submitted && acknowledged"
      class="surface-group plan-success"
      :aria-label="t('project.acknowledgedTrainingRun')"
    >
      <svg class="plan-success-mark" viewBox="0 0 64 64" aria-hidden="true">
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
        {{ t('project.daemonAcknowledgedTheRun') }}
      </h3>
      <p class="max-w-[52ch] text-sm text-muted-foreground">
        {{ t('project.submissionAckHelp', { run: acknowledged.run_id, state: stateLabel }) }}
      </p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <Button type="button" size="lg" class="rounded-xl" :disabled="!connected" @click="emit('open')">
          {{ t('project.openAcknowledgedRun') }}<ArrowRight aria-hidden="true" />
        </Button>
        <Button type="button" size="lg" variant="ghost" class="rounded-xl" @click="emit('fresh')">
          {{ t('builder.startAnother') }}
        </Button>
      </div>
    </section>

    <!-- Planned: review what the daemon will run, then approve. -->
    <template v-else-if="plan">
      <section class="surface-group overflow-hidden" aria-labelledby="approved-plan-title">
        <header class="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 text-xs font-semibold text-success">
              <Check class="size-3.5" aria-hidden="true" />{{ t('builder.planReady') }}
            </p>
            <h3 id="approved-plan-title" class="mt-1 text-[1.15rem] font-semibold">
              {{ t('project.persistedPlanForApproval') }}
            </h3>
            <p class="mt-1 font-mono text-[0.68rem] break-all text-muted-foreground">
              {{
                t('project.runRunRequestRequestPlanPlan', {
                  run: plan.run_id,
                  request: plan.request_id,
                  plan: plan.plan_id,
                })
              }}
            </p>
          </div>
        </header>
        <dl class="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-4" :aria-label="t('project.planContext')">
          <div v-for="item in context" :key="item.label" class="plan-stat">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
        <div class="px-5 pt-5 pb-2">
          <h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {{ t('builder.changesFromDefaults') }}
          </h4>
        </div>
        <ul v-if="differences.length" class="plan-differences">
          <li v-for="item in differences" :key="item.name">
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <span class="plan-default">{{ item.defaultValue }}</span>
            <ArrowRight class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
            <span class="plan-value">{{ item.value }}</span>
          </li>
        </ul>
        <p v-else class="px-5 pb-4 text-sm text-muted-foreground">
          {{ t('project.noPlanDifferences') }}
        </p>
        <Collapsible class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]">
          <CollapsibleTrigger
            :id="rawId"
            class="plan-raw-trigger"
            data-testid="plan-raw-disclosure"
          >
            <ChevronRight class="plan-raw-chevron" aria-hidden="true" />
            {{ t('project.fullPersistedExecutionPlan') }}
          </CollapsibleTrigger>
          <CollapsibleContent class="collapsible-motion">
            <div class="flex flex-col gap-3 px-5 pb-5">
              <div
                v-if="manifest"
                class="plan-code"
                tabindex="0"
                :aria-label="t('project.approvedNormalizedManifest')"
                data-testid="approved-manifest"
              >
                {{ JSON.stringify(manifest, null, 2) }}
              </div>
              <pre class="plan-code" tabindex="0" :aria-label="t('project.persistedExecutionPlan')">{{
                rawPlan
              }}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <div class="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          class="plan-approve"
          :disabled="busy || !connected || submitted"
          @click="emit('submit')"
        >
          <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
          <Play v-else aria-hidden="true" />
          {{ t(submitted ? 'project.submissionAcknowledged' : 'project.approveAndStartThisPlan') }}
        </Button>
        <Button type="button" variant="ghost" :disabled="busy" @click="emit('status')">
          <RefreshCw aria-hidden="true" />{{ t('project.checkSubmissionStatus') }}
        </Button>
        <Button v-if="busy" type="button" variant="ghost" @click="emit('stop')">
          {{ t('project.stopWaiting') }}
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('project.planRetryHelp') }} {{ t('project.leaveDoesNotCancel') }}
      </p>
    </template>

    <!-- Not planned yet: a readiness checklist and the planning action. -->
    <template v-else>
      <div
        v-if="acknowledged"
        class="surface-group surface-row"
        :aria-label="t('project.acknowledgedTrainingRun')"
      >
        <span class="plan-check-mark" data-done="true" aria-hidden="true"><Check /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[0.9rem] font-medium">{{ t('project.daemonAcknowledgedTheRun') }}</span>
          <span class="block truncate font-mono text-xs text-muted-foreground">{{
            acknowledged.run_id
          }}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" class="text-primary" :disabled="!connected" @click="emit('open')">
          {{ t('project.openAcknowledgedRun') }}
        </Button>
      </div>
      <ul class="surface-group overflow-hidden" :aria-label="t('builder.readiness')">
        <li v-for="item in readiness" :key="item.block" class="plan-check surface-row">
          <span class="plan-check-mark" :data-done="item.done" aria-hidden="true">
            <Check v-if="item.done" />
            <Circle v-else />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[0.9rem] font-medium">{{ item.label }}</span>
            <span class="block truncate text-xs text-muted-foreground">{{ item.detail }}</span>
          </span>
          <Button type="button" variant="ghost" size="sm" class="text-primary" @click="emit('go', item.block)">
            {{ item.done ? t('builder.edit') : t('builder.fix') }}
          </Button>
        </li>
      </ul>
      <div class="plan-cta surface-group">
        <div class="min-w-0 flex-1">
          <p class="text-[1rem] font-semibold">
            {{ canPreview ? t('builder.readyToPlan') : t('builder.notReady') }}
          </p>
          <p class="text-xs text-muted-foreground">{{ t('project.noAutomaticStart') }}</p>
        </div>
        <Button v-if="busy" type="button" variant="ghost" @click="emit('stop')">
          {{ t('project.stopWaiting') }}
        </Button>
        <Button type="submit" size="lg" class="plan-approve" :disabled="!canPreview">
          <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
          {{ t(busy ? 'project.waitingForDaemon' : 'builder.createPlan') }}
        </Button>
      </div>
    </template>
  </InspectorPanel>
</template>
<style>
.plan-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2.5rem 1.5rem 2rem;
  text-align: center;
  background:
    radial-gradient(60% 80% at 50% 0%, color-mix(in srgb, var(--success) 12%, transparent), transparent),
    var(--surface);
}
.plan-success-mark {
  width: 4.25rem;
  height: 4.25rem;
  margin-bottom: 0.5rem;
  color: var(--success);
}
.plan-stat {
  padding: 0.6rem 0.75rem;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--foreground) 4.5%, transparent);
}
.plan-stat dt {
  color: var(--muted-foreground);
  font-size: 0.7rem;
}
.plan-stat dd {
  margin: 0.15rem 0 0;
  font-size: 0.92rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.plan-differences {
  display: flex;
  flex-direction: column;
  padding: 0 0.5rem 0.75rem;
}
.plan-differences li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.75rem;
  border-radius: 0.6rem;
  font-size: 0.85rem;
}
.plan-differences li:nth-child(odd) {
  background: color-mix(in srgb, var(--foreground) 3%, transparent);
}
.plan-default {
  max-width: 30%;
  overflow: hidden;
  color: var(--muted-foreground);
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 0.75rem;
  text-decoration: line-through;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-value {
  max-width: 40%;
  overflow: hidden;
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 0.78rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-raw-trigger {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 500;
}
.plan-raw-chevron {
  width: 1rem;
  height: 1rem;
  color: var(--muted-foreground);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.plan-raw-trigger[data-state='open'] .plan-raw-chevron {
  transform: rotate(90deg);
}
.plan-code {
  max-height: 18rem;
  overflow: auto;
  padding: 0.9rem 1rem;
  border-radius: 0.75rem;
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 0.72rem;
  white-space: pre-wrap;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.plan-approve {
  min-width: 12rem;
  height: 2.9rem;
  border-radius: 0.9rem;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.2),
    0 8px 20px -10px color-mix(in srgb, var(--primary) 80%, transparent);
}
.plan-check + .plan-check {
  border-top: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
}
.plan-check-mark {
  display: grid;
  width: 1.4rem;
  height: 1.4rem;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--muted-foreground);
}
.plan-check-mark[data-done='true'] {
  color: #fff;
  background: var(--success);
}
.plan-check-mark svg {
  width: 0.8rem;
  height: 0.8rem;
  stroke-width: 3;
}
.plan-check-mark[data-done='false'] svg {
  width: 1.2rem;
  height: 1.2rem;
  stroke-width: 1.5;
}
.plan-cta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
}
</style>

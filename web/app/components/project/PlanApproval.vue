<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { validateJson, type Json, type JsonObject, type PlanView } from '../../lib/daemon-api';
import { trainingDefaults } from '../../../shared/schemas/training-request';
import { inferenceDefaults } from '../../../shared/schemas/result-request';
import { trainingFieldMessageKeys } from '../../i18n/dynamic-keys';
import InfoChip from '../common/InfoChip.vue';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ plan: PlanView; busy: boolean; acknowledged?: boolean }>();
const rawDisclosureId = useId();
defineEmits<{ submit: []; status: [] }>();

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const manifest = computed<JsonObject | null>(() => {
  const raw = props.plan.preview.manifest_json;
  if (typeof raw !== 'string') return null;
  try {
    const value: Json = JSON.parse(raw);
    validateJson(value);
    return object(value) ? value : null;
  } catch {
    return null;
  }
});

const config = computed(() => {
  const value = manifest.value?.resolved_config;
  return object(value) ? value : {};
});

function equal(left: Json, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function display(value: Json | undefined): string {
  if (value === undefined || value === null) return t('project.none');
  if (Array.isArray(value))
    return value.length ? value.map((item) => display(item)).join(', ') : t('project.none');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const differences = computed(() =>
  Object.entries(config.value)
    .filter(([name, value]) => {
      const defaults = manifest.value?.operation === 'train' ? trainingDefaults : inferenceDefaults;
      if (!Object.hasOwn(defaults, name)) return false;
      return !equal(value, Object.entries(defaults).find(([key]) => key === name)?.[1]);
    })
    .map(([name, value]) => ({
      name,
      label: trainingFieldMessageKeys[name] ? t(trainingFieldMessageKeys[name].label) : name,
      value: display(value),
      defaultValue: display(
        Object.entries(
          manifest.value?.operation === 'train' ? trainingDefaults : inferenceDefaults,
        ).find(([key]) => key === name)?.[1] as Json,
      ),
    })),
);

function text(value: Json | undefined): string {
  return typeof value === 'string' ? value : t('project.notAvailable');
}

const runtime = computed(() => {
  const value = manifest.value?.runtime;
  return object(value) ? value : {};
});
const topology = computed(() => {
  const value = props.plan.preview.topology;
  return object(value) ? value : {};
});
const context = computed(() => [
  { label: t('project.contextBackend'), value: text(props.plan.preview.target) },
  { label: t('project.contextOperation'), value: text(manifest.value?.operation) },
  { label: t('project.contextDevice'), value: text(runtime.value.device) },
  {
    label: t('project.contextTopology'),
    value: `${display(topology.value.num_machines)} × ${display(topology.value.processes_per_machine)}`,
  },
]);
const rawPlan = computed(() => JSON.stringify(props.plan.preview, null, 2));
</script>

<template>
  <section aria-labelledby="approved-plan-title" class="flex flex-col gap-5 border-t pt-6">
    <header class="flex flex-col gap-3">
      <h2 id="approved-plan-title" class="text-xl font-medium">
        {{ t('project.persistedPlanForApproval') }}
      </h2>
      <p class="font-mono text-xs text-muted-foreground">
        {{
          t('project.runRunRequestRequestPlanPlan', {
            run: plan.run_id,
            request: plan.request_id,
            plan: plan.plan_id,
          })
        }}
      </p>
      <InfoChip
        :label="t('project.planScopeChip')"
        :text="t('project.planManifestDetailsFull')"
        uncertain
      />
      <p class="text-sm text-muted-foreground">{{ t('project.planManifestHelp') }}</p>
    </header>
    <div class="flex flex-wrap gap-2" :aria-label="t('project.planContext')">
      <Badge v-for="item in context" :key="item.label" variant="outline">
        {{ item.label }}: {{ item.value }}
      </Badge>
    </div>
    <div v-if="differences.length" class="grid gap-3 sm:grid-cols-2">
      <Card v-for="item in differences" :key="item.name" class="min-w-0">
        <CardHeader class="pb-2">
          <CardTitle class="break-words text-sm">{{ item.label }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-2 text-sm">
          <p class="break-all font-medium">{{ item.value }}</p>
          <p class="text-xs text-muted-foreground">
            {{ t('project.defaultValue', { value: item.defaultValue }) }}
          </p>
        </CardContent>
      </Card>
    </div>
    <Empty v-else>
      <EmptyDescription>{{ t('project.noPlanDifferences') }}</EmptyDescription>
    </Empty>
    <Collapsible>
      <CollapsibleTrigger
        class="flex w-full items-center justify-between text-left font-medium"
        data-testid="plan-raw-disclosure"
        :id="rawDisclosureId"
      >
        {{ t('project.fullPersistedExecutionPlan') }}
      </CollapsibleTrigger>
      <CollapsibleContent class="pt-3">
        <div
          v-if="manifest"
          class="mb-4 max-h-64 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs whitespace-pre-wrap"
          tabindex="0"
          :aria-label="t('project.approvedNormalizedManifest')"
          data-testid="approved-manifest"
        >
          {{ JSON.stringify(manifest, null, 2) }}
        </div>
        <pre
          class="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs"
          tabindex="0"
          :aria-label="t('project.persistedExecutionPlan')"
          >{{ rawPlan }}</pre>
      </CollapsibleContent>
    </Collapsible>
    <div class="flex flex-wrap gap-3">
      <Button type="button" :disabled="busy || acknowledged" @click="$emit('submit')">
        {{ t(acknowledged ? 'project.submissionAcknowledged' : 'project.approveAndStartThisPlan') }}
      </Button>
      <Button type="button" variant="outline" :disabled="busy" @click="$emit('status')">
        {{ t('project.checkSubmissionStatus') }}
      </Button>
      <Badge variant="secondary">{{ t('project.planRetryHelp') }}</Badge>
      <Badge variant="outline">{{ t('project.leaveDoesNotCancel') }}</Badge>
    </div>
  </section>
</template>

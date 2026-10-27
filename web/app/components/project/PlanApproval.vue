<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { validateJson, type PlanView, type Json } from '../../lib/daemon-api';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ plan: PlanView; busy: boolean; acknowledged?: boolean }>();
defineEmits<{ submit: []; status: [] }>();
const preview = computed(() => JSON.stringify(props.plan.preview, null, 2));
const manifest = computed(() => {
  const raw = props.plan.preview.manifest_json;
  if (typeof raw !== 'string') return '';
  try {
    const value: Json = JSON.parse(raw);
    validateJson(value);
    return JSON.stringify(value, null, 2);
  } catch {
    return raw;
  }
});
</script>
<template>
  <section aria-labelledby="approved-plan-title" class="flex flex-col gap-4 border-t pt-6">
    <h2 id="approved-plan-title" class="text-xl font-medium">
      {{ t('project.persistedPlanForApproval') }}
    </h2>
    <p>
      {{
        t('project.runRunRequestRequestPlanPlan', {
          run: plan.run_id,
          request: plan.request_id,
          plan: plan.plan_id,
        })
      }}
    </p>
    <p>
      {{ t('project.planManifestHelp') }}
    </p>
    <pre
      v-if="manifest"
      class="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs"
      tabindex="0"
      :aria-label="t('project.approvedNormalizedManifest')"
      >{{ manifest }}</pre>
    <details>
      <summary>{{ t('project.fullPersistedExecutionPlan') }}</summary>
      <pre
        class="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs"
        tabindex="0"
        :aria-label="t('project.persistedExecutionPlan')"
        >{{ preview }}</pre>
    </details>
    <div class="flex flex-wrap gap-3">
      <Button type="button" :disabled="busy || acknowledged" @click="$emit('submit')">{{
        t(acknowledged ? 'project.submissionAcknowledged' : 'project.approveAndStartThisPlan')
      }}</Button
      ><Button type="button" variant="outline" :disabled="busy" @click="$emit('status')">{{
        t('project.checkSubmissionStatus')
      }}</Button>
    </div>
    <p class="text-sm text-muted-foreground">
      {{ t('project.planRetryHelp') }}
    </p>
  </section>
</template>

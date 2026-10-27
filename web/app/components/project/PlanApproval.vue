<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { validateJson, type PlanView, type Json } from '../../lib/daemon-api';

const { t, translateKnownMessage } = useWorkstationI18n(projectMessages);
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
      {{ translateKnownMessage('Persisted plan for approval') }}
    </h2>
    <p>
      {{
        t('Run {run} · request {request} · plan {plan}', {
          run: plan.run_id,
          request: plan.request_id,
          plan: plan.plan_id,
        })
      }}
    </p>
    <p>
      {{
        translateKnownMessage(
          "This is the daemon's immutable normalized configuration, manifest, paths, command and warnings—not a prediction from your draft. Read it before starting. Submission sends only this exact plan ID.",
        )
      }}
    </p>
    <pre
      v-if="manifest"
      class="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs"
      tabindex="0"
      :aria-label="translateKnownMessage('Approved normalized manifest')"
      >{{ manifest }}</pre>
    <details>
      <summary>{{ translateKnownMessage('Full persisted execution plan') }}</summary>
      <pre
        class="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs"
        tabindex="0"
        :aria-label="translateKnownMessage('Persisted execution plan')"
        >{{ preview }}</pre>
    </details>
    <div class="flex flex-wrap gap-3">
      <Button type="button" :disabled="busy || acknowledged" @click="$emit('submit')">{{
        translateKnownMessage(
          acknowledged ? 'Submission acknowledged' : 'Approve and start this plan',
        )
      }}</Button
      ><Button type="button" variant="outline" :disabled="busy" @click="$emit('status')">{{
        translateKnownMessage('Check submission status')
      }}</Button>
    </div>
    <p class="text-sm text-muted-foreground">
      {{
        translateKnownMessage(
          'If acknowledgment is lost, check status or retry this same approved plan. Leaving this page stops browser waiting, never cancels server work.',
        )
      }}
    </p>
  </section>
</template>

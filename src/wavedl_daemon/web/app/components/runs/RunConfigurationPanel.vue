<script setup lang="ts">
import { Check, Copy, CopyPlus, LoaderCircle, RefreshCw, TriangleAlert } from '@lucide/vue';
import { DaemonApiError } from '../../lib/daemon-api';
import { planManifestSchema } from '../../../shared/schemas/plan-summary';
import { storedTrainingCommand } from '../../lib/run-clone';
import type { PlanView, RunView } from '~~/types/daemon-api';
import type { PlanCommand } from '~~/types/plan-summary';

const props = defineProps<{ run: RunView; active: boolean }>();
const { t, locale } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { api, state, revision, reportFailure } = useWorkstation();
const router = useRouter();
const shellNavigate = useShellNavigation();
const { isActive } = usePageActive();
const resourceActive = computed(() => isActive.value && props.active);
const clone = useRunClone();
const labels = useRunLabels();
const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1600 });
const plan = shallowRef<PlanView | null>(null);
const loading = shallowRef(false);
const error = shallowRef('');
const cloneError = shallowRef('');
const cloning = shallowRef(false);
const retry = shallowRef(0);

watch(
  [
    resourceActive,
    () => props.run.run_id,
    () => props.run.plan_id,
    () => props.run.request_id,
    api,
    revision,
    () => state.value.status,
    retry,
  ],
  async (_value, _previous, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const run = props.run;
    const current = plan.value;

    // Refetches for the same run keep the loaded plan on screen and swap it in place.
    if (
      current &&
      (current.run_id !== run.run_id ||
        current.plan_id !== run.plan_id ||
        current.request_id !== run.request_id)
    ) {
      plan.value = null;
      cloneError.value = '';
    }

    if (!plan.value) error.value = '';
    loading.value = false;

    const client = api.value;

    if (!resourceActive.value || state.value.status !== 'connected' || !client) return;
    loading.value = !plan.value;

    try {
      const result = await client.getRunPlan(run.run_id, controller.signal);

      if (controller.signal.aborted || !resourceActive.value) return;

      if (
        result.run_id !== run.run_id ||
        result.plan_id !== run.plan_id ||
        result.request_id !== run.request_id
      )
        throw new Error(t('project.configurationMismatch'));
      plan.value = result;
      error.value = '';
    } catch (failure) {
      if (controller.signal.aborted || !resourceActive.value) return;

      if (!plan.value)
        error.value = clientMessage(failure instanceof Error ? failure : String(failure));

      if (failure instanceof DaemonApiError) reportFailure.value(failure);
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  },
  { immediate: true, flush: 'sync' },
);

const document = computed(() => {
  const parsed = planManifestSchema.safeParse(plan.value?.preview.spec);

  return parsed.success ? parsed.data : null;
});

const canClone = computed(
  () => props.run.operation === 'train' && document.value?.review.operation === 'train',
);

const command = computed<PlanCommand | null>(() => {
  if (!plan.value) return null;

  try {
    const text = storedTrainingCommand(plan.value);

    return text ? { ok: true, text } : { ok: false, reason: t('project.storedCommandUnavailable') };
  } catch {
    return { ok: false, reason: t('project.storedCommandUnavailable') };
  }
});

const facts = computed(() => {
  const created = props.run.created_at;
  const date = created ? new Date(created) : null;

  return [
    {
      label: t('project.contextOperation'),
      value: document.value?.review.operation ? null : labels.operation(props.run),
    },
    {
      label: t('project.contextBackend'),
      value: plan.value?.preview.target ? null : props.run.backend,
    },
    {
      label: t('project.runAttempt'),
      value: props.run.attempt == null ? t('runs.notAllocated') : String(props.run.attempt),
    },
    {
      label: t('project.runCreated'),
      value: date && Number.isFinite(date.getTime()) ? date.toLocaleString(locale.value) : created,
    },
    { label: t('project.runSource'), value: props.run.summary?.source_run_id },
  ].filter((fact): fact is { label: string; value: string } => !!fact.value);
});

async function cloneRun() {
  const stored = plan.value;
  const daemonId = state.value.health?.daemon_id;

  if (!resourceActive.value || !stored || !daemonId || !canClone.value || cloning.value) return;
  cloneError.value = '';
  cloning.value = true;

  try {
    if (!clone.prepare(stored, daemonId)) {
      cloneError.value = t('project.cloneUnavailable');

      return;
    }

    let landed: string;

    if (shellNavigate) landed = await shellNavigate('/new');
    else {
      await router.push('/new');
      landed = router.currentRoute.value.path;
    }

    if (landed !== '/new') {
      clone.clear();
      cloneError.value = t('project.cloneUnavailable');
    }
  } catch (failure) {
    clone.clear();
    cloneError.value = clientMessage(failure instanceof Error ? failure : String(failure));
  } finally {
    cloning.value = false;
  }
}
</script>

<template>
  <div class="@container flex min-w-0 flex-col gap-4">
    <section class="surface-group min-w-0 overflow-hidden" :aria-label="t('project.runDetails')">
      <div v-if="canClone" class="flex justify-end px-5 pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="cloning || state.status !== 'connected'"
          @click="cloneRun"
        >
          <LoaderCircle v-if="cloning" class="animate-spin" aria-hidden="true" />
          <CopyPlus v-else aria-hidden="true" />{{ t('project.cloneConfiguration') }}
        </Button>
      </div>
      <dl v-if="facts.length" class="grid grid-cols-1 gap-3 px-5 pt-4 @min-[24rem]:grid-cols-2">
        <div v-for="fact in facts" :key="fact.label" class="min-w-0 text-sm">
          <dt class="text-xs text-muted-foreground">{{ fact.label }}</dt>
          <dd class="mt-1 [overflow-wrap:anywhere]">{{ fact.value }}</dd>
        </div>
      </dl>
      <div
        class="mt-4 flex min-w-0 items-center gap-2 border-t px-5 py-2 text-xs text-muted-foreground"
      >
        <span class="shrink-0">{{ t('runs.configRunId') }}</span>
        <code class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ run.run_id }}</code>
        <Button
          v-if="canCopy"
          type="button"
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          :aria-label="t('runs.copyRunId')"
          @click="copy(run.run_id)"
        >
          <Check v-if="copied" aria-hidden="true" /><Copy v-else aria-hidden="true" />
        </Button>
        <span class="sr-only" aria-live="polite">{{ copied ? t('runs.runIdCopied') : '' }}</span>
      </div>
    </section>
    <Alert v-if="cloneError" variant="destructive" role="alert">
      <TriangleAlert aria-hidden="true" /><AlertTitle>{{
        t('project.cloneUnavailable')
      }}</AlertTitle>
      <AlertDescription>{{ cloneError }}</AlertDescription>
    </Alert>
    <div
      v-if="loading"
      class="surface-group flex items-center gap-2 p-5 text-sm text-muted-foreground"
      role="status"
    >
      <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />{{
        t('project.loadingConfiguration')
      }}
    </div>
    <Alert v-else-if="error" variant="destructive" role="alert">
      <TriangleAlert aria-hidden="true" /><AlertTitle>{{
        t('project.configurationUnavailable')
      }}</AlertTitle>
      <AlertDescription class="min-w-0 [overflow-wrap:anywhere]">
        <p>{{ error }}</p>
        <Button type="button" variant="outline" size="sm" class="mt-3" @click="retry++"
          ><RefreshCw aria-hidden="true" />{{ t('project.retryConfiguration') }}</Button
        >
      </AlertDescription>
    </Alert>
    <PlanPresentation v-else-if="plan" :plan="plan" :command="command" full-settings />
    <p v-else class="surface-group p-5 text-sm text-muted-foreground" role="status">
      {{ t('project.configurationOffline') }}
    </p>
  </div>
</template>

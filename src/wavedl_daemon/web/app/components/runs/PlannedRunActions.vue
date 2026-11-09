<script setup lang="ts">
import { LoaderCircle, Pencil, Play, Trash2, TriangleAlert } from '@lucide/vue';
import { ConnectionSessionError } from '../../lib/connection-session';
import type { RunView } from '~~/types/daemon-api';

const props = defineProps<{ run: RunView }>();
const emit = defineEmits<{ changed: [message?: string]; deleted: [] }>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { session, state, revision } = useWorkstation();
const liveRuns = useLiveRuns();
const { isActive } = usePageActive();
const router = useRouter();
const navigate = useShellNavigation();
const clone = useRunClone();
const binding = usePlannedRunBinding();
const busy = shallowRef(false);
const confirming = shallowRef(false);
const error = shallowRef('');
const available = computed(() => isActive.value && state.value.status === 'connected');
let pending: AbortController | null = null;

watch(
  [isActive, revision, () => props.run.run_id],
  () => {
    pending?.abort();
    pending = null;
    busy.value = false;
    confirming.value = false;
    error.value = '';
  },
  { flush: 'sync' },
);

onBeforeUnmount(() => pending?.abort());

async function perform(action: 'start' | 'edit' | 'delete') {
  const run = props.run;
  const daemonId = state.value.health?.daemon_id;

  if (busy.value || !available.value || !daemonId) return;

  if (action === 'edit' && run.operation !== 'train') return;
  const controller = new AbortController();
  pending = controller;
  busy.value = true;
  error.value = '';

  try {
    if (action === 'delete') {
      await toRaw(session).perform(
        async (api, signal) => {
          await api.deleteRun(run.run_id, signal);
          binding.unbind(daemonId, run.run_id);
        },
        { signal: controller.signal },
      );

      if (controller.signal.aborted) return;
      confirming.value = false;
      emit('deleted');

      return;
    }

    const plan = await toRaw(session).perform(
      async (api, signal) => {
        const stored =
          action === 'start'
            ? await api.approveRunPlan(run.run_id, signal)
            : await api.getRunPlan(run.run_id, signal);

        // Do not start a configuration that changed since the user reviewed this detail.
        if (stored.plan_id !== run.plan_id || stored.request_id !== run.request_id) return null;

        if (action === 'start') {
          await api.submit(stored, signal);
          liveRuns.refresh();
          binding.unbind(daemonId, run.run_id);
        }

        return stored;
      },
      { signal: controller.signal },
    );

    if (controller.signal.aborted) return;

    if (!plan) {
      error.value = t('runs.planChanged');
      emit('changed', error.value);

      return;
    }

    if (action === 'start') {
      emit('changed');

      return;
    }

    if (!clone.prepare(plan, daemonId, true)) {
      error.value = t('project.cloneUnavailable');

      return;
    }

    let landed: string;

    if (navigate) landed = await navigate('/new');
    else {
      await router.push('/new');
      landed = router.currentRoute.value.path;
    }

    if (landed !== '/new') {
      clone.clear();
      error.value = t('project.cloneUnavailable');
    }
  } catch (failure) {
    if (controller.signal.aborted) return;

    if (action === 'edit') clone.clear();

    const status =
      failure instanceof ConnectionSessionError && failure.code === 'request'
        ? failure.status
        : undefined;

    if (status === 404) {
      if (action === 'delete') {
        binding.unbind(daemonId, run.run_id);
        confirming.value = false;
        emit('deleted');
      } else {
        error.value = t('runs.planChanged');
        emit('changed', error.value);
      }
    } else {
      error.value =
        status === 409
          ? t('runs.planStarted')
          : clientMessage(failure instanceof Error ? failure : String(failure));

      if (status === 409) emit('changed', error.value);
    }
  } finally {
    if (pending === controller) {
      busy.value = false;
      pending = null;
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Button :disabled="busy || !available" @click="perform('start')">
        <LoaderCircle
          v-if="busy"
          class="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <Play v-else aria-hidden="true" />{{
          t(run.operation === 'train' ? 'project.startTraining' : 'runs.startRun')
        }}
      </Button>
      <Button
        v-if="run.operation === 'train'"
        variant="outline"
        :disabled="busy || !available"
        @click="perform('edit')"
      >
        <Pencil aria-hidden="true" />{{ t('runs.editPlanned') }}
      </Button>
      <AlertDialog v-model:open="confirming">
        <AlertDialogTrigger as-child>
          <Button variant="outline" class="text-destructive" :disabled="busy || !available">
            <Trash2 aria-hidden="true" />{{ t('runs.deletePlanned') }}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('runs.deletePlanTitle') }}</AlertDialogTitle>
            <AlertDialogDescription>{{ t('runs.deletePlanHelp') }}</AlertDialogDescription>
          </AlertDialogHeader>
          <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
          <AlertDialogFooter>
            <AlertDialogCancel :disabled="busy">{{ t('runs.keepPlan') }}</AlertDialogCancel>
            <Button variant="destructive" :disabled="busy || !available" @click="perform('delete')">
              {{ t('runs.deletePlanned') }}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    <Alert v-if="error" variant="warning" role="status">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
  </div>
</template>

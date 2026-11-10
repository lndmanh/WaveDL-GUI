<script setup lang="ts">
import { DaemonApiError, isUuid } from '../../lib/daemon-api';
import { isTestRun, testLocation } from '../../lib/test-runs';

defineOptions({ name: 'WorkstationTestDetailPage' });
const { isActive } = usePageActive();

definePageMeta({
  key: 'test-detail',
  title: 'shell.tests',
  breadcrumb: 'shell.tests',
  fullWidth: true,
  fillHeight: true,
});

const { state, api, session, reportFailure } = useWorkstation();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const router = useRouter();
const requestedId = computed(() => {
  const route = router.currentRoute.value;
  const id = route.params.testId;

  return isActive.value && typeof id === 'string' && (route.path === `/tests/${id}` || route.path === `/tests/${id}/`) ? id : null;
});
const runId = shallowRef<string | null>(null);
const message = shallowRef<Error | null>(null);
const retry = shallowRef(0);
const back = computed(() => ({ label: t('results.testsPageTitle'), to: '/tests' }));

watch([requestedId, api, () => state.value.revision, retry], async ([id, client], _previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  runId.value = null;
  message.value = null;

  if (!id) return;

  if (!isUuid(id)) {
    void navigateTo('/tests', { replace: true });

    return;
  }

  if (!client) return;

  try {
    const run = await client.getRun(id, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));

    if (controller.signal.aborted) return;

    if (!isTestRun(run) || run.summary?.source_run_id) void navigateTo(testLocation(run), { replace: true });
    else runId.value = id;
  } catch (error) {
    if (controller.signal.aborted) return;

    if (error instanceof DaemonApiError && error.status === 404) void navigateTo('/tests', { replace: true });
    else {
      message.value = error instanceof Error ? error : new Error(String(error));

      if (error instanceof DaemonApiError) reportFailure.value(error);
    }
  }
}, { immediate: true, flush: 'sync' });
</script>

<template>
  <ShellPage :panel-tabs="[]" data-work-page="tests">
    <TestDetail
      v-if="api && runId"
      :key="`${state.health?.daemon_id}:${state.revision}:${runId}`"
      :api="api"
      :session="session"
      :run-id="runId"
      :back="back"
    />
    <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <NuxtLink to="/tests" class="self-start text-sm text-muted-foreground hover:text-foreground">{{ back.label }}</NuxtLink>
      <Alert v-if="message" variant="warning" role="status">
        <AlertDescription>
          {{ clientMessage(message) }}
          <Button type="button" variant="outline" size="sm" @click="retry++">{{ t('results.refresh') }}</Button>
        </AlertDescription>
      </Alert>
      <p v-else role="status" class="text-sm text-muted-foreground">{{ t('results.loadingRuns') }}</p>
    </div>
  </ShellPage>
</template>

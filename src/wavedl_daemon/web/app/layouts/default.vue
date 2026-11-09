<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { CLIENT_BUILD_ID } from '../lib/build-identity';
import type { DaemonApiError } from '../lib/daemon-api';
import { applyAppearance, loadAppearance } from '../lib/preferences';
import { authRedirect } from '../lib/auth-routing';
import { navigationPath, runIdForPath, sectionForPath, sectionPath } from '../shell/sections';
import { connectionStatusKey } from '../constants/shellConnection';
import type { AppearancePreferences } from '~~/types/preferences';

const router = useRouter();
const route = useRoute();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();

// Last run opened in Experiments or Results; nav between them keeps it, a reconnect drops it.
const currentRun = shallowRef<string | null>(null);

watch(
  () => runIdForPath(route.path),
  (runId) => {
    if (runId) currentRun.value = runId;
  },
  { immediate: true },
);

provideShellRouting(
  computed(() => route.path),
  async (path, preserveRun = true) => {
    await router.push(preserveRun ? navigationPath(path, currentRun.value) : path);

    // useRoute() lags until the page renders; the router's current route does not.
    return router.currentRoute.value.path;
  },
);

const connection = useDaemonConnection({
  origin: import.meta.client ? window.location.origin : 'http://127.0.0.1',
  buildId: CLIENT_BUILD_ID,
});

const { state, api } = connection;
const auth = useWorkstationAuth();
const appearance = shallowRef(loadAppearance());

// The incoming page needs shell providers before Nuxt's deferred route updates.
const section = computed(() => sectionForPath(router.currentRoute.value.path));

provideWorkstationLocale(computed(() => appearance.value.language));

useHead(() => ({ htmlAttrs: { lang: appearance.value.language } }));

const reportFailure = computed(() => {
  const revision = state.value.revision;

  return (error: DaemonApiError) => connection.session.reportFailure(error, revision);
});

const revision = computed(() => state.value.revision);

watch(
  [() => state.value.status, () => route.fullPath, () => auth.value.resumePending],
  ([status, path, resumePending]) => {
    const redirect = authRedirect(path, status, resumePending);

    if (redirect && route.fullPath !== redirect) {
      void router.replace(redirect);
    }
  },
  { immediate: true },
);

watch(
  () => state.value.revision,
  () => {
    currentRun.value = null;
  },
);

function appearanceChanged(value: AppearancePreferences): void {
  appearance.value = value;
  refreshAppearance();
}

async function monitorRun(runId: string): Promise<void> {
  await router.push(sectionPath('experiments', runId));
  liveRuns.refresh();
}

const context = {
  connection,
  state,
  api,
  session: connection.session,
  reportFailure,
  revision,
  appearance,
  appearanceChanged,
  monitorRun,
};

provideWorkstation(context);

const liveRuns = provideLiveRuns({ api, reportFailure, state, section });

let systemTheme: MediaQueryList | null = null;

function refreshAppearance(): void {
  if (import.meta.client)
    applyAppearance(appearance.value, document.documentElement, systemTheme?.matches ?? false);
}

onMounted(() => {
  systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', refreshAppearance);
  refreshAppearance();
});

onScopeDispose(() => systemTheme?.removeEventListener('change', refreshAppearance));
</script>

<template>
  <WorkstationShell v-if="section !== 'connection'" :status="state.status" :section="section">
    <Alert
      v-if="state.message"
      data-connection-notice
      role="alert"
      :variant="state.status === 'skew' ? 'warning' : 'default'"
    >
      <TriangleAlert aria-hidden="true" />
      <AlertTitle v-if="state.status === 'skew'">{{
        t('shell.connectionIdentityChanged')
      }}</AlertTitle>
      <AlertDescription>{{ clientMessage(state.message) }}</AlertDescription>
    </Alert>
    <slot />
    <BuildSkewPrompt :visible="state.buildMismatch === true" />
  </WorkstationShell>
  <div v-else class="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background">
    <span class="sr-only" aria-live="polite" aria-atomic="true">{{
      t(connectionStatusKey[state.status])
    }}</span>
    <slot />
    <BuildSkewPrompt :visible="state.buildMismatch === true" />
  </div>
</template>

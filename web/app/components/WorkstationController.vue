<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import { useHead } from '#app';
import type { DaemonApiError, RunView } from '../lib/daemon-api';
import { CLIENT_BUILD_ID } from '../lib/build-identity';
import { useDaemonConnection } from '../composables/useDaemonConnection';
import { useAutomaticPlots } from '../composables/useAutomaticPlots';
import { provideWorkstationLocale } from '../composables/useWorkstationI18n';
import WorkstationShell from './WorkstationShell.vue';
import ConnectionPanel from './ConnectionPanel.vue';
import RunsWorkspace from './runs/RunsWorkspace.vue';
import BuildSkewPrompt from './BuildSkewPrompt.vue';
import AutomaticPlotStatus from './results/AutomaticPlotStatus.vue';
import { applyAppearance, loadAppearance, type AppearancePreferences } from '../lib/preferences';
const ProjectContainer = defineAsyncComponent(() => import('./project/ProjectContainer.vue'));
const DatasetsWorkspace = defineAsyncComponent(() => import('./datasets/DatasetsWorkspace.vue'));
const ResultsContainer = defineAsyncComponent(() => import('./results/ResultsContainer.vue'));
const SettingsWorkspace = defineAsyncComponent(() => import('./settings/SettingsWorkspace.vue'));
const AdoptRunPanel = defineAsyncComponent(() => import('./runs/AdoptRunPanel.vue'));

const connection = useDaemonConnection({
  origin: typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin,
  buildId: CLIENT_BUILD_ID,
});
const { state, api, keepSignedIn } = connection;
const automaticPlots = useAutomaticPlots(connection.session);
const automaticPlotState = automaticPlots.state;
const section = shallowRef<
  'experiments' | 'project' | 'datasets' | 'results' | 'settings' | 'adopt' | 'connection'
>('experiments');
const appearance = shallowRef(loadAppearance());
provideWorkstationLocale(computed(() => appearance.value.language));
// Keep the head manager in sync too: its deferred startup render otherwise
// restores the generated shell's English fallback after applyAppearance runs.
useHead(() => ({ htmlAttrs: { lang: appearance.value.language } }));
let systemTheme: MediaQueryList | null = null;
function refreshAppearance() {
  if (typeof document !== 'undefined')
    applyAppearance(appearance.value, document.documentElement, systemTheme?.matches ?? false);
}
function appearanceChanged(value: AppearancePreferences) {
  appearance.value = value;
  refreshAppearance();
}
onMounted(() => {
  systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', refreshAppearance);
  refreshAppearance();
});
onScopeDispose(() => systemTheme?.removeEventListener('change', refreshAppearance));
const projectOpened = shallowRef(false);
const adoptionOpened = shallowRef(false);
const datasetsOpened = shallowRef(false);
const resultsOpened = shallowRef(false);
const submittedRun = shallowRef<string | null>(null);
watch(section, (value) => {
  if (value === 'project') projectOpened.value = true;
  if (value === 'adopt') adoptionOpened.value = true;
  if (value === 'datasets') datasetsOpened.value = true;
  if (value === 'results') resultsOpened.value = true;
});
watch(
  () => state.value.revision,
  () => {
    submittedRun.value = null;
  },
);
function submitted(run: RunView) {
  submittedRun.value = run.run_id;
  section.value = 'experiments';
}
function monitorRun(runId: string) {
  submittedRun.value = runId;
  section.value = 'experiments';
}
const reportFailure = computed(() => {
  const revision = state.value.revision;
  return (error: DaemonApiError) => connection.session.reportFailure(error, revision);
});
</script>

<template>
  <WorkstationShell :status="state.status" :section="section" @navigate="section = $event">
    <AutomaticPlotStatus
      :state="automaticPlotState"
      @retry="automaticPlots.retry"
      @stop="automaticPlots.stop"
      @monitor="monitorRun"
    />
    <ConnectionPanel
      v-if="section === 'connection' || (!api && section !== 'settings')"
      :state="state"
      :keep-signed-in="keepSignedIn"
      @connect="connection.connect"
      @reconnect="connection.reconnect"
      @update:keep-signed-in="connection.setKeepSignedIn"
      @detach="connection.detach"
      @refresh="connection.refresh"
    />
    <ProjectContainer
      v-if="projectOpened"
      v-show="!!api && section === 'project'"
      :session="connection.session"
      @submitted="submitted"
      @submitted-plan="automaticPlots.capture"
    />
    <DatasetsWorkspace
      v-if="datasetsOpened && !!api"
      v-show="section === 'datasets'"
      :key="`datasets:${state.revision}`"
      :session="connection.session"
    >
    </DatasetsWorkspace>
    <AdoptRunPanel
      v-if="adoptionOpened"
      v-show="!!api && section === 'adopt'"
      :session="connection.session"
      @adopted-run-id="monitorRun"
    />
    <RunsWorkspace
      v-if="!!api"
      v-show="section === 'experiments'"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :api="api"
      :initial-run-id="submittedRun"
      @connection-error="reportFailure"
      @run-selected="submittedRun = $event"
    />
    <ResultsContainer
      v-if="resultsOpened && !!api"
      v-show="section === 'results'"
      :key="`results:${state.revision}`"
      :session="connection.session"
      :run-id="submittedRun"
      @run-selected="monitorRun"
    />
    <SettingsWorkspace
      v-if="section === 'settings'"
      :daemon-id="state.health?.daemon_id ?? null"
      :appearance="appearance"
      @appearance-changed="appearanceChanged"
    />
    <BuildSkewPrompt :visible="state.buildMismatch === true" />
  </WorkstationShell>
</template>

<script setup lang="ts">
import { Activity, ArrowRight, ChevronRight } from '@lucide/vue';
import { AnimatePresence, motion } from 'motion-v';
import { ACTIVE_RUNS_VISIBLE } from '../../constants/shellSidebar';
import { isTestRun, parentTitle } from '../../lib/test-runs';
import type { RunView } from '~~/types/daemon-api';
import ShellSidebarItem from './ShellSidebarItem.vue';
import type { WorkstationSection } from '~~/types/shell';

const props = defineProps<{ collapsed: boolean; countDisplay: string }>();
const emit = defineEmits<{ navigate: [section: WorkstationSection]; dismiss: [] }>();
const { t } = useI18n({ useScope: 'global' });
const { runs, count } = useLiveRuns();
const preferences = useShellPreferencesStore();
const { monitorRun } = useWorkstation();
const labels = useRunLabels();
const reducedMotion = useReducedMotion();
const listId = useId();
const open = computed(() => preferences.sidebar.activeRunsOpen);
const transition = computed(() => ({ duration: reducedMotion.value ? 0 : 0.2 }));

const visibleRuns = computed(() =>
  runs.value.slice(0, ACTIVE_RUNS_VISIBLE).map((run) => {
    const label = isTestRun(run)
      ? t('runs.testOf', { name: parentTitle(run) ?? labels.title(run) })
      : labels.title(run);

    const detail = run.progress
      ? t('runs.epoch', { epoch: run.progress.epoch, total: run.progress.totalEpochs })
      : labels.stateLabel(run);

    const fraction = run.progress ? Math.min(1, Math.max(0, run.progress.fraction)) : null;

    return { run, label, detail, fraction, tooltip: `${label} · ${detail}` };
  }),
);

function selectRun(run: RunView): void {
  emit('dismiss');
  void monitorRun(run);
}
</script>

<template>
  <div v-if="count > 0" class="shell-sidebar-active-runs">
    <ShellSidebarItem
      id="active-runs"
      :icon="Activity"
      :label="t('shell.activeRuns')"
      :accessible-name="t(open ? 'shell.hideActiveRuns' : 'shell.showActiveRuns')"
      :tooltip="t('shell.activeRunsCount', { count: props.countDisplay })"
      :collapsed="props.collapsed"
      :expanded="open"
      :controls="listId"
      @select="preferences.setActiveRunsOpen(!open)"
    >
      <ChevronRight class="shell-sidebar-chevron size-3.5" :class="{ 'rotate-90': open }" aria-hidden="true" />
    </ShellSidebarItem>
    <div :id="listId">
      <AnimatePresence :initial="false">
        <motion.ul
          v-if="open"
          key="active-runs"
          class="shell-sidebar-run-list"
          :aria-label="t('shell.activeRuns')"
          :initial="{ height: 0, opacity: 0 }"
          :animate="{ height: 'auto', opacity: 1 }"
          :exit="{ height: 0, opacity: 0 }"
          :transition="transition"
        >
          <motion.li
            v-for="item in visibleRuns"
            :key="item.run.run_id"
            :layout="reducedMotion ? false : 'position'"
            :initial="false"
            :transition="transition"
          >
            <Tooltip :disabled="!props.collapsed">
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  class="shell-sidebar-row shell-sidebar-run"
                  :aria-label="item.tooltip"
                  @click="selectRun(item.run)"
                >
                  <span class="shell-sidebar-icon" aria-hidden="true">
                    <svg class="shell-sidebar-run-ring size-5" viewBox="0 0 24 24">
                      <circle class="shell-sidebar-ring-track" cx="12" cy="12" r="9" />
                      <circle
                        v-if="item.fraction !== null"
                        class="shell-sidebar-ring-value"
                        cx="12"
                        cy="12"
                        r="9"
                        pathLength="100"
                        :stroke-dasharray="`${item.fraction * 100} 100`"
                        transform="rotate(-90 12 12)"
                      />
                    </svg>
                  </span>
                  <span class="shell-sidebar-label shell-sidebar-run-label">
                    <span class="shell-sidebar-run-name">{{ item.label }}</span>
                    <span v-if="item.fraction !== null" class="shell-sidebar-progress" aria-hidden="true">
                      <span :style="{ width: `${item.fraction * 100}%` }" />
                    </span>
                    <span class="shell-sidebar-run-detail">{{ item.detail }}</span>
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent v-if="props.collapsed" side="right" :side-offset="10">
                {{ item.tooltip }}
              </TooltipContent>
            </Tooltip>
          </motion.li>
          <motion.li v-if="count > ACTIVE_RUNS_VISIBLE" :layout="reducedMotion ? false : 'position'" :initial="false" :transition="transition">
            <ShellSidebarItem
              id="all-active-runs"
              :icon="ArrowRight"
              :label="t('shell.viewAllActiveRuns', { count: props.countDisplay })"
              :collapsed="props.collapsed"
              @select="emit('navigate', 'experiments')"
            />
          </motion.li>
        </motion.ul>
      </AnimatePresence>
    </div>
  </div>
</template>

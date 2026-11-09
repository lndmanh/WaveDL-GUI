<script setup lang="ts">
import { AnimatePresence, motion, useReducedMotion } from 'motion-v';
import { durationText } from '@/lib/run-overview';
import { cn } from '@/lib/utils';
import type { MetricsWaitingStage } from '@/lib/metrics-chart-waiting';

const props = defineProps<{
  stage: MetricsWaitingStage;
  channelLabel: string;
  visible: boolean;
}>();

const styles = {
  root: cn('relative grid min-h-40 min-w-0 flex-1 place-items-center pb-6 pl-9 pr-2 pt-2'),
  frame: cn('pointer-events-none absolute bottom-6 left-9 right-2 top-2'),
  gridline: cn('absolute inset-x-0 h-px bg-border'),
  yTick: cn('absolute -left-[30px] h-1.5 w-5 -translate-y-1/2 rounded bg-muted'),
  xTick: cn('absolute -bottom-4 h-1.5 w-4 -translate-x-1/2 rounded bg-muted'),
  card: cn(
    'relative flex w-full max-w-[360px] min-w-0 flex-col items-center gap-2.5',
    'rounded-xl border border-border/70 bg-card/55 px-[18px] py-3.5 text-center backdrop-blur-[8px] backdrop-saturate-[1.15]',
    'reduce-transparency:bg-card reduce-transparency:backdrop-filter-none',
  ),
  title: cn('inline-flex min-w-0 items-center justify-center gap-2 text-[13.5px] font-medium text-foreground'),
  track: cn('m-0 grid w-full grid-cols-3 gap-1.5 p-0'),
  segment: cn('flex min-w-0 flex-col items-start gap-1.5 text-left text-[11.5px] text-muted-foreground'),
  bar: cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted'),
  fill: cn('absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500 ease-in-out motion-reduce:transition-none'),
  shine: cn(
    'absolute inset-0',
    '[background:linear-gradient(90deg,transparent,color-mix(in_oklch,var(--primary)_45%,transparent),transparent)]',
    '[animation:metrics-waiting-shimmer_1.5s_linear_infinite] motion-reduce:animate-none',
  ),
  detail: cn('m-0 text-balance text-[12.5px] text-muted-foreground tabular-nums'),
};

const { t, locale } = useI18n({ useScope: 'global' });
const reducedMotion = useReducedMotion();
const gridlines = [0, 25, 50, 75, 100];
const ticks = [0, 20, 40, 60, 80, 100];
const steps = computed(() => [t('runs.submitted'), t('runs.metricsTrainingStep'), t('runs.metricsChartStep')]);

const clock = useNow({
  controls: true,
  scheduler: (tick) => useIntervalFn(tick, 1000, { immediate: false }),
});

const { isActive } = usePageActive();
const mounted = shallowRef(false);

onMounted(() => {
  mounted.value = true;
});

watch(
  () => mounted.value && props.visible && isActive.value && props.stage.step === 1 && props.stage.startedAt !== null,
  (ticking) => {
    if (ticking) {
      clock.now.value = new Date();
      clock.resume();
    } else clock.pause();
  },
  { immediate: true, flush: 'sync' },
);

const detail = computed(() => {
  if (props.stage.step === 0) return t('runs.metricsWaitingTrainer');
  const description = t('runs.metricsFirstEpoch', { channel: props.channelLabel });

  if (props.stage.startedAt === null) return description;
  const elapsed = durationText((clock.now.value.getTime() - props.stage.startedAt) / 1000, locale.value);

  return t('runs.metricsWaitingElapsed', { detail: description, elapsed });
});
</script>

<template>
  <div :class="styles.root">
    <div :class="styles.frame" aria-hidden="true">
      <template v-for="position in gridlines" :key="position">
        <span :class="styles.gridline" :style="{ top: `${position}%` }" />
        <span :class="styles.yTick" :style="{ top: `${position}%` }" />
      </template>
      <span v-for="position in ticks" :key="position" :class="styles.xTick" :style="{ left: `${position}%` }" />
    </div>
    <div role="status" aria-live="polite" :class="styles.card">
      <div :class="styles.title">
        <Spinner variant="wave" size="sm" class="shrink-0 text-primary" aria-hidden="true" />
        <AnimatePresence :initial="false" mode="wait">
          <motion.span
            :key="stage.titleKey"
            :initial="{ opacity: 0, y: 4 }"
            :animate="{ opacity: 1, y: 0 }"
            :exit="{ opacity: 0, y: -4 }"
            :transition="{ duration: reducedMotion || !visible || !isActive ? 0 : 0.2 }"
          >{{ t(stage.titleKey) }}</motion.span>
        </AnimatePresence>
      </div>
      <ol :class="styles.track">
        <li
          v-for="(label, index) in steps"
          :key="index"
          :aria-current="index === stage.step ? 'step' : undefined"
          :class="cn(styles.segment, index <= stage.step && 'text-foreground', index === stage.step && 'font-medium')"
        >
          <span :class="styles.bar" aria-hidden="true">
            <span :class="cn(styles.fill, index < stage.step ? 'w-full' : 'w-0')" />
            <span v-if="index === stage.step" :class="styles.shine" />
          </span>
          <span>{{ label }}</span>
        </li>
      </ol>
      <p :class="styles.detail">{{ detail }}</p>
    </div>
  </div>
</template>

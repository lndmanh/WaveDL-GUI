<script setup lang="ts">
import { cn } from '@/lib/utils';

// Mirrors EvaluationResultsPanel so the scorecard replaces it without a layout jump.
const styles = {
  shimmer: cn(
    "relative animate-none overflow-hidden after:absolute after:inset-0 after:content-['']",
    'after:[background:linear-gradient(90deg,transparent,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]',
    'after:[animation:metrics-waiting-shimmer_1.5s_linear_infinite] motion-reduce:after:hidden',
  ),
  card: cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4'),
  ring: cn(
    'size-14 shrink-0 rounded-full',
    '[mask:radial-gradient(circle,transparent_18.5px,#000_19px,#000_25px,transparent_25.5px)]',
  ),
};

const { t } = useI18n({ useScope: 'global' });
const cards = ['r2_score', 'pearson_corr', 'rmse', 'mae_avg'];
const parameters = ['w-20', 'w-16', 'w-24', 'w-14'];
</script>

<template>
  <div role="status" class="flex min-w-0 flex-col">
    <span class="sr-only">{{ t('results.metricsPending') }}</span>
    <div class="flex min-w-0 flex-col gap-5" aria-hidden="true">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col">
          <Skeleton :class="cn(styles.shimmer, 'my-1 h-5 w-40')" />
          <Skeleton :class="cn(styles.shimmer, 'mt-2 h-4 w-72 max-w-full')" />
        </div>
        <Skeleton :class="cn(styles.shimmer, 'h-8 w-32')" />
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="card in cards" :key="card" :class="styles.card">
          <Skeleton :class="cn(styles.shimmer, 'my-0.5 h-4 w-20')" />
          <div class="flex items-center gap-3">
            <Skeleton v-if="card === 'r2_score'" :class="cn(styles.shimmer, styles.ring)" />
            <div class="flex min-w-0 flex-1 flex-col gap-2.5">
              <Skeleton :class="cn(styles.shimmer, 'h-7 w-20 max-w-full')" />
              <Skeleton :class="cn(styles.shimmer, 'h-3 w-24 max-w-full')" />
            </div>
          </div>
          <div class="mt-auto flex min-h-10 items-center border-t pt-2.5">
            <Skeleton :class="cn(styles.shimmer, 'h-3 w-full')" />
          </div>
        </div>
      </div>
      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div class="min-w-0 rounded-xl border bg-card p-4">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Skeleton :class="cn(styles.shimmer, 'h-4 w-28')" />
            <Skeleton :class="cn(styles.shimmer, 'h-8 w-36')" />
          </div>
          <ul class="flex flex-col gap-3">
            <li
              v-for="width in parameters"
              :key="width"
              class="flex flex-col gap-2 border-b pb-2.5 last:border-b-0"
            >
              <div class="flex items-center justify-between gap-3">
                <Skeleton :class="cn(styles.shimmer, 'h-3', width)" />
                <Skeleton :class="cn(styles.shimmer, 'h-4 w-12')" />
              </div>
              <Skeleton :class="cn(styles.shimmer, 'h-1.5 w-full rounded-full')" />
            </li>
          </ul>
        </div>
        <div class="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div class="flex items-center justify-between gap-2 px-4 py-3">
            <Skeleton :class="cn(styles.shimmer, 'h-4 w-36')" />
            <Skeleton :class="cn(styles.shimmer, 'size-8')" />
          </div>
          <div class="border-t">
            <Skeleton :class="cn(styles.shimmer, 'aspect-[4/3] w-full rounded-none')" />
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-3">
        <Skeleton :class="cn(styles.shimmer, 'my-0.5 h-4 w-24')" />
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="plot in 3"
            :key="plot"
            class="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card"
            :class="plot > 1 ? 'max-sm:hidden' : ''"
          >
            <Skeleton :class="cn(styles.shimmer, 'aspect-[4/3] w-full rounded-none')" />
            <div class="flex flex-col gap-1.5 border-t px-3 py-2.5">
              <Skeleton :class="cn(styles.shimmer, 'h-3.5 w-32 max-w-full')" />
              <Skeleton :class="cn(styles.shimmer, 'h-3 w-24 max-w-full')" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

import type { RunState, RunView } from '~~/types/daemon-api';
import type {
  RunCreatedFilter,
  RunFilter,
  RunFilterCounts,
  RunFilterOption,
  RunFilterState,
  RunGroupKey,
  RunGroup,
  RunKind,
} from '~~/types/run-overview';

const LIVE_STATES: ReadonlySet<RunState> = new Set([
  'pending',
  'submitted',
  'queued',
  'held',
  'running',
  'stopping',
]);

const ATTENTION_STATES: ReadonlySet<RunState> = new Set([
  'failed',
  'submission_unknown',
  'terminal_unknown',
  'observation_unavailable',
  'supervision_lost',
]);

const DAY = 86_400_000;

export const RUN_KINDS: readonly RunKind[] = [
  'training',
  'evaluation',
  'evaluation-plots',
  'onnx-export',
  'plot',
];

export function runKindOf(run: RunView): RunKind {
  if (run.operation === 'train') return 'training';

  if (run.operation === 'plot') return 'plot';

  // Export is the primary output even when a test also requests plots.
  if (run.summary?.export) return 'onnx-export';

  return run.summary?.plot ? 'evaluation-plots' : 'evaluation';
}

export function createRunFilters(): RunFilterState {
  return { kinds: [], states: [], models: [], datasets: [], created: 'any' };
}

/** Each selected value counts once; the single created-time choice counts once. */
export function activeRunFilterCount(filters: RunFilterState): number {
  return (
    filters.kinds.length +
    filters.states.length +
    filters.models.length +
    filters.datasets.length +
    Number(filters.created !== 'any')
  );
}

/** OR within a group, AND across groups; search is applied separately with runMatches. */
export function runMatchesFilters(run: RunView, filters: RunFilterState, now: Date): boolean {
  if (filters.kinds.length && !filters.kinds.includes(runKindOf(run))) return false;
  const state = runFilterOf(run);

  if (filters.states.length && (!state || !filters.states.includes(state))) return false;

  if (filters.models.length && !filters.models.includes(run.summary?.model ?? '')) return false;

  if (filters.datasets.length && !filters.datasets.includes(pathName(run.summary?.data_path)))
    return false;

  return runMatchesCreated(run, filters.created, now);
}

function runMatchesCreated(run: RunView, filter: RunCreatedFilter, now: Date): boolean {
  if (filter === 'any') return true;
  const created = runCreatedAt(run)?.getTime();
  const end = now.getTime();
  const start = filter === 'today' ? startOfDay(now) : end - (filter === 'week' ? 7 : 30) * DAY;

  // Today uses local midnight; the other windows are rolling 7/30 days. Missing,
  // invalid and future dates never match a bounded creation-time filter.
  return created !== undefined && created >= start && created <= end;
}

/** Counts always describe the full loaded page, independent of filters and search. */
export function runFilterCounts(runs: readonly RunView[], now: Date): RunFilterCounts {
  const kinds: Record<RunKind, number> = {
    training: 0,
    evaluation: 0,
    'evaluation-plots': 0,
    'onnx-export': 0,
    plot: 0,
  };

  const models = new Map<string, number>();
  const datasets = new Map<string, number>();

  const created: Record<RunCreatedFilter, number> = {
    any: runs.length,
    today: 0,
    week: 0,
    month: 0,
  };

  const windows: readonly RunCreatedFilter[] = ['today', 'week', 'month'];

  for (const run of runs) {
    kinds[runKindOf(run)]++;
    const model = run.summary?.model;
    const dataset = pathName(run.summary?.data_path);

    if (model) models.set(model, (models.get(model) ?? 0) + 1);

    if (dataset) datasets.set(dataset, (datasets.get(dataset) ?? 0) + 1);

    for (const window of windows) {
      if (runMatchesCreated(run, window, now)) created[window]++;
    }
  }

  function options(counts: ReadonlyMap<string, number>): RunFilterOption[] {
    return [...counts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({ value, count }));
  }

  return {
    kinds,
    states: runCounts(runs),
    models: options(models),
    datasets: options(datasets),
    created,
  };
}

export function runFilterOf(run: RunView): Exclude<RunFilter, 'all'> | null {
  if (run.state === 'planned') return 'planned';

  if (LIVE_STATES.has(run.state)) return 'live';

  if (ATTENTION_STATES.has(run.state)) return 'attention';

  return run.state === 'completed' ? 'completed' : null;
}

export function runCounts(runs: readonly RunView[]): Record<RunFilter, number> {
  const counts: Record<RunFilter, number> = {
    all: runs.length,
    planned: 0,
    live: 0,
    completed: 0,
    attention: 0,
  };

  for (const run of runs) {
    const filter = runFilterOf(run);

    if (filter) counts[filter]++;
  }

  return counts;
}

export function runCreatedAt(run: RunView): Date | null {
  const date = new Date(run.created_at ?? '');

  return Number.isNaN(date.getTime()) ? null : date;
}

/** Final path segment of a host path, for either separator; empty when there is none. */
export function pathName(path: string | null | undefined): string {
  return (
    (path ?? '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  );
}

export function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

/** Case-insensitive match over the run identity and caller-supplied visible labels. */
export function runMatches(run: RunView, query: string, labels: readonly string[] = []): boolean {
  const needle = query.trim().toLowerCase();

  if (!needle) return true;

  return [
    run.run_id,
    run.summary?.name,
    run.summary?.model,
    pathName(run.summary?.data_path),
    ...labels,
  ].some((value) => value != null && value.toLowerCase().includes(needle));
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Live runs first, then calendar buckets newest-first. The daemon pages oldest-first, so
 * undated runs keep their reversed page order inside "earlier".
 */
export function groupRuns(runs: readonly RunView[], now: Date): RunGroup[] {
  const today = startOfDay(now);
  const order: RunGroupKey[] = ['live', 'today', 'yesterday', 'week', 'earlier'];

  const buckets = new Map<RunGroupKey, { run: RunView; time: number; index: number }[]>(
    order.map((key) => [key, []]),
  );

  runs.forEach((run, index) => {
    const time = runCreatedAt(run)?.getTime() ?? Number.NEGATIVE_INFINITY;

    const key: RunGroupKey = LIVE_STATES.has(run.state)
      ? 'live'
      : time >= today
        ? 'today'
        : time >= today - DAY
          ? 'yesterday'
          : time >= today - 6 * DAY
            ? 'week'
            : 'earlier';

    buckets.get(key)?.push({ run, time, index });
  });

  return order.flatMap((key) => {
    const entries = buckets.get(key) ?? [];

    if (!entries.length) return [];
    entries.sort((a, b) => b.time - a.time || b.index - a.index);

    return [{ key, runs: entries.map((entry) => entry.run) }];
  });
}

/** "3 minutes ago"-style text, choosing the largest sensible unit. */
export function relativeTime(
  date: Date,
  now: Date,
  locale: string,
  style: Intl.RelativeTimeFormatStyle = 'long',
): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }

  return format.format(0, 'second');
}

/** Decimal file sizes, capped at gigabytes, with at most one fractional digit. */
export function formatBytes(bytes: number, locale: string): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;

  const [unit, divisor]: [string, number] =
    size >= 1_000_000_000
      ? ['gigabyte', 1_000_000_000]
      : size >= 1_000_000
        ? ['megabyte', 1_000_000]
        : size >= 1_000
          ? ['kilobyte', 1_000]
          : ['byte', 1];

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(size / divisor);
}

/** Two most significant units of a duration, e.g. "1h 12m" or "4m 5s". */
export function durationText(totalSeconds: number, locale: string): string {
  const seconds = Math.max(0, Math.round(totalSeconds));

  const parts: [Intl.NumberFormatOptions['unit'], number][] = [
    ['hour', Math.floor(seconds / 3600)],
    ['minute', Math.floor((seconds % 3600) / 60)],
    ['second', seconds % 60],
  ];

  const first = parts.findIndex(([, value]) => value > 0);

  return parts
    .slice(first === -1 ? 2 : first, first === -1 ? 3 : first + 2)
    .map(([unit, value]) =>
      new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value),
    )
    .join(' ');
}

/** Remaining training time from the mean observed epoch; null until it is meaningful. */
export function remainingSeconds(
  progress: { epoch: number; totalEpochs: number } | null,
  elapsedSeconds: number | null,
): number | null {
  if (!progress || elapsedSeconds === null || progress.epoch < 1) return null;
  const remaining = progress.totalEpochs - progress.epoch;

  if (remaining <= 0 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;

  return (elapsedSeconds / progress.epoch) * remaining;
}

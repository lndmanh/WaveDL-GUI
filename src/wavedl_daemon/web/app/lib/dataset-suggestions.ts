import { pathName, runCreatedAt } from './run-overview';
import type { RunView } from '~~/types/daemon-api';
import type { DatasetSuggestion } from '~~/types/dataset-suggestions';

export function datasetFormat(path: string): string | null {
  const extension = path.match(/\.(npz|mat|h5|hdf5)$/i)?.[1]?.toUpperCase();

  return extension === 'HDF5' ? 'H5' : (extension ?? null);
}

/** Run summaries are advisory: callers must resolve each path in the current session. */
export function datasetSuggestions(runs: readonly RunView[]): DatasetSuggestion[] {
  const groups = new Map<string, DatasetSuggestion & { order: number }>();
  const seen = new Set<string>();

  runs.forEach((run, order) => {
    if (seen.has(run.run_id)) return;
    seen.add(run.run_id);
    const path = run.summary?.data_path;
    const format = path ? datasetFormat(path) : null;

    if (!path || !format) return;
    const key = path.replaceAll('\\', '/');
    const previous = groups.get(key);
    const date = runCreatedAt(run);
    const newer = (date?.getTime() ?? -Infinity) >= (previous?.lastUsed?.getTime() ?? -Infinity);

    groups.set(key, {
      path: newer ? path : (previous?.path ?? path),
      name: pathName(path),
      format,
      count: (previous?.count ?? 0) + 1,
      lastUsed: newer ? date : (previous?.lastUsed ?? null),
      order: Math.max(previous?.order ?? 0, order),
    });
  });

  return [...groups.values()]
    .sort((a, b) => {
      const time = (b.lastUsed?.getTime() ?? -Infinity) - (a.lastUsed?.getTime() ?? -Infinity);

      return Number.isNaN(time) || time === 0 ? b.order - a.order : time;
    })
    .map(({ order: _order, ...suggestion }) => suggestion);
}

export function datasetInputDimensions(dimensions: readonly number[]): string {
  return dimensions.length ? dimensions.join(' × ') : '1';
}

export function datasetOutputValues(dimensions: readonly number[]): number | null {
  const count = dimensions.reduce((product, size) => product * size, 1);

  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

import { CatalogApi } from './catalog-api';
import type { ConnectionSession } from './connection-session';
import { pathName, runCreatedAt } from './run-overview';
import type { DataSelection } from '~~/types/catalog-api';
import type { ResolvedDatasetSuggestion } from '~~/types/dataset-browser';
import type { RunView } from '~~/types/daemon-api';
import type { DatasetSuggestion } from '~~/types/dataset-suggestions';

export function datasetFormat(path: string): string | null {
  const extension = path.match(/\.(npz|mat|h5|hdf5)$/i)?.[1]?.toUpperCase();

  return extension === 'HDF5' ? 'H5' : (extension ?? null);
}

const SUGGESTION_LIMIT = 4;
const RUN_PAGE_SIZE = 100;
// Limit optional suggestions to recent history even when runs reuse the same dataset.
export const MAX_RECENT_DATASET_RUNS = 300;
// Stale paths must not cause an unbounded series of catalog requests.
export const MAX_FAILED_DATASET_SUGGESTIONS = 8;

/** Newest-first summaries are advisory: callers must resolve paths in the current session. */
export function datasetSuggestions(runs: readonly RunView[]): DatasetSuggestion[] {
  const groups = new Map<string, DatasetSuggestion>();
  const seen = new Set<string>();

  for (const run of runs) {
    if (seen.has(run.run_id)) continue;
    seen.add(run.run_id);
    const path = run.summary?.data_path;
    const format = path ? datasetFormat(path) : null;

    if (!path || !format) continue;
    const key = path.replaceAll('\\', '/');
    const previous = groups.get(key);

    if (previous) groups.set(key, { ...previous, count: previous.count + 1 });
    else groups.set(key, { path, name: pathName(path), format, count: 1, lastUsed: runCreatedAt(run) });
  }

  return [...groups.values()];
}

export async function loadDatasetSuggestions(
  session: ConnectionSession,
  roots: readonly string[],
  signal: AbortSignal,
): Promise<ResolvedDatasetSuggestion[]> {
  signal.throwIfAborted();

  if (!roots.length) return [];
  const api = new CatalogApi(session);
  const seen = new Set<string>();
  const resolved: ResolvedDatasetSuggestion[] = [];
  let locations: readonly DataSelection[] | undefined;
  let failures = 0;

  for (let offset = 0; offset < MAX_RECENT_DATASET_RUNS; offset += RUN_PAGE_SIZE) {
    const page = await session.perform(
      (api, requestSignal) => api.listRuns({ limit: RUN_PAGE_SIZE, offset, signal: requestSignal }),
      { signal },
    );
    signal.throwIfAborted();

    for (const suggestion of datasetSuggestions(page)) {
      signal.throwIfAborted();
      const key = suggestion.path.replaceAll('\\', '/');

      if (seen.has(key)) continue;
      seen.add(key);
      locations ??= await api.locations(signal, roots);

      try {
        const selection = await api.locate(suggestion.path, signal, locations);

        if (selection?.kind === 'file' && datasetFormat(selection.path))
          resolved.push({ ...suggestion, selection });
        else failures++;
      } catch (error) {
        if (signal.aborted) throw error;
        failures++;
      }

      signal.throwIfAborted();

      if (resolved.length === SUGGESTION_LIMIT || failures === MAX_FAILED_DATASET_SUGGESTIONS)
        return resolved;
    }

    if (page.length < RUN_PAGE_SIZE) break;
  }

  signal.throwIfAborted();

  return resolved;
}

export function datasetInputDimensions(dimensions: readonly number[]): string {
  return dimensions.length ? dimensions.join(' × ') : '1';
}

export function datasetOutputValues(dimensions: readonly number[]): number | null {
  const count = dimensions.reduce((product, size) => product * size, 1);

  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

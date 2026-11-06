import type { RunView } from './daemon-api';

/** Presentation-only grouping of one run page; lifecycle truth stays with the daemon. */
export type RunFilter = 'all' | 'live' | 'completed' | 'attention';

export type RunColumnId =
  | 'name'
  | 'model'
  | 'dataset'
  | 'operation'
  | 'epochs'
  | 'cv'
  | 'created'
  | 'state';

export type RunColumnLabelKey =
  | 'runs.columnName'
  | 'runs.columnModel'
  | 'runs.columnDataset'
  | 'runs.columnType'
  | 'runs.columnEpochs'
  | 'runs.columnCv'
  | 'runs.columnCreated'
  | 'runs.columnState';

export interface RunSort {
  column: RunColumnId;
  direction: 'asc' | 'desc';
}

export type RunColumnBase<Key extends RunColumnId> = {
  id: Key;
  labelKey: RunColumnLabelKey;
  initialDirection: RunSort['direction'];
};

export type RunColumn<Key extends RunColumnId = RunColumnId> = RunColumnBase<Key> &
  (
    | { kind: 'text'; value: (run: RunView) => string | null }
    | { kind: 'number'; value: (run: RunView) => number | null }
  );

export type RunColumnRegistry = {
  [Key in RunColumnId]: RunColumn<Key>;
};

export type RunGroupKey = 'live' | 'today' | 'yesterday' | 'week' | 'earlier';

export interface RunGroup {
  key: RunGroupKey;
  runs: RunView[];
}

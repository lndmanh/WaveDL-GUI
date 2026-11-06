import type { BrowsePage, DataSelection } from './catalog-api';
import type { DatasetSuggestion } from './dataset-suggestions';

export interface DatasetBrowserColumn {
  readonly root: string;
  readonly path: string;
  readonly page: BrowsePage | null;
}

export interface ResolvedDatasetSuggestion extends DatasetSuggestion {
  readonly selection: DataSelection;
}

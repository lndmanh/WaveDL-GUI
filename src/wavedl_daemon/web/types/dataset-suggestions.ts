export interface DatasetSuggestion {
  readonly path: string;
  readonly name: string;
  readonly format: string;
  readonly count: number;
  readonly lastUsed: Date | null;
}

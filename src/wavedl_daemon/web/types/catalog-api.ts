import type { z } from 'zod';
import type { browsePageSchema } from '../shared/schemas/catalog';

export type CatalogueMessage = '' | 'catalog.modelsUnavailable' | 'catalog.connectionChanged';

export type BrowseEntry = Readonly<z.output<typeof browsePageSchema>['entries'][number]>;

export interface BrowsePage {
  readonly root: string;
  readonly path: string;
  readonly entries: readonly BrowseEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface DataSelection {
  readonly path: string;
  readonly root: string;
  readonly relativePath: string;
  readonly daemonId: string;
  readonly kind: 'file' | 'directory';
}

export interface ModelDescription {
  readonly id: string;
  readonly displayName: string;
  readonly architectureFamily: string;
  readonly authorInstitution: string;
  readonly yearPublished: number;
  readonly paramsM: number;
  readonly sizeMb: number;
  readonly shortDescription: string;
  readonly description: string;
  readonly bestFor: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly computeTier: string;
  readonly tags: readonly string[];
  readonly supportedDims: readonly number[];
  readonly category: string;
  readonly pretrained: boolean;
}

export interface ModelSelection {
  readonly model: string;
  readonly daemonId: string;
  readonly source?: 'custom';
  readonly runtimeVerified?: false;
}

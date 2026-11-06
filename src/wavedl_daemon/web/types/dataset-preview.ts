import type { z } from 'zod';
import type { datasetPreviewSchema } from '../shared/schemas/dataset-preview';

export type DatasetPreview = z.infer<typeof datasetPreviewSchema>;

export type PreviewSample = DatasetPreview['samples'][number];

export type PreviewValues = number | null | PreviewValues[];

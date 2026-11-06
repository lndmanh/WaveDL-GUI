import type { cvSummarySchema } from '../shared/schemas/cv-summary';
import type { z } from 'zod';

export type CvMetric = number | null;

export type CvSummary = z.output<typeof cvSummarySchema>;

export type CvFold = CvSummary['fold_results'][number];

import { clientError } from '../i18n/client-messages';
import { ArtifactClient } from './artifact-client';
import type { ConnectionSession } from './connection-session';
import { parseJson } from './daemon-api';
import { cvSummarySchema } from '../../shared/schemas/cv-summary';
import type { Artifact } from '~~/types/artifact-client';
import type { Json } from '~~/types/json';
import type { CvSummary } from '~~/types/cv-summary';

export const CV_SUMMARY_BUDGET = 1024 * 1024;

/** Exact current Python producer schema; target labels are indices, not inferred names. */
export function parseCvSummary(input: Json): CvSummary {
  const parsed = cvSummarySchema.safeParse(input);

  if (!parsed.success) throw clientError('invalidCrossValidationSummary', {});

  return parsed.data;
}

export async function loadCvSummary(
  session: ConnectionSession,
  artifact: Artifact,
  signal?: AbortSignal,
): Promise<CvSummary> {
  const client = new ArtifactClient(session);
  client.assertSelection(artifact);

  if (artifact.path !== 'cv_summary.json' || artifact.size > CV_SUMMARY_BUDGET)
    throw clientError('cvSummaryTooLarge', {});
  const blob = await client.verifiedBlob(artifact, signal);
  signal?.throwIfAborted();

  if (blob.size > CV_SUMMARY_BUDGET) throw clientError('cvSummaryTooLarge', {});
  const text = await blob.text();
  signal?.throwIfAborted();
  client.assertSelection(artifact);
  const summary = parseCvSummary(parseJson(text));
  signal?.throwIfAborted();
  client.assertSelection(artifact);

  return summary;
}

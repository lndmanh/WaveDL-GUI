import type { ArtifactGroupKey } from '~~/types/artifact-list';

/** Checkpoint contents take precedence over their individual file extensions. */
export function artifactGroupOf(path: string): ArtifactGroupKey {
  if (path.split('/').some((segment) => segment.endsWith('_checkpoint'))) return 'checkpoints';

  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith('.png')) return 'plots';

  if (/\.(json|csv|log|txt)$/.test(lowerPath)) return 'metrics';

  return 'other';
}

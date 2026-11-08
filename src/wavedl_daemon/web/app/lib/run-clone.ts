import { planManifestSchema } from '../../shared/schemas/plan-summary';
import { projectDraftSchema } from '../../shared/schemas/project-draft';
import { jsonObjectSchema } from '../../shared/schemas/json';
import { trainingRequestSchema } from '../../shared/schemas/training-request';
import { parseTrainingConfig } from './training-import';
import { trainingCommand } from './training-export';
import { hostPath as mapHostPath } from './host-path';
import type { PlanView } from '~~/types/daemon-api';
import type { PendingRunClone } from '~~/types/run-clone';

/** A clone is an editable import, not a replay of the old request or its selection tokens. */
export function runClone(plan: PlanView, daemonId: string): PendingRunClone | null {
  const parsed = planManifestSchema.safeParse(plan.preview.spec);

  if (!parsed.success || parsed.data.review.operation !== 'train') return null;
  const { review } = parsed.data;
  const mappings = review.storage_map ?? [];
  let ambiguousPath = false;

  function hostPath(value: string): string {
    const mapped = mapHostPath(value, mappings);
    ambiguousPath ||= mapped.ambiguous;

    return mapped.path;
  }

  const config = Object.fromEntries(Object.entries(review.resolved_config).map(([name, value]) => {
    if (['data_path', 'resume', 'constraint_file'].includes(name) && typeof value === 'string')
      return [name, hostPath(value)];
    if (name === 'import_modules' && Array.isArray(value))
      return [name, value.map((item) => typeof item === 'string' && item.endsWith('.py') ? hostPath(item) : item)];

    return [name, value];
  }));
  const imported = parseTrainingConfig(JSON.stringify(config));
  const draft = projectDraftSchema.safeParse({
    version: 1,
    daemonId,
    savedAt: Date.now(),
    block: 'plan',
    dataset: null,
    model: null,
    backend: plan.preview.target,
    setup: 'manual',
    config: imported.config,
    runtime: {
      python: review.runtime.python ? hostPath(review.runtime.python) : '',
      mode: review.runtime.mode,
      device: review.runtime.device,
    },
    topology: plan.preview.topology,
    storage_map: mappings,
  });

  return draft.success && !ambiguousPath ? { sourceRunId: plan.run_id, imported, draft: draft.data } : null;
}

/** Reuse Review's standalone command builder with the stored resolved inputs. */
export function storedTrainingCommand(plan: PlanView): string | null {
  const parsed = planManifestSchema.safeParse(plan.preview.spec);

  if (!parsed.success || parsed.data.review.operation !== 'train') return null;
  const { manifest, review } = parsed.data;
  const imported = parseTrainingConfig(JSON.stringify(review.resolved_config));

  // Never advertise a command that silently drops a future or unsupported setting.
  if (imported.skipped.some((name) => name !== 'output_dir')) return null;
  const runtime = jsonObjectSchema.parse(manifest.runtime);
  const request = trainingRequestSchema.parse({
    backend: plan.preview.target,
    operation: 'train',
    config: { ...imported.config, data_path: imported.dataPath, model: imported.model },
    runtime: {
      python: runtime.python,
      mode: runtime.mode,
      device: runtime.device,
      environment: runtime.environment ?? {},
    },
    topology: plan.preview.topology,
    storage_map: review.storage_map,
  });

  return trainingCommand(request);
}

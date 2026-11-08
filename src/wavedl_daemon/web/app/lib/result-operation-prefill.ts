import { planManifestSchema } from '../../shared/schemas/plan-summary';
import { jsonObjectSchema, jsonStringSchema } from '../../shared/schemas/json';
import {
  inferenceConfigOverridesSchema,
  resultRequestSchema,
  type ResultRequest,
} from '../../shared/schemas/result-request';
import { createResultOperationDefaults } from './result-operation-defaults';
import { hostPath } from './host-path';
import type { PlanView } from '~~/types/daemon-api';

export type ResultPrefillWarning = 'plan' | 'paths' | 'runtime' | 'container' | 'config';

export interface ResultOperationPrefill {
  draft: ResultRequest;
  warnings: ResultPrefillWarning[];
}

/** No catalogue grants are reconstructed from a saved plan: test data is selected afresh. */
export function resultOperationPrefill(plan: PlanView | null): ResultOperationPrefill {
  const draft = createResultOperationDefaults();
  const parsed = planManifestSchema.safeParse(plan?.preview.spec);

  if (!parsed.success) return { draft, warnings: ['plan'] };
  const { manifest } = parsed.data;
  const savedConfig = jsonObjectSchema.safeParse(manifest.resolved_config);
  const savedRuntime = jsonObjectSchema.safeParse(manifest.runtime);
  const savedMappings = resultRequestSchema.shape.storage_map.safeParse(manifest.storage_map);

  if (!savedConfig.success || !savedRuntime.success || !savedMappings.success)
    return { draft, warnings: ['plan'] };
  const mappings = savedMappings.data ?? [];
  const warnings: ResultPrefillWarning[] = [];
  let ambiguous = false;

  function mapPath(value: string): string {
    const mapped = hostPath(value, mappings);
    ambiguous ||= mapped.ambiguous;

    return mapped.path;
  }

  const savedPython = jsonStringSchema.safeParse(savedRuntime.data.python);

  const runtime = resultRequestSchema.shape.runtime.safeParse({
    python: savedPython.success ? mapPath(savedPython.data) : '',
    mode: savedRuntime.data.mode,
    device: savedRuntime.data.device,
    environment: savedRuntime.data.environment ?? {},
  });

  if (runtime.success) draft.runtime = runtime.data;
  else warnings.push('runtime');

  // Container images are not a field in the frozen ResultRequest runtime contract.
  if (savedRuntime.data.container) warnings.push('container');

  const backend = resultRequestSchema.shape.backend.safeParse(plan?.preview.target);

  if (backend.success) draft.backend = backend.data;
  draft.storage_map = mappings;
  const topology = resultRequestSchema.shape.topology.safeParse(plan?.preview.topology);

  if (topology.success) draft.topology = topology.data;

  // These are genuine shared training keys: model, import_modules, batch_size, workers.
  // The remaining keys exist only in inference plans; never infer them from unrelated
  // training switches (for example single_channel is not an input_channels override).
  const config = savedConfig.data;
  const modules = config.import_modules;

  const imported = Array.isArray(modules)
    ? modules.map((value) => {
        const module = jsonStringSchema.safeParse(value);

        return module.success && module.data.endsWith('.py') ? mapPath(module.data) : value;
      })
    : modules;

  // Training's -1 means automatic; inference needs a concrete count, so its default (0) stays.
  const inherited = {
    model: config.model,
    import_modules: imported,
    batch_size: config.batch_size,
    workers: config.workers === -1 ? undefined : config.workers,
    format: config.format,
    input_key: config.input_key,
    output_key: config.output_key,
    param_names: config.param_names,
    input_channels: config.input_channels,
    out_size: config.out_size,
    plot_format: config.plot_format,
    verbose: config.verbose,
  };

  const overrides = inferenceConfigOverridesSchema.safeParse(
    Object.fromEntries(Object.entries(inherited).filter(([, value]) => value !== undefined)),
  );

  if (overrides.success) draft.config = { ...draft.config, ...overrides.data };
  else warnings.push('config');

  if (ambiguous) return { draft: createResultOperationDefaults(), warnings: ['paths'] };

  return { draft, warnings };
}

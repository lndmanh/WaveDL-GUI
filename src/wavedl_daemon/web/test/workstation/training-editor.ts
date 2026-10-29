import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useForm } from 'vee-validate';
import { vi } from 'vitest';
import { z } from 'zod';
import TrainingInspector from '../../app/components/project/TrainingInspector.vue';
import {
  trainingConfigSchema,
  trainingDefaults,
  trainingFieldMetadata,
  type TrainingConfig,
} from '../../shared/schemas/training-request';
import type { TrainingFieldName } from '../../app/lib/training-layout';
import { draftConfigFields } from '../../shared/schemas/project-draft';
import type { createTestI18n } from './mountWithI18n';
import { mountWithI18n as mount } from './mountWithI18n';
import { chooseSelectOption } from './select-interaction';

type TrainingValue = TrainingConfig[keyof TrainingConfig];

/** TrainingInspector reads its values from the surrounding vee-validate form. */
export function trainingEditor(
  config: TrainingConfig = structuredClone(trainingDefaults),
  composer?: ReturnType<typeof createTestI18n>,
) {
  const form: { current?: ReturnType<typeof useForm<{ config: TrainingConfig }>> } = {};
  const preview = vi.fn();
  const host = defineComponent({
    setup() {
      form.current = useForm<{ config: TrainingConfig }>({
        initialValues: { config },
        validationSchema: z.object({ config: trainingConfigSchema }),
      });
      const submit = form.current.handleSubmit(preview);
      return () =>
        h('form', { onSubmit: submit, novalidate: true }, [
          h(TrainingInspector, { disabled: false }),
        ]);
    },
  });
  const wrapper = mount(host, undefined, composer);
  if (!form.current) throw new Error('Form did not mount');
  return { wrapper, form: form.current, preview };
}

export function trainingOption(name: string) {
  const option = trainingFieldMetadata.find((item) => item.name === name);
  if (!option) throw new Error(`Unknown training option ${name}`);
  return option;
}

/** Narrows a metadata/config name to a field the Training block can render. */
export function trainingFieldName(name: string): TrainingFieldName {
  const field = draftConfigFields.find((candidate) => candidate === name);
  if (!field) throw new Error(`Not a draft training field: ${name}`);
  return field;
}

export function trainingControl(wrapper: VueWrapper, name: string) {
  return wrapper.get(`[id$="-training-${name}"]`);
}

/** NumberField and SegmentedControl omit aria-invalid when valid; others render "false". */
export function markedInvalid(control: Pick<DOMWrapper<Element>, 'attributes'>): boolean {
  return control.attributes('aria-invalid') === 'true';
}

/**
 * Choices that make an otherwise irrelevant setting visible (see training-layout.ts).
 * A changed value stays visible after its controlling choice moves on.
 */
export const revealingChoices: Partial<Record<TrainingFieldName, Partial<TrainingConfig>>> = {
  momentum: { optimizer: 'sgd' },
  nesterov: { optimizer: 'sgd' },
  betas: { optimizer: 'adamw' },
  scheduler_patience: { scheduler: 'plateau' },
  scheduler_factor: { scheduler: 'plateau' },
  min_lr: { scheduler: 'plateau' },
  step_size: { scheduler: 'step' },
  milestones: { scheduler: 'multistep' },
  warmup_epochs: { scheduler: 'linear_warmup' },
  huber_delta: { loss: 'huber' },
  loss_weights: { loss: 'weighted_mse' },
  cv_stratify: { cv: 2 },
  cv_bins: { cv: 2, cv_stratify: true },
  constraint_weight: { constraint: ['custom.balance'] },
  constraint_reduction: { constraint: ['custom.balance'] },
  wandb_watch: { wandb: true },
  project_name: { wandb: true },
  run_name: { wandb: true },
};

/** Authors one value through the control's public DOM contract. */
export async function setTrainingControl(
  wrapper: VueWrapper,
  name: string,
  value: TrainingValue | undefined,
) {
  const option = trainingOption(name);
  const choices: readonly string[] = option.choices;
  const control = wrapper.find(`[id$="-training-${name}"]`);
  if (!control.exists()) throw new Error(`Training control ${name} is not rendered`);
  if (option.kind === 'boolean') {
    if ((control.attributes('aria-checked') === 'true') !== value) await control.trigger('click');
  } else if (choices.length && choices.length <= 3) {
    const item = control.findAll('button').at(choices.indexOf(String(value)));
    if (!item) throw new Error(`Missing segmented choice ${String(value)} for ${name}`);
    await item.trigger('click');
  } else if (choices.length) {
    await chooseSelectOption(control, String(value));
  } else {
    await control.setValue(
      Array.isArray(value) ? value.join('\n') : value === null || value === undefined ? '' : String(value),
    );
  }
  await flushPromises();
}

/** Applies a field's revealing choices through the UI when it is not rendered; returns an undo. */
export async function revealTrainingControl(
  wrapper: VueWrapper,
  form: { values: { config: TrainingConfig } },
  name: string,
): Promise<() => Promise<void>> {
  if (wrapper.find(`[id$="-training-${name}"]`).exists()) return async () => undefined;
  const patch = Object.entries(revealingChoices[trainingFieldName(name)] ?? {});
  const before = patch.map(
    ([controller]) =>
      [
        controller,
        Object.entries(form.values.config).find(([key]) => key === controller)?.[1] ?? null,
      ] as const,
  );
  for (const [controller, value] of patch) await setTrainingControl(wrapper, controller, value);
  return async () => {
    for (const [controller, value] of before.reverse())
      await setTrainingControl(wrapper, controller, value);
  };
}

// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, shallowRef } from 'vue';
import { useForm } from 'vee-validate';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { inferenceConfigSchema, inferenceDefaults } from '../../shared/schemas/result-request';
import InferenceFields from '../../app/components/results/InferenceFields.vue';

describe('explicit inference registration authority', () => {
  it('defaults legacy drafts to no imports and preserves explicitly authored lists', () => {
    const { import_modules, ...legacy } = { ...inferenceDefaults, data_path: '/data/test.npz' };
    expect(import_modules).toEqual([]);
    expect(inferenceConfigSchema.parse(legacy).import_modules).toEqual([]);
    const modules = ['custom_models.registration', 'custom_losses'];
    const parsed = inferenceConfigSchema.parse({ ...legacy, import_modules: modules });
    expect(parsed.import_modules).toEqual(modules);
    modules.push('later_module');
    expect(parsed.import_modules).toEqual(['custom_models.registration', 'custom_losses']);
  });

  it.each([
    null,
    'registration',
    [1],
    [''],
    ['registration\0'],
    ['--device'],
    ['-x'],
    Array(129).fill('registration'),
  ])('rejects malformed or unbounded import authority %j', (import_modules) => {
    expect(
      inferenceConfigSchema.safeParse({
        ...inferenceDefaults,
        data_path: '/data/test.npz',
        import_modules,
      }).success,
    ).toBe(false);
  });

  it('binds the visible registration field to request config and clears to an empty list', async () => {
    let imports = (): readonly string[] => [];
    const disabled = shallowRef(false);
    const Host = defineComponent({
      setup() {
        const form = useForm({
          initialValues: {
            config: { ...structuredClone(inferenceDefaults), data_path: '/data/test.npz' },
          },
          validationSchema: z.object({ config: inferenceConfigSchema }),
        });
        imports = () => form.values.config.import_modules;
        return () => h('form', [h(InferenceFields, { disabled: disabled.value })]);
      },
    });
    const wrapper = mount(Host);
    try {
      const input = wrapper.get('#inference-import-modules');
      expect(wrapper.get('label[for="inference-import-modules"]').text()).toBe(
        'Custom registration modules (comma-separated)',
      );
      const help = wrapper.get('button[aria-label^="Trusted runtime code only:"]');
      expect(help.attributes('aria-label')).toContain('These execute code in the approved runtime');
      expect(help.attributes('aria-label')).toContain(
        'No modules are inferred from checkpoint metadata.',
      );
      await help.trigger('click');
      await flushPromises();
      expect(document.body.textContent).toContain(
        'No modules are inferred from checkpoint metadata.',
      );
      await input.setValue('custom_models.registration, custom_losses');
      await flushPromises();
      expect(imports()).toEqual(['custom_models.registration', 'custom_losses']);
      await input.setValue('');
      await flushPromises();
      expect(imports()).toEqual([]);
      disabled.value = true;
      await flushPromises();
      expect(input.attributes('disabled')).toBeDefined();
    } finally {
      wrapper.unmount();
    }
  });
});

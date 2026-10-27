// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { useForm } from 'vee-validate';
import TrainingFields from '../../app/components/project/TrainingFields.vue';
import {
  trainingDefaults,
  trainingFieldMetadata,
  trainingConfigSchema,
} from '../../shared/schemas/training-request';
import { z } from 'zod';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import { ConnectionSession } from './session-fixture';
import CustomModelSelector from '../../app/components/project/CustomModelSelector.vue';

describe('training controls coverage', () => {
  it('selects an explicit custom model through verified raw session authority in mounted Vue', async () => {
    const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async () =>
        new Response(JSON.stringify(health), { headers: { 'content-type': 'application/json' } }),
    });
    expect(await owner.connect('credential')).toBe(true);
    const wrapper = mount(CustomModelSelector, { props: { session: owner, disabled: false } });
    await wrapper.get('input').setValue('my_model');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() =>
      expect(wrapper.emitted('select')).toEqual([
        [{ model: 'my_model', daemonId: 'daemon-one', source: 'custom', runtimeVerified: false }],
      ]),
    );
    wrapper.unmount();
    owner.detach();
  });
  it('renders exactly one accessible typed control for every editable training option', async () => {
    const host = defineComponent({
      setup() {
        useForm({
          initialValues: { config: structuredClone(trainingDefaults) },
          validationSchema: z.object({ config: trainingConfigSchema }),
        });
        return () => h(TrainingFields, { disabled: false });
      },
    });
    const wrapper = mount(host);
    await flushPromises();
    for (const option of trainingFieldMetadata) {
      const id = wrapper.get(`[id$="-training-${option.name}"]`).attributes('id');
      expect(wrapper.findAll(`[id="${id}"]`)).toHaveLength(1);
      expect(wrapper.get(`label[for="${id}"]`).text()).toBe(option.name.replaceAll('_', ' '));
      const control = wrapper.get(`[id="${id}"]`);
      if (option.multiple) expect(control.element.tagName).toBe('TEXTAREA');
      else if (option.choices.length) expect(control.element.tagName).toBe('SELECT');
      else if (option.kind === 'integer' || option.kind === 'number')
        expect(control.attributes('type')).toBe('number');
    }
    expect(wrapper.text()).toContain('never deletes previous run data');
    wrapper.unmount();
  });
  it('never automatically plans/submits or cancels daemon work on mount/navigation', async () => {
    const calls: string[] = [];
    const owner = new ConnectionSession({
      origin: 'http://localhost:8765',
      buildId: '1.8.1',
      fetcher: async (input) => {
        calls.push(String(input));
        throw new Error('Disconnected');
      },
    });
    const wrapper = mount(ProjectContainer, { props: { session: owner } });
    await flushPromises();
    expect(calls).toEqual([]);
    expect(wrapper.text()).toContain('Nothing starts automatically');
    expect(wrapper.get('[id$="-training-batch_size"]').element).toHaveProperty('value', '128');
    expect(wrapper.get('[id$="-training-constraint_weight"]').element).toHaveProperty(
      'value',
      '0.1',
    );
    const guide = wrapper.findAll('button').find((button) => button.text() === 'Use guided steps');
    await guide?.trigger('click');
    const next = wrapper.findAll('button').find((button) => button.text() === 'Next step');
    await next?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Choose a dataset from the current daemon.');
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Dataset');
    wrapper.unmount();
    expect(calls).toEqual([]);
  });
});

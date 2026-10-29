// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { trainingDefaults, trainingFieldMetadata } from '../../shared/schemas/training-request';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import { ConnectionSession } from './session-fixture';
import { openSelect, pressSelectOption } from './select-interaction';
import { trainingFieldMessageKeys } from '../../app/i18n/dynamic-keys';
import { trainingFieldVisible } from '../../app/lib/training-layout';
import {
  revealTrainingControl,
  trainingFieldName,
  setTrainingControl,
  trainingControl,
  trainingEditor,
} from './training-editor';

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
    const wrapper = mount(ModelInspector, {
      props: {
        session: owner,
        models: [],
        busy: false,
        message: null,
        selection: null,
        pretrained: false,
        inspection: null,
        singleChannel: false,
        disabled: false,
      },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Use a custom model ID…')
      ?.trigger('click');
    const label = wrapper
      .findAll('label')
      .find((item) => item.text() === 'Custom model registry ID');
    await wrapper.get(`input[id="${label?.attributes('for')}"]`).setValue('my_model');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Use')
      ?.trigger('click');
    await flushPromises();
    await vi.waitFor(() =>
      expect(wrapper.emitted('custom')).toEqual([
        [{ model: 'my_model', daemonId: 'daemon-one', source: 'custom', runtimeVerified: false }],
      ]),
    );
    wrapper.unmount();
    owner.detach();
  });
  it('renders exactly one accessible typed control for every editable training option', async () => {
    const i18n = createTestI18n('en');
    const { wrapper, form } = trainingEditor(structuredClone(trainingDefaults), i18n);
    await flushPromises();
    // The Model block owns pretrained alongside the weights variant.
    expect(wrapper.find('[id$="-training-pretrained"]').exists()).toBe(false);
    const editable = trainingFieldMetadata.filter((option) => option.name !== 'pretrained');
    // Settings the current choices ignore stay out of the way until they become relevant.
    for (const option of editable)
      expect(wrapper.find(`[id$="-training-${option.name}"]`).exists()).toBe(
        trainingFieldVisible(trainingFieldName(option.name), trainingDefaults),
      );
    const ids = new Map<string, string>();
    for (const option of editable) {
      const restore = await revealTrainingControl(wrapper, form, option.name);
      const id = trainingControl(wrapper, option.name).attributes('id');
      if (!id) throw new Error(`Missing id for ${option.name}`);
      ids.set(option.name, id);
      expect(wrapper.findAll(`[id="${id}"]`)).toHaveLength(1);
      expect(wrapper.get(`label[for="${id}"]`).text()).toBe(
        i18n.global.t(trainingFieldMessageKeys[option.name]?.label ?? option.name),
      );
      const control = wrapper.get(`[id="${id}"]`);
      expect(control.attributes('data-testid')).toBe(`training-field-${option.name}`);
      const value = Object.entries(form.values.config).find(([name]) => name === option.name)?.[1];
      if (option.kind === 'boolean') {
        expect(control.attributes('role')).toBe('switch');
        expect(control.attributes('aria-checked')).toBe(String(value));
      } else if (option.multiple) expect(control.element.tagName).toBe('TEXTAREA');
      else if (option.choices.length > 3) {
        expect(control.element.tagName).toBe('BUTTON');
        expect(control.attributes('role')).toBe('combobox');
        expect(control.attributes('data-value')).toBe(String(value));
      } else if (option.choices.length) {
        const items = control.findAll('button');
        expect(items).toHaveLength(option.choices.length);
        expect(items.map((item) => item.attributes('data-state'))).toEqual(
          option.choices.map((choice) => (choice === value ? 'on' : 'off')),
        );
      } else if (option.kind === 'integer' || option.kind === 'number') {
        expect(control.element.tagName).toBe('INPUT');
        expect(control.attributes('type')).toBe('text');
        expect(control.attributes('inputmode')).toBe(
          option.kind === 'integer' ? 'numeric' : 'decimal',
        );
      } else expect(control.element.tagName).toBe('INPUT');
      await restore();
    }
    i18n.global.locale.value = 'vi';
    await nextTick();
    for (const option of editable) {
      const restore = await revealTrainingControl(wrapper, form, option.name);
      const id = trainingControl(wrapper, option.name).attributes('id');
      expect(wrapper.get(`label[for="${id}"]`).text()).toBe(
        i18n.global.t(trainingFieldMessageKeys[option.name]?.label ?? option.name),
      );
      await restore();
    }
    expect(form.values.config).toEqual(trainingDefaults);
    wrapper.unmount();
  });
  it('changes a choice through its public combobox role and keeps the schema value', async () => {
    const { wrapper, form } = trainingEditor();
    await flushPromises();
    const loss = wrapper.get('[id$="-training-loss"]');
    expect(loss.attributes('role')).toBe('combobox');
    expect(loss.attributes('data-value')).toBe('mse');
    await openSelect(loss);
    expect(document.body.querySelector('[role="option"][data-value="mae"]')).not.toBeNull();
    await pressSelectOption('mae');
    expect(wrapper.get('[id$="-training-loss"]').attributes('data-value')).toBe('mae');
    expect(form.values.config.loss).toBe('mae');
    wrapper.unmount();
  });
  it('changes a short choice through its segmented buttons and keeps the schema value', async () => {
    const { wrapper, form } = trainingEditor();
    await flushPromises();
    await setTrainingControl(wrapper, 'precision', 'fp16');
    expect(
      wrapper
        .get('[id$="-training-precision"]')
        .findAll('button')
        .map((item) => item.attributes('data-state')),
    ).toEqual(['off', 'on', 'off']);
    expect(form.values.config.precision).toBe('fp16');
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
    expect(wrapper.get('[id$="-training-lr"]').element).toHaveProperty('value', '1e-3');
    await wrapper.get('[data-testid="guide-step-2"]').trigger('click');
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Training');
    await wrapper.get('[data-testid="guide-step-4"]').trigger('click');
    await wrapper.get('[data-testid="guide-step-0"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="selected-dataset"]').text()).toContain('No dataset yet');
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Dataset');
    wrapper.unmount();
    expect(calls).toEqual([]);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ProjectGuide from '../../app/components/project/ProjectGuide.vue';
import TrainingExport from '../../app/components/project/TrainingExport.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import CustomModelSelector from '../../app/components/project/CustomModelSelector.vue';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const found = wrapper.findAll('button').find((entry) => entry.text() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

async function setup() {
  const calls: string[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      const value =
        path === '/api/health'
          ? { daemon_id: 'daemon-a', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 }
          : path === '/api/browse/resolve'
            ? { root: 'data', relative_path: 'train.npz', path: '/data/train.npz', kind: 'file' }
            : null;
      if (!value) throw new Error(`Unexpected route ${path}`);
      return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  expect(await session.connect('credential')).toBe(true);
  const wrapper = mount(ProjectContainer, {
    props: { session },
    global: { stubs: { DatasetPathPicker: true, ModelSelector: true, DatasetInfoPanel: true } },
  });
  cleanups.push(() => {
    wrapper.unmount();
    session.detach();
  });
  if (!wrapper.getComponent(ProjectGuide).props('enabled'))
    await button(wrapper, 'Use guided steps').trigger('click');
  const catalogue = new CatalogApi(session);
  async function selectData() {
    wrapper
      .getComponent(DatasetPathPicker)
      .vm.$emit('select', await catalogue.resolve('data', 'train.npz'));
    await nextTick();
  }
  async function selectModel() {
    wrapper
      .getComponent(CustomModelSelector)
      .vm.$emit('select', await catalogue.selectCustomModel('custom_model'));
    await nextTick();
  }
  async function trainingStep() {
    await selectData();
    await button(wrapper, 'Next step').trigger('click');
    await selectModel();
    await button(wrapper, 'Next step').trigger('click');
    await button(wrapper, 'Next step').trigger('click');
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(3);
  }
  return { wrapper, session, calls, selectData, selectModel, trainingStep };
}

describe('guided project authoring navigation', () => {
  it('refuses missing selections and invalid runtime without planning or submitting', async () => {
    const { wrapper, calls, selectData, selectModel } = await setup();
    await button(wrapper, 'Next step').trigger('click');
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(0);
    expect(wrapper.text()).toContain('Choose a dataset from the current daemon.');
    await selectData();
    await button(wrapper, 'Next step').trigger('click');
    await button(wrapper, 'Next step').trigger('click');
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(1);
    expect(wrapper.text()).toContain('Choose a catalogue model or explicit custom identifier.');
    await selectModel();
    await button(wrapper, 'Next step').trigger('click');
    await button(wrapper, 'Next step').trigger('click');
    await button(wrapper, 'Next step').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(false));
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(3);
    expect(wrapper.text()).toContain(
      'Review training and runtime validation errors before approval.',
    );
    expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(false);
    expect(calls.some((path) => path.startsWith('/api/runs'))).toBe(false);
  });

  it('locks navigation during async validation and advances exactly once, preserving the shared draft', async () => {
    const { wrapper, calls, trainingStep } = await setup();
    await trainingStep();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    const draft = JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'));
    button(wrapper, 'Next step').element.click();
    await nextTick();
    expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(true);
    expect(button(wrapper, 'Previous step').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'Show full editor').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'Next step').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'Preview persisted plan').attributes('disabled')).toBeDefined();
    button(wrapper, 'Previous step').element.click();
    button(wrapper, 'Next step').element.click();
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(false));
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(4);
    expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(false);
    await button(wrapper, 'Previous step').trigger('click');
    await button(wrapper, 'Previous step').trigger('click');
    await button(wrapper, 'Next step').trigger('click');
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(3);
    expect(JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'))).toBe(draft);
    expect(calls.some((path) => path.startsWith('/api/runs'))).toBe(false);
  });

  it('retires pending validation on detach without advancing or leaving navigation locked', async () => {
    const { wrapper, session, trainingStep } = await setup();
    await trainingStep();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    button(wrapper, 'Next step').element.click();
    await nextTick();
    expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(true);
    session.detach();
    await flushPromises();
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(0);
    expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(false);
    expect(wrapper.text()).toContain('Verified connection required');
  });
});

// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import DatasetInfoPanel from '../../app/components/datasets/DatasetInfoPanel.vue';
import ModelSelector from '../../app/components/catalog/ModelSelector.vue';
import ModelList from '../../app/components/catalog/ModelList.vue';
import { CatalogApi, type ModelDescription } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';
import type { DatasetInspection } from '../../app/lib/dataset-inspection';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../app/i18n/core';

const inspection: DatasetInspection = {
  format: 'npz',
  numSamples: 7,
  inputKey: 'X',
  outputKey: 'Y',
  inputShape: [32, 32],
  outputShape: [1],
  inputDtype: 'float32',
  outputDtype: 'float32',
  fileSize: null,
};
const model: ModelDescription = {
  id: 'cnn',
  displayName: 'CNN',
  architectureFamily: 'CNN',
  authorInstitution: 'Example',
  yearPublished: 1989,
  paramsM: 1.6,
  sizeMb: 6,
  shortDescription: 'Simple convolutional baseline',
  description: 'Guidance',
  bestFor: 'Baseline',
  pros: ['Fast'],
  cons: ['Limited capacity'],
  computeTier: 'Edge',
  tags: ['baseline'],
  category: 'Classic CNNs',
  supportedDims: [1],
  pretrained: false,
};
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
async function connected() {
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/health')
        return json({ daemon_id: 'one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
      if (path === '/api/browse/resolve') {
        const request = JSON.parse(String(init?.body));
        return json({
          root: 'data',
          relative_path: request.path,
          path: `/data/${request.path}`,
          kind: 'file',
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  expect(await session.connect('token')).toBe(true);
  return session;
}

describe('model dataset guidance UI', () => {
  it('updates localized advice without disabling model selection or claiming validation', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const data = shallowRef<DatasetInspection | null>(inspection);
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(ModelList, { models: [model], busy: false, inspection: data.value });
      },
    });
    const wrapper = mount(Provider);
    expect(wrapper.text()).toContain('Dimension mismatch');
    expect(wrapper.text()).toContain('32 × 32');
    await wrapper.get('[data-testid="model-details"]').trigger('click');
    await nextTick();
    expect(document.body.textContent).toContain('not runtime validation');
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="model-select"]').trigger('click');
    expect(wrapper.getComponent(ModelList).emitted('select')?.[0]?.[0]).toEqual(model);
    data.value = { ...inspection, inputShape: [32] };
    await nextTick();
    expect(wrapper.text()).toContain('Dimensions described');
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.text()).toContain('Có mô tả số chiều');
    data.value = { ...inspection, inputShape: [3, 128, 128] };
    await nextTick();
    expect(wrapper.text()).toContain('Hình dạng chưa rõ');
    expect(wrapper.text()).not.toContain('Không khớp số chiều');
    data.value = null;
    await nextTick();
    expect(wrapper.text()).toContain('Chưa kiểm tra hình dạng');
    wrapper.unmount();
  });

  it('accepts only the inspected current authenticated selection and retires stale guidance', async () => {
    const session = await connected();
    const api = new CatalogApi(session);
    const first = await api.resolve('data', 'first.npz');
    const second = await api.resolve('data', 'second.npz');
    const wrapper = mount(ProjectContainer, {
      props: { session },
      global: { stubs: { DatasetPathPicker: true, DatasetInfoPanel: true, ModelSelector: true } },
    });
    const browse = wrapper.getComponent(DatasetPathPicker);
    const panel = wrapper.getComponent(DatasetInfoPanel);
    const selector = wrapper.getComponent(ModelSelector);
    expect(selector.props('singleChannel')).toBe(false);
    browse.vm.$emit('select', first);
    await nextTick();
    panel.vm.$emit('inspected', inspection, first);
    await nextTick();
    expect(selector.props('inspection')).toEqual(inspection);
    browse.vm.$emit('select', second);
    await nextTick();
    expect(selector.props('inspection')).toBeNull();
    panel.vm.$emit('inspected', inspection, first);
    panel.vm.$emit('inspected', inspection, { ...second });
    await nextTick();
    expect(selector.props('inspection')).toBeNull();
    panel.vm.$emit('inspected', inspection, second);
    await nextTick();
    expect(selector.props('inspection')).toEqual(inspection);
    panel.vm.$emit('inspected', null, second);
    await nextTick();
    expect(selector.props('inspection')).toBeNull();
    panel.vm.$emit('inspected', inspection, second);
    session.detach();
    await flushPromises();
    expect(selector.props('inspection')).toBeNull();
    panel.vm.$emit('inspected', inspection, second);
    await nextTick();
    expect(selector.props('inspection')).toBeNull();
    const replacement = await connected();
    await wrapper.setProps({ session: replacement });
    panel.vm.$emit('inspected', inspection, second);
    await nextTick();
    expect(selector.props('inspection')).toBeNull();
    wrapper.unmount();
    replacement.detach();
  });
});

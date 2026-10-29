// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import DatasetInfoPanel from '../../app/components/datasets/DatasetInfoPanel.vue';
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
function variant(id: string, supportedDims: number[], pretrained = false): ModelDescription {
  return { ...model, id, displayName: id, supportedDims, pretrained };
}
function inspectorProps(session: ConnectionSession, models: readonly ModelDescription[]) {
  return {
    session,
    models,
    busy: false,
    message: '',
    selection: null,
    pretrained: false,
    singleChannel: false,
    disabled: false,
  } as const;
}
function offline() {
  return new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async () => {
      throw new Error('No requests expected');
    },
  });
}
function rows(wrapper: VueWrapper) {
  return wrapper
    .findAll('[data-testid="model-card"]')
    .map((row) => row.attributes('data-model-entry'));
}
function option(wrapper: VueWrapper, label: string, text: string) {
  const match = wrapper
    .get(`[aria-label="${label}"]`)
    .findAll('button')
    .find((item) => item.text() === text);
  if (!match) throw new Error(`Missing ${label} option ${text}`);
  return match;
}
beforeEach(() => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage });
});
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
      if (path === '/api/models')
        return json({
          source: 'bundled_metadata',
          runtime_verified: false,
          categories: { 'Classic CNNs': { short_description: 'Classics', models: ['cnn'] } },
          models: [
            {
              id: 'cnn',
              display_name: 'CNN',
              architecture_family: 'CNN',
              author_institution: 'Example',
              year_published: 1989,
              params_m: 1.6,
              size_mb: 6,
              short_description: 'Simple convolutional baseline',
              description: 'Guidance',
              best_for: 'Baseline',
              pros: ['Fast'],
              cons: ['Limited capacity'],
              compute_tier: 'Edge',
              tags: ['baseline'],
              supported_dims: [1],
              is_pretrained: false,
            },
          ],
        });
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
    const session = offline();
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () =>
          h(ModelInspector, { ...inspectorProps(session, [model]), inspection: data.value });
      },
    });
    const wrapper = mount(Provider);
    // A 2D sample does not fit a 1D-only model, so it is only listed under "All".
    expect(rows(wrapper)).toEqual([]);
    await option(wrapper, 'Compatibility', 'All · 1').trigger('click');
    expect(rows(wrapper)).toEqual(['cnn']);
    expect(wrapper.get('[data-model-entry="cnn"]').attributes('data-dim')).toBe('true');
    expect(wrapper.get('[role="note"]').text()).toBe(
      'Dimension mismatch: dataset sample 32 × 32 is treated as 2D spatial data by training (batch excluded; a channel is added), outside this model’s described dimensions. Review the dataset and model; this is advisory, not runtime validation.',
    );
    expect(wrapper.get('[data-testid="model-select"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="model-select"]').trigger('click');
    expect(wrapper.getComponent(ModelInspector).emitted('choose')?.[0]).toEqual([model, false]);
    data.value = { ...inspection, inputShape: [32] };
    await nextTick();
    expect(wrapper.get('[data-model-entry="cnn"]').attributes('data-dim')).toBeUndefined();
    expect(wrapper.get('[role="note"]').text()).toBe(
      'Dataset sample: 32 (batch excluded). Training treats this as 1D spatial data and adds a channel. This dimensionality is described by this model; exact sizes, channels and runtime compatibility remain unverified.',
    );
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('[role="note"]').text()).toBe(
      'Mẫu dữ liệu: 32 (không gồm chiều lô). Huấn luyện xem đây là dữ liệu không gian 1D và thêm chiều kênh. Số chiều này có trong mô tả mô hình; kích thước cụ thể, kênh và khả năng tương thích khi chạy vẫn chưa được xác minh.',
    );
    data.value = { ...inspection, inputShape: [3, 128, 128] };
    await nextTick();
    expect(wrapper.get('[role="note"]').text()).toBe(
      'Mẫu dữ liệu chưa rõ: 3 × 128 × 128 (không gồm chiều lô). Đây có thể là dữ liệu 2D có chiều kênh đầu tiên hoặc thể tích 3D nông. Huấn luyện yêu cầu xác nhận single_channel cho thể tích đơn kênh; không nên mặc định tương thích kênh. Khả năng tương thích khi chạy vẫn chưa được xác minh.',
    );
    expect(wrapper.text()).not.toContain('Không khớp số chiều');
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('Dùng mô hình này');
    data.value = null;
    await nextTick();
    // Without an inspected dataset there is no advice to give, and choosing stays open.
    expect(wrapper.find('[role="note"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Tương thích"]').exists()).toBe(false);
    // Choosing remembered the model, so it is also listed under "Recent".
    expect(rows(wrapper)).toEqual(['cnn', 'cnn']);
    expect(wrapper.find('[role="group"][aria-label="Gần đây"]').exists()).toBe(true);
    locale.value = 'en';
    await nextTick();
    expect(wrapper.find('[role="note"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="model-select"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('Use this model');
    wrapper.unmount();
  });

  it('filters to models that fit the inspected dataset, counting either weights variant', async () => {
    const data = shallowRef<DatasetInspection | null>(inspection);
    const singleChannel = shallowRef(false);
    const session = offline();
    const models = [
      variant('cnn', [1]),
      variant('vit', [2]),
      variant('resnet50', [1]),
      variant('resnet50_pretrained', [2], true),
    ];
    const Provider = defineComponent({
      setup() {
        return () =>
          h(ModelInspector, {
            ...inspectorProps(session, models),
            inspection: data.value,
            singleChannel: singleChannel.value,
          });
      },
    });
    const wrapper = mount(Provider);
    expect(rows(wrapper).sort()).toEqual(['resnet50', 'vit']);
    expect(wrapper.text()).toContain('Fits your data · 2');
    expect(wrapper.text()).toContain('All · 3');
    await wrapper.get('[data-testid="model-search"]').setValue('vit');
    expect(rows(wrapper)).toEqual(['vit']);
    expect(wrapper.text()).toContain('Fits your data · 1');
    expect(wrapper.text()).toContain('All · 1');
    await wrapper.get('[data-testid="model-search"]').setValue('');
    await option(wrapper, 'Compatibility', 'All · 3').trigger('click');
    expect(rows(wrapper).sort()).toEqual(['cnn', 'resnet50', 'vit']);
    expect(wrapper.get('[data-model-entry="cnn"]').attributes('data-dim')).toBe('true');
    expect(wrapper.get('[data-model-entry="resnet50"]').attributes('data-dim')).toBeUndefined();
    await option(wrapper, 'Compatibility', 'Fits your data · 2').trigger('click');
    // An ambiguous rank-three sample is advisory, not a mismatch.
    data.value = { ...inspection, inputShape: [3, 128, 128] };
    await nextTick();
    expect(rows(wrapper).sort()).toEqual(['cnn', 'resnet50', 'vit']);
    // Confirming single_channel makes it a 3D volume, which none of these describe.
    singleChannel.value = true;
    await nextTick();
    expect(rows(wrapper)).toEqual([]);
    expect(wrapper.text()).toContain('Fits your data · 0');
    expect(wrapper.text()).toContain('No matching model descriptions');
    data.value = null;
    await nextTick();
    expect(wrapper.find('[aria-label="Compatibility"]').exists()).toBe(false);
    expect(rows(wrapper).sort()).toEqual(['cnn', 'resnet50', 'vit']);
    wrapper.unmount();
  });

  it('accepts only the inspected current authenticated selection and retires stale guidance', async () => {
    const session = await connected();
    const api = new CatalogApi(session);
    const first = await api.resolve('data', 'first.npz');
    const second = await api.resolve('data', 'second.npz');
    const wrapper = mount(ProjectContainer, {
      props: { session },
      global: { stubs: { DatasetPathPicker: true, DatasetInfoPanel: true, ModelInspector: true } },
    });
    const browse = wrapper.getComponent(DatasetPathPicker);
    const panel = wrapper.getComponent(DatasetInfoPanel);
    const selector = wrapper.getComponent(ModelInspector);
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

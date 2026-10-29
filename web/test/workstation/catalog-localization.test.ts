// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import {
  bundledModelMessages,
  hashModelSource,
  modelPresentation,
  type ModelMessageKey,
} from '../../app/i18n/model-descriptions';
import type { WorkstationLocale } from '../../app/i18n/core';
import { CatalogApi, type ModelDescription } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
async function connected(work: (url: string) => Response) {
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (url) =>
      String(url).endsWith('/api/health')
        ? json({ daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 })
        : work(String(url)),
  });
  expect(await session.connect('token')).toBe(true);
  return session;
}
const cnn: ModelDescription = {
  id: 'cnn',
  displayName: 'CNN',
  architectureFamily: 'CNN',
  authorInstitution: 'Example',
  yearPublished: 1989,
  paramsM: 1.6,
  sizeMb: 6,
  shortDescription: 'Simple convolutional network, fast and flexible',
  category: 'Classic CNNs',
  supportedDims: [1, 2, 3],
  pretrained: false,
  pros: ['Extremely fast training and inference', 'Very low memory footprint'],
  cons: ['Limited capacity'],
  computeTier: 'Edge',
  tags: ['baseline'],
  description:
    "A vanilla convolutional neural network stacking Conv-BN-ReLU blocks with max-pooling for spatial reduction. Originating from LeCun's foundational work on gradient-based learning (1989), this architecture serves as the simplest deep learning baseline. It lacks modern enhancements like skip connections or attention, trading representational power for minimal complexity and fast iteration.",
  bestFor: 'Quick baselines and prototyping across all data types',
};

beforeEach(() => {
  // Recent models and drafts persist per browser; each test starts without any.
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
function detail(wrapper: VueWrapper) {
  return wrapper.get('article').text();
}
function translateModel(key: ModelMessageKey): string {
  const [, id, field, strength] = key.split('.');
  const model = bundledModelMessages.vi[id as keyof typeof bundledModelMessages.vi];
  if (field === 'pros') return model.pros[strength as 'first' | 'second'];
  return model?.[field as 'description' | 'bestFor' | 'shortDescription'] ?? key;
}

describe('catalogue localization preserves daemon authority', () => {
  it('covers all complete bundled translations and exact daemon source signatures', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../src/wavedl_daemon/runs/model_metadata.json'),
      'utf8',
    );
    const { models } = JSON.parse(source) as {
      models: {
        id: string;
        description: string;
        best_for: string;
        short_description: string;
        pros: string[];
      }[];
    };
    expect(models).toHaveLength(71);
    expect(Object.keys(bundledModelMessages.vi)).toHaveLength(models.length);
    expect(Object.keys(bundledModelMessages.sourceHashes)).toHaveLength(models.length);
    for (const model of models) {
      const sourceHashes =
        bundledModelMessages.sourceHashes[
          model.id as keyof typeof bundledModelMessages.sourceHashes
        ];
      expect(sourceHashes).toEqual({
        description: hashModelSource(model.description),
        bestFor: hashModelSource(model.best_for),
        shortDescription: hashModelSource(model.short_description),
        pros: {
          first: hashModelSource(model.pros[0]!),
          second: hashModelSource(model.pros[1]!),
        },
      });
      const translation = bundledModelMessages.vi[model.id as keyof typeof bundledModelMessages.vi];
      expect(translation.description).not.toBe(model.description);
      expect(translation.bestFor).not.toBe(model.best_for);
      expect(translation.shortDescription.trim()).not.toBe('');
      expect(translation.shortDescription).not.toBe(model.short_description);
      expect(Object.keys(translation.pros)).toEqual(['first', 'second']);
      for (const [index, pro] of Object.values(translation.pros).entries()) {
        expect(pro.trim()).not.toBe('');
        expect(pro).not.toBe(model.pros[index]);
      }
      expect(
        modelPresentation(
          {
            id: model.id,
            displayName: model.id,
            category: 'test',
            supportedDims: [1],
            pretrained: false,
            description: model.description,
            bestFor: model.best_for,
            shortDescription: model.short_description,
            pros: model.pros,
          },
          'vi',
          translateModel,
        ).untranslated,
      ).toBe(false);
    }
  });

  it('never substitutes translations for unknown IDs or changed known metadata', () => {
    for (const model of [
      { ...cnn, id: 'custom_cnn' },
      { ...cnn, description: 'A custom daemon override <script>東京</script>' },
      { ...cnn, bestFor: 'My specialized experiment' },
      { ...cnn, shortDescription: `${cnn.shortDescription}x` },
      { ...cnn, pros: [`${cnn.pros[0]}x`, cnn.pros[1]!] },
      { ...cnn, pros: [cnn.pros[0]!, `${cnn.pros[1]}x`] },
      { ...cnn, pros: [cnn.pros[0]!] },
    ]) {
      expect(modelPresentation(model, 'vi', translateModel)).toEqual({
        description: model.description,
        bestFor: model.bestFor,
        shortDescription: model.shortDescription,
        pros: model.pros.slice(0, 2),
        untranslated: true,
      });
      expect(modelPresentation(model, 'en', translateModel)).toEqual({
        description: model.description,
        bestFor: model.bestFor,
        shortDescription: model.shortDescription,
        pros: model.pros.slice(0, 2),
        untranslated: false,
      });
    }
    expect(modelPresentation(cnn, 'vi', translateModel).description).toContain('Conv-BN-ReLU');
    expect(modelPresentation(cnn, 'vi', translateModel).description).toContain('1989');
    expect(modelPresentation(cnn, 'vi', translateModel).untranslated).toBe(false);
  });

  it('keeps the daemon description when one character changes', () => {
    const description = `${cnn.description.slice(0, -1)}x`;
    expect(description).not.toBe(cnn.description);
    expect(modelPresentation({ ...cnn, description }, 'vi', translateModel)).toEqual({
      description,
      bestFor: cnn.bestFor,
      shortDescription: cnn.shortDescription,
      pros: cnn.pros,
      untranslated: true,
    });
  });

  it.each(['shortDescription', 'first pro', 'second pro'] as const)(
    'renders authoritative English copy and the untranslated note after a changed %s',
    async (field) => {
      const model = Object.freeze({
        ...cnn,
        shortDescription:
          field === 'shortDescription' ? `${cnn.shortDescription}x` : cnn.shortDescription,
        pros: Object.freeze(
          cnn.pros.map((pro, index) =>
            (field === 'first pro' && index === 0) || (field === 'second pro' && index === 1)
              ? `${pro}x`
              : pro,
          ),
        ),
      });
      const session = new ConnectionSession({
        origin: window.location.origin,
        buildId: '1.8.1',
        fetcher: async () => {
          throw new Error('No requests expected');
        },
      });
      const wrapper = mount(
        ModelInspector,
        {
          props: {
            session,
            models: Object.freeze([model]),
            busy: false,
            message: '',
            selection: null,
            pretrained: false,
            inspection: null,
            singleChannel: false,
            disabled: false,
          },
        },
        createTestI18n('vi'),
      );
      expect(wrapper.get('[data-testid="model-card"]').text()).toContain(model.displayName);
      expect(detail(wrapper)).toContain(model.bestFor);
      expect(detail(wrapper)).not.toContain(bundledModelMessages.vi.cnn.bestFor);
      expect(detail(wrapper)).toContain(model.pros[0]);
      expect(detail(wrapper)).toContain(model.pros[1]);
      expect(detail(wrapper)).toContain('không có bản dịch đi kèm khớp nội dung');
      await wrapper.get('[data-testid="model-select"]').trigger('click');
      expect(wrapper.emitted('choose')?.[0]?.[0]).toBe(model);
      wrapper.unmount();
    },
  );

  it('shows translated pros in Vietnamese while English-only cons appear only in English', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async () => {
        throw new Error('No requests expected');
      },
    });
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () =>
          h(ModelInspector, {
            session,
            models: [cnn],
            busy: false,
            message: '',
            selection: null,
            pretrained: false,
            inspection: null,
            singleChannel: false,
            disabled: false,
          });
      },
    });
    const wrapper = mount(Provider);
    expect(detail(wrapper)).toContain('Good at');
    expect(detail(wrapper)).toContain(cnn.pros[0]);
    expect(detail(wrapper)).toContain('Watch out');
    expect(detail(wrapper)).toContain('Limited capacity');
    locale.value = 'vi';
    await nextTick();
    expect(detail(wrapper)).toContain('Điểm mạnh');
    expect(detail(wrapper)).toContain(bundledModelMessages.vi.cnn.pros.first);
    expect(detail(wrapper)).toContain(bundledModelMessages.vi.cnn.pros.second);
    expect(detail(wrapper)).not.toContain(cnn.pros[0]);
    // Cons have no bundled translation, so Vietnamese omits them instead of mixing languages.
    expect(detail(wrapper)).not.toContain('Lưu ý');
    expect(detail(wrapper)).not.toContain('Watch out');
    expect(detail(wrapper)).not.toContain('Limited capacity');
    expect(detail(wrapper)).not.toContain('không có bản dịch đi kèm khớp nội dung');
    locale.value = 'en';
    await nextTick();
    expect(detail(wrapper)).toContain('Watch out');
    expect(detail(wrapper)).toContain('Limited capacity');
    expect(detail(wrapper)).toContain(cnn.pros[0]);
    wrapper.unmount();
  });

  it('reactively translates mounted model browsing while preserving search, unknown text and scoped selection', async () => {
    const models = [
      cnn,
      {
        ...cnn,
        id: 'custom_cnn',
        displayName: 'Custom 東京',
        description: '<script>custom description</script>',
        bestFor: '<script>Original daemon purpose</script>',
      },
    ];
    let catalogueReads = 0;
    const session = await connected((url) => {
      if (!url.endsWith('/api/models')) throw new Error(`Unexpected request: ${url}`);
      catalogueReads++;
      return json({
        source: 'bundled_metadata',
        runtime_verified: false,
        categories: {
          'Classic CNNs': {
            short_description: 'Classics',
            models: models.map((model) => model.id),
          },
        },
        models: models.map((model) => ({
          id: model.id,
          display_name: model.displayName,
          architecture_family: model.architectureFamily,
          author_institution: model.authorInstitution,
          year_published: model.yearPublished,
          params_m: model.paramsM,
          size_mb: model.sizeMb,
          short_description: model.shortDescription,
          description: model.description,
          best_for: model.bestFor,
          pros: model.pros,
          cons: model.cons,
          compute_tier: model.computeTier,
          tags: model.tags,
          supported_dims: model.supportedDims,
          is_pretrained: model.pretrained,
        })),
      });
    });
    const locale = shallowRef<WorkstationLocale>('en');
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(ProjectContainer, { session });
      },
    });
    const wrapper = mount(Provider, {
      global: { stubs: { DatasetPathPicker: true, DatasetInfoPanel: true } },
    });
    await flushPromises();
    await wrapper.get('[data-testid="guide-step-1"]').trigger('click');
    await wrapper.get('[data-model-entry="cnn"]').trigger('click');
    expect(detail(wrapper)).toContain(cnn.bestFor);
    expect(wrapper.text()).toContain('Classic CNNs');
    await wrapper.get('[data-testid="model-search"]').setValue('cnn');
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.get<HTMLInputElement>('[data-testid="model-search"]').element.value).toBe('cnn');
    expect(wrapper.text()).toContain('CNN cổ điển');
    expect(detail(wrapper)).toContain(bundledModelMessages.vi.cnn.bestFor);
    expect(detail(wrapper)).not.toContain(cnn.bestFor);
    expect(detail(wrapper)).toContain(bundledModelMessages.vi.cnn.pros.first);
    expect(detail(wrapper)).toContain(bundledModelMessages.vi.cnn.pros.second);
    expect(detail(wrapper)).not.toContain('không có bản dịch đi kèm khớp nội dung');
    await wrapper.get('[data-model-entry="custom_cnn"]').trigger('click');
    await nextTick();
    expect(detail(wrapper)).toContain('Custom 東京');
    expect(detail(wrapper)).toContain('<script>Original daemon purpose</script>');
    expect(detail(wrapper)).toContain('không có bản dịch đi kèm khớp nội dung');
    expect(wrapper.find('script').exists()).toBe(false);
    await wrapper.get('[data-model-entry="cnn"]').trigger('click');
    await nextTick();
    const choose = wrapper.findAll('button').find((button) => button.text() === 'Dùng mô hình này');
    expect(choose).toBeDefined();
    await choose?.trigger('click');
    await flushPromises();
    const selection = wrapper.getComponent(ModelInspector).props('selection');
    expect(selection).toEqual({ model: 'cnn', daemonId: 'daemon-one' });
    if (!selection) throw new Error('Missing model selection');
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('Đang dùng');
    locale.value = 'en';
    await nextTick();
    expect(detail(wrapper)).toContain(cnn.bestFor);
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('In use');
    expect(wrapper.text()).not.toContain('no matching bundled translation');
    expect(catalogueReads).toBe(1);
    wrapper.unmount();
    session.detach();
  });

  it('switches browse actions and aria labels without translating remote names or changing a selection', async () => {
    const session = await connected((url) => {
      if (url.endsWith('/api/browse')) return json({ roots: [{ id: 'remote-research' }] });
      if (url.includes('/api/browse?'))
        return json({
          root: 'remote-research',
          path: '',
          entries: Array.from({ length: 100 }, (_, index) => ({
            name: index === 0 ? 'wave 東京.npz' : `other-${index}.npz`,
            kind: 'file',
          })),
          total: 101,
          limit: 100,
          offset: 0,
        });
      return json({
        root: 'remote-research',
        relative_path: 'wave 東京.npz',
        path: 'D:\\Research\\wave 東京.npz',
        kind: 'file',
      });
    });
    const locale = shallowRef<WorkstationLocale>('en');
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(BrowseContainer, { session });
      },
    });
    const wrapper = mount(Provider);
    await flushPromises();
    await wrapper.get('[data-testid="dataset-path-search"]').trigger('focus');
    await wrapper.get('[role="option"][data-value="remote-research"]').trigger('click');
    await flushPromises();
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('section').attributes('aria-label')).toBe('Đường dẫn tập dữ liệu');
    expect(wrapper.text()).toContain('1–100 trên 101');
    expect(wrapper.text()).toContain('wave 東京.npz');
    expect(wrapper.get('[aria-label="Đường dẫn tập dữ liệu"]').text()).toContain('remote-research');
    expect(wrapper.get('button[aria-label="Chọn tệp wave 東京.npz"]').text()).toContain('Dùng');
    await wrapper.get('button[aria-label="Chọn tệp wave 東京.npz"]').trigger('click');
    await flushPromises();
    expect(wrapper.getComponent(BrowseContainer).emitted('select')?.[0]?.[0]).toEqual({
      root: 'remote-research',
      relativePath: 'wave 東京.npz',
      path: 'D:\\Research\\wave 東京.npz',
      kind: 'file',
      daemonId: 'daemon-one',
    });
    locale.value = 'en';
    await nextTick();
    expect(wrapper.get('button[aria-label="Select file wave 東京.npz"]').text()).toContain('Use');
    wrapper.unmount();
    session.detach();
  });
});

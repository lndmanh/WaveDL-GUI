// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import { Select } from '@/components/ui/select';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import ModelSelector from '../../app/components/catalog/ModelSelector.vue';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import { bundledModelMessages, modelPresentation } from '../../app/i18n/model-descriptions';
import type { WorkstationLocale } from '../../app/i18n/core';
import { CatalogApi, type ModelDescription } from '../../app/lib/catalog-api';
import { ConnectionSession } from '../../app/lib/connection-session';

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
  category: 'Classic CNNs',
  supportedDims: [1, 2, 3],
  pretrained: false,
  description: bundledModelMessages.en['cnn.description'] ?? '',
  bestFor: bundledModelMessages.en['cnn.bestFor'] ?? '',
};

describe('catalogue localization preserves daemon authority', () => {
  it('covers all 71 complete bundled descriptions and best-for source signatures', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../src/wavedl_daemon/runs/model_metadata.py'),
      'utf8',
    );
    const models = [
      ...source.matchAll(
        /"id": "([^"]+)"[\s\S]*?"description": "([^"]*)"[\s\S]*?"best_for": "([^"]*)"/g,
      ),
    ];
    expect(models).toHaveLength(71);
    expect(Object.keys(bundledModelMessages.en)).toHaveLength(142);
    for (const model of models) {
      expect(bundledModelMessages.en[`${model[1]}.description`]).toBe(model[2]);
      expect(bundledModelMessages.en[`${model[1]}.bestFor`]).toBe(model[3]);
      expect(bundledModelMessages.vi[`${model[1]}.description`]).not.toBe(model[2]);
      expect(bundledModelMessages.vi[`${model[1]}.bestFor`]).not.toBe(model[3]);
    }
  });

  it('never substitutes translations for unknown IDs or changed known metadata', () => {
    for (const model of [
      { ...cnn, id: 'custom_cnn' },
      { ...cnn, description: 'A custom daemon override <script>東京</script>' },
      { ...cnn, bestFor: 'My specialized experiment' },
    ]) {
      expect(modelPresentation(model, 'vi')).toEqual({
        description: model.description,
        bestFor: model.bestFor,
        untranslated: true,
      });
      expect(modelPresentation(model, 'en')).toEqual({
        description: model.description,
        bestFor: model.bestFor,
        untranslated: false,
      });
    }
    expect(modelPresentation(cnn, 'vi').description).toContain('Conv-BN-ReLU');
    expect(modelPresentation(cnn, 'vi').description).toContain('1989');
    expect(modelPresentation(cnn, 'vi').untranslated).toBe(false);
  });

  it('reactively translates mounted model browsing while preserving search, unknown text and scoped selection', async () => {
    const models = [
      cnn,
      {
        ...cnn,
        id: 'custom_cnn',
        displayName: 'Custom 東京',
        description: '<script>custom description</script>',
        bestFor: 'Original daemon purpose',
      },
    ];
    let catalogueReads = 0;
    const session = await connected(() => {
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
          description: model.description,
          best_for: model.bestFor,
          supported_dims: model.supportedDims,
          is_pretrained: model.pretrained,
        })),
      });
    });
    const locale = shallowRef<WorkstationLocale>('en');
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(ModelSelector, { session });
      },
    });
    const wrapper = mount(Provider);
    await flushPromises();
    expect(wrapper.text()).toContain(cnn.description);
    expect(wrapper.text()).toContain('not runtime certification');
    await wrapper.get('input').setValue('cnn');
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('input').element.value).toBe('cnn');
    expect(wrapper.text()).toContain('CNN cổ điển');
    expect(wrapper.text()).toContain('Mô tả, không phải chứng nhận khi chạy');
    expect(wrapper.text()).toContain('Mạng nơ-ron tích chập cơ bản');
    expect(wrapper.text()).toContain('<script>custom description</script>');
    expect(wrapper.text()).toContain('Original daemon purpose');
    expect(wrapper.text()).toContain('không có bản dịch đi kèm khớp nội dung');
    expect(wrapper.find('script').exists()).toBe(false);
    const choose = wrapper.findAll('button').find((button) => button.text() === 'Chọn CNN');
    expect(choose).toBeDefined();
    await choose?.trigger('click');
    const selection = wrapper.getComponent(ModelSelector).emitted('select')?.[0]?.[0];
    expect(selection).toEqual({ model: 'cnn', daemonId: 'daemon-one' });
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toContain(cnn.description);
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
          entries: [{ name: 'wave 東京.npz', kind: 'file' }],
          total: 1,
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
    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'remote-research');
    await flushPromises();
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('section').attributes('aria-label')).toBe('Tệp trên daemon');
    expect(wrapper.text()).toContain('remote-research');
    expect(wrapper.text()).toContain('wave 東京.npz');
    expect(wrapper.text()).toContain('1–1 trên 1');
    expect(wrapper.get('button[aria-label="Chọn tệp wave 東京.npz"]').text()).toBe('Chọn tệp');
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
    expect(wrapper.get('button[aria-label="Select file wave 東京.npz"]').text()).toBe(
      'Select file',
    );
    wrapper.unmount();
    session.detach();
  });
});

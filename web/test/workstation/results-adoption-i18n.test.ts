// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { useForm } from 'vee-validate';
import { clientError } from '../../app/i18n/client-messages';
import enResults from '../../app/i18n/locales/en/results.json';
import viResults from '../../app/i18n/locales/vi/results.json';
import ArtifactList from '../../app/components/results/ArtifactList.vue';
import InferenceFields from '../../app/components/results/InferenceFields.vue';
import AutomaticPlotStatus from '../../app/components/results/AutomaticPlotStatus.vue';
import AdoptRunPanel from '../../app/components/runs/AdoptRunPanel.vue';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';
import { inferenceDefaults } from '../../shared/schemas/result-request';
import type { AutomaticPlotState } from '../../app/lib/autoplot-controller';

function json(body: object) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

describe('results and adoption language presentation', () => {
  it('reactively translates artifact and automatic plot controls without changing emitted identity', async () => {
    const i18n = createTestI18n('en');
    const plotState = ref<AutomaticPlotState>({
      status: 'error',
      message: 'raw runtime diagnostic 42',
      plotRunId: null,
    });
    const artifact = {
      runId: 'run-id',
      generation: 'gen-000001',
      attempt: 2,
      step: 0,
      path: 'raw-name.png',
      size: 1024,
      sha256: 'a'.repeat(64),
    };
    const Host = defineComponent({
      setup: () => () =>
        h('main', [
          h(ArtifactList, { artifacts: [artifact], busy: false }),
          h(AutomaticPlotStatus, {
            state: plotState.value,
          }),
        ]),
    });
    const wrapper = mount(Host, undefined, i18n);
    expect(wrapper.text()).toContain('Download');
    i18n.global.locale.value = 'vi';
    await flushPromises();
    expect(wrapper.text()).toContain('Tải xuống');
    expect(wrapper.text()).toContain('Thử lại biểu đồ tự động');
    expect(wrapper.text()).toContain('raw-name.png');
    expect(wrapper.text()).toContain('raw runtime diagnostic 42');
    const list = wrapper.getComponent(ArtifactList);
    await list.get('button').trigger('click');
    expect(list.emitted('download')).toEqual([[artifact]]);
    const plots = wrapper.getComponent(AutomaticPlotStatus);
    await plots.get('button').trigger('click');
    expect(plots.emitted('retry')).toEqual([[]]);
    plotState.value = {
      status: 'submitted',
      message: clientError('autoPlotAcknowledged'),
      plotRunId: 'unchanged-run-id',
    };
    await flushPromises();
    expect(plots.text()).toContain('Daemon đã xác nhận tác vụ vẽ biểu đồ chẩn đoán.');
    await plots.get('button').trigger('click');
    expect(plots.emitted('monitor')).toEqual([['unchanged-run-id']]);
    wrapper.unmount();
  });

  it('changes inference labels without resetting edited values or machine enum values', async () => {
    const i18n = createTestI18n('en');
    const Host = defineComponent({
      setup() {
        useForm({ initialValues: { config: structuredClone(inferenceDefaults) } });
        return () => h('form', [h(InferenceFields, { disabled: false })]);
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await wrapper.get('#inference-batch_size').setValue('42');
    await wrapper.get('#inference-input_key').setValue('raw_input_key');
    await wrapper.get('#inference-import-modules').setValue('custom_registration');
    i18n.global.locale.value = 'vi';
    await flushPromises();
    expect(wrapper.text()).toContain('Kích thước lô suy luận');
    expect(wrapper.get<HTMLInputElement>('#inference-batch_size').element.value).toBe('42');
    expect(wrapper.get<HTMLInputElement>('#inference-input_key').element.value).toBe(
      'raw_input_key',
    );
    expect(wrapper.get<HTMLSelectElement>('#inference-format').element.value).toBe('auto');
    expect(wrapper.get('#inference-format option').text()).toBe('Tự động');
    expect(wrapper.text()).toContain('Mô-đun đăng ký tùy chỉnh');
    expect(wrapper.get<HTMLInputElement>('#inference-import-modules').element.value).toBe(
      'custom_registration',
    );
    wrapper.unmount();
  });

  it('preserves acknowledgement uncertainty and the exact retained adoption body/key across a locale switch', async () => {
    const i18n = createTestI18n('en');
    const requests: { body: BodyInit | null | undefined; key: string | null }[] = [];
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === '/api/health')
          return json({ daemon_id: 'daemon', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
        if (path === '/api/browse') return json({ roots: [{ id: 'runs' }] });
        if (path === '/api/browse/resolve')
          return json({
            root: 'runs',
            relative_path: 'raw-source',
            kind: 'directory',
            path: '/runs/raw-source',
          });
        requests.push({ body: init?.body, key: new Headers(init?.headers).get('Idempotency-Key') });
        throw new Error('lost acknowledgement');
      },
    });
    await session.connect('token');
    const directory = await new CatalogApi(session).resolve('runs', 'raw-source');
    const Host = defineComponent({
      setup: () => () => h(AdoptRunPanel, { session }),
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    const panel = wrapper.getComponent(AdoptRunPanel);
    panel.getComponent(BrowseContainer).vm.$emit('select', directory);
    await panel.get('form').trigger('submit');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.waitFor(() => expect(panel.text()).toContain('Retained request:'));
    i18n.global.locale.value = 'vi';
    await flushPromises();
    expect(panel.attributes('aria-label')).toBe('Tiếp nhận lần chạy độc lập');
    expect(panel.text()).toContain('Yêu cầu được giữ lại: /runs/raw-source');
    expect(panel.text()).toContain('Thử lại yêu cầu tiếp nhận đã giữ');
    expect(panel.text()).toContain('Chưa rõ kết quả xác nhận tiếp nhận.');
    expect(panel.get('input[type=number]').attributes('disabled')).toBeDefined();
    expect(requests).toHaveLength(1);
    await session.reconnect('token');
    const current = await new CatalogApi(session).resolve('runs', 'raw-source');
    panel.getComponent(BrowseContainer).vm.$emit('select', current);
    await panel.get('form').trigger('submit');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual(requests[0]);
    expect(JSON.parse(String(requests[0]?.body))).toEqual({ path: '/runs/raw-source', attempt: 1 });
    wrapper.unmount();
    session.detach();
  });

  it('keeps every results catalog key and interpolation placeholder paired', () => {
    expect(Object.keys(viResults)).toEqual(Object.keys(enResults));
    for (const key in enResults) expect(key in viResults).toBe(true);
  });
});

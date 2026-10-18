// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import options from '../../shared/training-options.json';
import {
  trainingDefaults,
  trainingConfigSchema,
  trainingFieldMetadata,
  trainingRequestSchema,
} from '../../shared/schemas/training-request';
import TrainingFields from '../../workstation/components/project/TrainingFields.vue';
import ProjectContainer from '../../workstation/components/project/ProjectContainer.vue';
import BrowseContainer from '../../workstation/components/catalog/BrowseContainer.vue';
import CustomModelSelector from '../../workstation/components/project/CustomModelSelector.vue';
import PlanApproval from '../../workstation/components/project/PlanApproval.vue';
import TrainingExport from '../../workstation/components/project/TrainingExport.vue';
import TrainingDefaultsSettings from '../../workstation/components/settings/TrainingDefaultsSettings.vue';
import { provideWorkstationLocale } from '../../workstation/composables/useWorkstationI18n';
import {
  trainingFieldMessageKeys,
  trainingFieldMessages,
} from '../../workstation/i18n/training-fields';
import { translateMessage, type WorkstationLocale } from '../../workstation/i18n/core';
import { ConnectionSession } from '../../workstation/lib/connection-session';
import { CatalogApi } from '../../workstation/lib/catalog-api';
import { ProjectPlan } from '../../workstation/lib/project-plan';
import { trainingCommand, trainingYaml } from '../../workstation/lib/training-export';

describe('project presentation localization', () => {
  it('keeps coexisting hidden project and settings control IDs unique and checkbox names reactive', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async () => {
        throw new Error('Disconnected');
      },
    });
    const host = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () =>
          h('main', [
            h('div', { style: { display: 'none' } }, [h(ProjectContainer, { session: owner })]),
            h(TrainingDefaultsSettings, { daemonId: 'daemon-one' }),
          ]);
      },
    });
    const wrapper = mount(host, { attachTo: document.body });
    await flushPromises();
    const controls = wrapper.findAll('[id*="-training-"]');
    const ids = controls.map((control) => control.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(wrapper.findAll('[id$="-training-deterministic"]')).toHaveLength(2);
    for (const checkbox of wrapper.findAll('[role="checkbox"][id*="-training-"]')) {
      const id = checkbox.attributes('id');
      const label = wrapper.get(`label[for="${id}"]`);
      expect(checkbox.attributes('aria-label')).toBe(label.text());
      expect(label.text()).not.toBe('');
    }
    locale.value = 'vi';
    await nextTick();
    expect(controls.map((control) => control.attributes('id'))).toEqual(ids);
    for (const checkbox of wrapper.findAll('[role="checkbox"][id*="-training-"]')) {
      const id = checkbox.attributes('id');
      const label = wrapper.get(`label[for="${id}"]`);
      expect(checkbox.attributes('aria-label')).toBe(label.text());
      expect(label.text()).not.toBe('');
    }
    for (const checkbox of wrapper.findAll('[role="checkbox"][id$="-training-deterministic"]'))
      expect(checkbox.attributes('aria-label')).toBe('Chế độ xác định');
    locale.value = 'en';
    await nextTick();
    for (const checkbox of wrapper.findAll('[role="checkbox"][id$="-training-deterministic"]'))
      expect(checkbox.attributes('aria-label')).toBe('deterministic');
    wrapper.unmount();
    owner.detach();
  });

  it('has explicit Vietnamese labels and descriptions for all 46 CLI destinations, including selection-owned fields', () => {
    expect(options).toHaveLength(46);
    expect(Object.keys(trainingFieldMessageKeys).sort()).toEqual(
      options.map((option) => option.name).sort(),
    );
    for (const [name, keys] of Object.entries(trainingFieldMessageKeys)) {
      const option = options.find((option) => option.name === name);
      expect(option).toBeDefined();
      expect(trainingFieldMessages.en[keys.label]).toBe(name.replaceAll('_', ' '));
      expect(trainingFieldMessages.en[keys.description]).toBe(option?.description);
      expect(trainingFieldMessages.vi[keys.label]).not.toBe(trainingFieldMessages.en[keys.label]);
      expect(trainingFieldMessages.vi[keys.description]).not.toBe(
        trainingFieldMessages.en[keys.description],
      );
    }
  });

  it('reactively translates all editable controls while retaining draft values and CLI option values', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    let snapshot = () => '';
    const host = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        const { values } = useForm({
          initialValues: { config: structuredClone(trainingDefaults) },
          validationSchema: z.object({ config: trainingConfigSchema }),
        });
        snapshot = () => JSON.stringify(values);
        return () => h(TrainingFields, { disabled: false });
      },
    });
    const wrapper = mount(host);
    await flushPromises();
    await wrapper.get('[id$="-training-batch_size"]').setValue('37');
    const draft = snapshot();
    const values = wrapper.findAll('option').map((option) => option.attributes('value'));
    locale.value = 'vi';
    await nextTick();
    for (const option of trainingFieldMetadata) {
      const keys = Object.entries(trainingFieldMessageKeys).find(
        ([name]) => name === option.name,
      )?.[1];
      if (!keys) throw new Error(`Missing field ${option.name}`);
      expect(wrapper.get(`label[for$="-training-${option.name}"]`).text()).toBe(
        translateMessage(trainingFieldMessages, 'vi', keys.label),
      );
      expect(wrapper.text()).toContain(
        translateMessage(trainingFieldMessages, 'vi', keys.description),
      );
    }
    expect(snapshot()).toBe(draft);
    expect(wrapper.findAll('option').map((option) => option.attributes('value'))).toEqual(values);
    expect(wrapper.text()).toContain('không bao giờ xóa dữ liệu lần chạy trước');
    locale.value = 'en';
    await nextTick();
    expect(wrapper.get('label[for$="-training-batch_size"]').text()).toBe('batch size');
    expect(snapshot()).toBe(draft);
    wrapper.unmount();
  });

  it('keeps a persisted approval and exact submission body across a live locale switch', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const ids = {
      plan_id: '11111111-1111-4111-8111-111111111111',
      run_id: '22222222-2222-4222-8222-222222222222',
      request_id: '33333333-3333-4333-8333-333333333333',
    };
    const calls: { path: string; body: string }[] = [];
    const manifest = JSON.stringify({
      config: { model: 'custom_model', data_path: '/data/English name.npz' },
      warning: 'Do not translate daemon evidence',
    });
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({ path, body: String(init?.body ?? '') });
        const response = (value: object) =>
          new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
        if (path === '/api/health')
          return response({
            daemon_id: 'daemon-one',
            build_id: '1.8.1',
            protocol_min: 1,
            protocol_max: 1,
          });
        if (path === '/api/browse/resolve')
          return response({
            root: 'data',
            relative_path: 'English name.npz',
            path: '/data/English name.npz',
            kind: 'file',
          });
        if (path === '/api/runs/plan')
          return response({ ...ids, preview: { manifest_json: manifest } });
        if (path === '/api/runs')
          return response({
            ...ids,
            backend: 'local',
            operation: 'train',
            state: 'submitted',
            attempt: null,
            uncertainty: false,
            submission_requested: true,
            cancellation_requested: false,
            evidence: null,
          });
        throw new Error(`Unexpected route ${path}`);
      },
    });
    await owner.connect('credential');
    const catalogue = new CatalogApi(owner);
    const data = await catalogue.resolve('data', 'English name.npz');
    const model = await catalogue.selectCustomModel('custom_model');
    const invalidate = vi.spyOn(ProjectPlan.prototype, 'invalidate');
    const host = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(ProjectContainer, { session: owner });
      },
    });
    const wrapper = mount(host, {
      global: { stubs: { BrowseContainer: true, ModelSelector: true, DatasetInfoPanel: true } },
    });
    wrapper.getComponent(BrowseContainer).vm.$emit('select', data);
    wrapper.getComponent(CustomModelSelector).vm.$emit('select', model);
    await nextTick();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    const form = wrapper
      .findAll('form')
      .find((form) => form.find('input[name="runtime.python"]').exists());
    if (!form) throw new Error('Missing editor form');
    await form.trigger('submit');
    await vi.waitFor(() => expect(wrapper.findComponent(PlanApproval).exists()).toBe(true));
    const preview = wrapper.getComponent(PlanApproval).props('plan');
    const draft = wrapper.getComponent(TrainingExport).props('draft');
    const yaml = trainingYaml(draft);
    const command = trainingCommand(draft);
    const invalidations = invalidate.mock.calls.length;
    const requests = calls.length;
    locale.value = 'vi';
    await nextTick();
    expect(invalidate.mock.calls.length).toBe(invalidations);
    expect(calls).toHaveLength(requests);
    expect(wrapper.getComponent(PlanApproval).props('plan')).toBe(preview);
    expect(wrapper.text()).toContain('/data/English name.npz');
    expect(wrapper.text()).toContain('Do not translate daemon evidence');
    expect(wrapper.text()).toContain('Kế hoạch đã lưu để phê duyệt');
    expect(trainingYaml(wrapper.getComponent(TrainingExport).props('draft'))).toBe(yaml);
    expect(trainingCommand(wrapper.getComponent(TrainingExport).props('draft'))).toBe(command);
    await wrapper.getComponent(PlanApproval).get('button').trigger('click');
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.path === '/api/runs')).toHaveLength(1),
    );
    expect(calls.find((call) => call.path === '/api/runs')?.body).toBe(
      JSON.stringify({ plan_id: ids.plan_id }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain(`${ids.run_id} · đã gửi`);
    wrapper.unmount();
    owner.detach();
    invalidate.mockRestore();
  });

  it('translates a stored exporter rejection live without changing the draft or exposing credentials', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const draft = trainingRequestSchema.parse({
      backend: 'local',
      operation: 'train',
      config: structuredClone(trainingDefaults),
      runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'auto', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    });
    const original = JSON.stringify(draft);
    const host = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(TrainingExport, { draft, disabled: false });
      },
    });
    const wrapper = mount(host);
    await wrapper.findAll('button')[1]?.trigger('click');
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Choose explicit CPU or CUDA for a reproducible standalone command.',
    );
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toContain('Chọn rõ CPU hoặc CUDA');
    expect(JSON.stringify(draft)).toBe(original);
    wrapper.unmount();
  });
});

// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import TrainingPresets from '../../workstation/components/project/TrainingPresets.vue';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';
import { applyTrainingPreset, trainingPresetSchema } from '../../workstation/lib/training-presets';
import { ConnectionSession } from '../../workstation/lib/connection-session';
import { CatalogApi } from '../../workstation/lib/catalog-api';
import { ProjectPlan } from '../../workstation/lib/project-plan';
import type { z } from 'zod';

async function setup() {
  const json = (body: object) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/health')
      return json({ daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
    if (path === '/api/browse/resolve')
      return json({
        root: 'data',
        relative_path: 'train.npz',
        path: '/data/train.npz',
        kind: 'file',
      });
    if (path === '/api/runs/plan')
      return json({
        plan_id: '11111111-1111-4111-8111-111111111111',
        run_id: '22222222-2222-4222-8222-222222222222',
        request_id: '33333333-3333-4333-8333-333333333333',
        preview: {},
      });
    throw new Error(`Unexpected route ${path}`);
  });
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher,
  });
  await session.connect('credential');
  const catalog = new CatalogApi(session);
  const data = await catalog.resolve('data', 'train.npz');
  const model = await catalog.selectCustomModel('custom_net');
  const draft = shallowRef(
    trainingRequestSchema.parse({
      backend: 'local',
      operation: 'train',
      config: {
        ...structuredClone(trainingDefaults),
        model: model.model,
        data_path: data.path,
        import_modules: ['trusted.custom_models'],
        constraint_file: '/verified/constraints.py',
        resume: '/verified/checkpoint.pth',
      },
      runtime: {
        python: '/usr/bin/python3',
        mode: 'existing',
        device: 'cpu',
        environment: {},
      },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    }),
  );
  const workflow = new ProjectPlan(session);
  workflow.prepare(draft.value, data, model);
  const approved = await workflow.preview();
  const onApply = vi.fn((preset: z.infer<typeof trainingPresetSchema>) => {
    draft.value = {
      ...draft.value,
      config: applyTrainingPreset(draft.value.config, preset),
    };
    workflow.invalidate();
  });
  const host = defineComponent({
    setup: () => () => h(TrainingPresets, { disabled: false, onApply }),
  });
  const wrapper = mount(host);
  await flushPromises();
  async function upload(preset: object) {
    const input = wrapper.get('input[type="file"]');
    if (!(input.element instanceof HTMLInputElement)) throw new Error('Missing file input');
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([JSON.stringify(preset)], 'preset.json', { type: 'application/json' }),
    );
    input.element.files = transfer.files;
    await input.trigger('change');
    await flushPromises();
  }
  return { wrapper, draft, workflow, approved, onApply, fetcher, session, upload };
}

describe('mounted JSON preset import authority', () => {
  it.each([
    { import_modules: ['foreign.module'] },
    { import_modules: [] },
    { import_modules: null },
    { constraint_file: '/foreign/constraints.py' },
    { constraint_file: '' },
    { constraint_file: null },
    { resume: '/foreign/checkpoint.pth' },
    { resume: '' },
    { resume: null },
    { config: { epochs: 100, import_modules: ['foreign.module'] } },
  ])(
    'rejects forbidden JSON %j without changing the draft or its existing approval',
    async (patch) => {
      const fixture = await setup();
      try {
        const before = structuredClone(fixture.draft.value);
        const key = fixture.workflow.key;
        const calls = fixture.fetcher.mock.calls.length;
        await fixture.upload({ epochs: 100, ...patch });
        expect(fixture.wrapper.get('[role="status"]').text()).toContain('Invalid preset.');
        expect(fixture.wrapper.getComponent(TrainingPresets).emitted('apply')).toBeUndefined();
        expect(fixture.onApply).not.toHaveBeenCalled();
        expect(fixture.draft.value).toEqual(before);
        expect(fixture.workflow.approved).toBe(fixture.approved);
        expect(fixture.workflow.key).toBe(key);
        expect(fixture.fetcher.mock.calls).toHaveLength(calls);
      } finally {
        fixture.wrapper.unmount();
        fixture.session.detach();
      }
    },
  );

  it('applies safe JSON, retains manual code/checkpoint settings and invalidates approval', async () => {
    const fixture = await setup();
    try {
      const before = structuredClone(fixture.draft.value);
      const preset = { epochs: 123, lr: 0.004, batch_size: 32 };
      await fixture.upload(preset);
      expect(fixture.onApply).toHaveBeenCalledExactlyOnceWith(preset);
      expect(fixture.wrapper.get('[role="status"]').text()).toContain('Validated preset applied');
      expect(fixture.draft.value).toEqual({
        ...before,
        config: { ...before.config, ...preset },
      });
      expect(fixture.workflow.approved).toBeNull();
    } finally {
      fixture.wrapper.unmount();
      fixture.session.detach();
    }
  });
});

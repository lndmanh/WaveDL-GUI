// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import CustomModelSelector from '../../app/components/project/CustomModelSelector.vue';
import PlanApproval from '../../app/components/project/PlanApproval.vue';
import ProjectGuide from '../../app/components/project/ProjectGuide.vue';
import TrainingExport from '../../app/components/project/TrainingExport.vue';
import TrainingPresets from '../../app/components/project/TrainingPresets.vue';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';

const ids = {
  plan_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  request_id: '33333333-3333-4333-8333-333333333333',
};
const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
const plan = { ...ids, preview: { manifest_json: '{}' } };
const refusal = 'The daemon refused this plan. Correct the settings and preview again.';
const uncertain =
  'The request was not acknowledged; server work may already exist. Reconnect if needed, then retry preview with this unchanged draft, or check/retry the approved submission. Never create a replacement draft merely to retry.';
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function response(value: object, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function setup(timeoutMs = 1000) {
  let planResponse: () => Promise<Response> = async () =>
    response({ detail: 'sensitive internal detail' }, 400);
  let operationStatus = 200;
  const calls: string[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    timeoutMs,
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/api/health') return response(health);
      if (path === '/api/browse/resolve')
        return response({
          root: 'data',
          relative_path: 'train.npz',
          path: '/data/train.npz',
          kind: 'file',
        });
      if (path === '/api/runs/plan') {
        expect(new Headers(init?.headers).get('Authorization')).toBe(
          'Bearer session000000000000000000000000000000000001',
        );
        return planResponse();
      }
      if (path === '/api/runs' || path === `/api/runs/${ids.run_id}`)
        return response({ detail: 'sensitive internal detail' }, operationStatus);
      throw new Error(`Unexpected route ${path}`);
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
  if (wrapper.getComponent(ProjectGuide).props('enabled'))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Show full editor')
      ?.trigger('click');
  const catalogue = new CatalogApi(session);
  const data = await catalogue.resolve('data', 'train.npz');
  wrapper.getComponent(DatasetPathPicker).vm.$emit('select', data);
  const model = await catalogue.selectCustomModel('custom_model');
  wrapper.getComponent(CustomModelSelector).vm.$emit('select', model);
  await nextTick();
  await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
  const editor = wrapper
    .findAll('form')
    .find((form) => form.find('input[name="runtime.python"]').exists());
  if (!editor) throw new Error('Missing project form');
  return {
    wrapper,
    session,
    editor,
    calls,
    respond(work: () => Promise<Response>) {
      planResponse = work;
    },
    operationStatus(status: number) {
      operationStatus = status;
    },
  };
}

describe('project plan refusal feedback', () => {
  it('shows a safe refusal, retains the exact draft, and previews again after correction', async () => {
    const { wrapper, editor, calls, respond } = await setup();
    const draftBefore = JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'));
    await editor.trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain(refusal));
    expect(wrapper.text()).not.toContain('sensitive internal detail');
    expect(JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'))).toBe(draftBefore);
    expect(
      wrapper.get('button[aria-label^="Dataset: /data/train.npz"]').attributes('aria-label'),
    ).toBe('Dataset: /data/train.npz · daemon daemon-one. Browser files are not uploaded.');
    expect(wrapper.find('button[aria-label^="Dataset: Dataset:"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Model: custom_model');
    expect(calls.filter((path) => path === '/api/runs/plan')).toHaveLength(1);
    expect(wrapper.findComponent(PlanApproval).exists()).toBe(false);
    expect(wrapper.emitted('submitted')).toBeUndefined();

    respond(async () => response(plan));
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await editor.trigger('submit');
    await vi.waitFor(() => expect(wrapper.findComponent(PlanApproval).exists()).toBe(true));
    expect(calls.filter((path) => path === '/api/runs/plan')).toHaveLength(2);
    expect(calls.filter((path) => path === '/api/runs')).toHaveLength(0);
  });

  it.each(['http 500', 'network', 'timeout'])(
    'never mistakes %s for a refused plan',
    async (failure) => {
      const { wrapper, editor, calls, respond } = await setup(failure === 'timeout' ? 25 : 1000);
      respond(async () => {
        if (failure === 'http 500') return response({ detail: 'sensitive internal detail' }, 500);
        if (failure === 'network') throw new Error('sensitive transport detail');
        return new Promise<Response>(() => {});
      });
      const draftBefore = JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'));
      await editor.trigger('submit');
      await vi.waitFor(() =>
        expect(wrapper.text()).toContain(
          failure === 'http 500' ? uncertain : 'Verified connection required',
        ),
      );
      expect(wrapper.text()).not.toContain(refusal);
      expect(wrapper.text()).not.toContain('sensitive transport detail');
      expect(JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'))).toBe(draftBefore);
      expect(wrapper.findComponent(PlanApproval).exists()).toBe(false);
      expect(calls.filter((path) => path === '/api/runs/plan')).toHaveLength(1);
      expect(calls.filter((path) => path === '/api/runs')).toHaveLength(0);
    },
  );

  it.each(['draft change', 'session retirement'])(
    'ignores a late refusal after %s',
    async (change) => {
      const { wrapper, session, editor, respond, calls } = await setup();
      let release: ((value: Response) => void) | undefined;
      respond(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      );
      await editor.trigger('submit');
      await vi.waitFor(() =>
        expect(calls.filter((path) => path === '/api/runs/plan')).toHaveLength(1),
      );
      if (change === 'draft change') {
        wrapper.getComponent(TrainingPresets).vm.$emit('apply', { epochs: 17 });
        await vi.waitFor(() =>
          expect(wrapper.get('[id$="-training-epochs"]').element.value).toBe('17'),
        );
      } else session.detach();
      if (!release) throw new Error('Missing pending response');
      release(response({ detail: 'sensitive internal detail' }, 400));
      await flushPromises();
      expect(wrapper.text()).not.toContain(refusal);
      expect(wrapper.text()).not.toContain(uncertain);
      expect(wrapper.findComponent(PlanApproval).exists()).toBe(false);
      expect(calls.filter((path) => path === '/api/runs/plan')).toHaveLength(1);
      expect(calls.filter((path) => path === '/api/runs')).toHaveLength(0);
    },
  );

  it.each(['submit', 'status'])(
    'never treats an approved %s HTTP400 as plan refusal',
    async (operation) => {
      const { wrapper, editor, respond, operationStatus } = await setup();
      respond(async () => response(plan));
      await editor.trigger('submit');
      await vi.waitFor(() => expect(wrapper.findComponent(PlanApproval).exists()).toBe(true));
      operationStatus(400);
      wrapper.getComponent(PlanApproval).vm.$emit(operation);
      await vi.waitFor(() => expect(wrapper.text()).toContain(uncertain));
      expect(wrapper.text()).not.toContain(refusal);
      expect(wrapper.text()).not.toContain('sensitive internal detail');
      expect(wrapper.findComponent(PlanApproval).exists()).toBe(true);
      expect(wrapper.emitted('submitted')).toBeUndefined();
    },
  );
});

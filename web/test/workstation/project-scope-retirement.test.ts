// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { ConnectionSession } from '../../app/lib/connection-session';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import CustomModelSelector from '../../app/components/project/CustomModelSelector.vue';
import PlanApproval from '../../app/components/project/PlanApproval.vue';
import ProjectGuide from '../../app/components/project/ProjectGuide.vue';
import TrainingExport from '../../app/components/project/TrainingExport.vue';

const ids = {
  plan_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  request_id: '33333333-3333-4333-8333-333333333333',
};
const plan = { ...ids, preview: { manifest_json: '{}' } };
const run = {
  ...ids,
  backend: 'local',
  operation: 'train',
  state: 'submitted',
  attempt: null,
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: null,
};
function response(value: object) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});
async function setup(onSubmitted?: (session: ConnectionSession) => void) {
  let daemon = 'daemon-a';
  let blockedPath = '';
  let release: ((value: Response) => void) | undefined;
  const calls: string[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === blockedPath)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      if (path === '/api/health')
        return response({ daemon_id: daemon, build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
      if (path === '/api/browse/resolve')
        return response({
          root: 'data',
          relative_path: 'train.npz',
          path: '/data/train.npz',
          kind: 'file',
        });
      if (path === '/api/runs/plan') return response(plan);
      if (path === '/api/runs' || path === `/api/runs/${ids.run_id}`) return response(run);
      throw new Error(`Unexpected route ${path}`);
    },
  });
  expect(await session.connect('credential-a')).toBe(true);
  const wrapper = mount(ProjectContainer, {
    props: { session, onSubmitted: () => onSubmitted?.(session) },
    global: { stubs: { BrowseContainer: true, ModelSelector: true, DatasetInfoPanel: true } },
  });
  cleanups.push(() => {
    wrapper.unmount();
    session.detach();
  });
  if (wrapper.getComponent(ProjectGuide).props('enabled'))
    await button(wrapper, 'Show full editor').trigger('click');
  const catalogue = new CatalogApi(session);
  const data = await catalogue.resolve('data', 'train.npz');
  const model = await catalogue.selectCustomModel('custom_model');
  wrapper.getComponent(BrowseContainer).vm.$emit('select', data);
  wrapper.getComponent(CustomModelSelector).vm.$emit('select', model);
  await nextTick();
  await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
  await wrapper.get('[id$="-training-epochs"]').setValue('17');
  const preview = async () => {
    await editorForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(wrapper.findComponent(PlanApproval).exists()).toBe(true));
  };
  const reconnect = async () => {
    daemon = 'daemon-b';
    await session.connect('credential-b');
    await flushPromises();
  };
  return {
    wrapper,
    session,
    preview,
    reconnect,
    calls,
    data,
    model,
    block(path: string) {
      blockedPath = path;
    },
    release(value: object) {
      if (!release) throw new Error('No pending request');
      release(response(value));
    },
  };
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
  const found = wrapper.findAll('button').find((entry) => entry.text() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function editorForm(wrapper: ReturnType<typeof mount>) {
  const found = wrapper
    .findAll('form')
    .find((form) => form.find('input[name="runtime.python"]').exists());
  if (!found) throw new Error('Missing project form');
  return found;
}
describe('project daemon scope retirement', () => {
  it.each(['submit', 'status'])(
    'does not emit the approved plan when a synchronous %s acknowledgment listener detaches',
    async (operation) => {
      const fixture = await setup((session) => session.detach());
      await fixture.preview();
      await button(
        fixture.wrapper,
        operation === 'submit' ? 'Approve and start this plan' : 'Check submission status',
      ).trigger('click');
      await flushPromises();
      expect(fixture.wrapper.emitted('submitted')).toHaveLength(1);
      expect(fixture.wrapper.emitted('submittedPlan')).toBeUndefined();
      expect(fixture.wrapper.text()).not.toContain(ids.run_id);
      expect(fixture.wrapper.findComponent(PlanApproval).exists()).toBe(false);
    },
  );

  it('retires acknowledgment, grants, approval, reset confirmation and progress on local detach before daemon B', async () => {
    const fixture = await setup();
    const { wrapper, session } = fixture;
    await fixture.preview();
    await button(wrapper, 'Approve and start this plan').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Daemon acknowledged the run'));
    const approved = wrapper.getComponent(PlanApproval).props('plan');
    await session.refresh();
    expect(wrapper.getComponent(PlanApproval).props('plan')).toBe(approved);
    expect(wrapper.text()).toContain('Daemon acknowledged the run');
    await wrapper.get('[id$="-training-epochs"]').setValue('18');
    expect(wrapper.text()).toContain('Daemon acknowledged the run');
    await button(wrapper, 'Reset training defaults').trigger('click');
    await button(wrapper, 'Use guided steps').trigger('click');
    await button(wrapper, 'Next step').trigger('click');
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(1);
    const emitted = wrapper.emitted('submitted')?.length;
    const draft = JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'));
    session.detach();
    await nextTick();
    expect(wrapper.text()).not.toContain('Daemon acknowledged the run');
    expect(wrapper.text()).not.toContain('Open acknowledged run');
    expect(wrapper.findComponent(PlanApproval).exists()).toBe(false);
    expect(wrapper.find('[aria-label="Confirm reset"]').exists()).toBe(false);
    expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(0);
    expect(wrapper.getComponent(ProjectGuide).props('enabled')).toBe(true);
    expect(wrapper.text()).toContain('Dataset: Not selected');
    expect(wrapper.text()).toContain('Model: Not selected');
    expect(JSON.stringify(wrapper.getComponent(TrainingExport).props('draft'))).toBe(draft);
    await fixture.reconnect();
    wrapper.getComponent(BrowseContainer).vm.$emit('select', fixture.data);
    wrapper.getComponent(CustomModelSelector).vm.$emit('select', fixture.model);
    await nextTick();
    expect(wrapper.text()).toContain('Dataset: Not selected');
    expect(wrapper.text()).toContain('Model: Not selected');
    expect(wrapper.emitted('submitted')?.length).toBe(emitted);
    expect(wrapper.text()).not.toContain(ids.run_id);
  });

  it('clears daemon-reported status and acknowledged navigation on session prop replacement', async () => {
    const fixture = await setup();
    await fixture.preview();
    await button(fixture.wrapper, 'Check submission status').trigger('click');
    await vi.waitFor(() => expect(fixture.wrapper.text()).toContain('Daemon reports submitted'));
    const replacement = new ConnectionSession({
      origin: 'http://localhost:9999',
      buildId: '1.8.1',
    });
    await fixture.wrapper.setProps({ session: replacement });
    expect(fixture.wrapper.text()).not.toContain('Daemon reports');
    expect(fixture.wrapper.text()).not.toContain(ids.run_id);
    await fixture.session.refresh();
    expect(fixture.wrapper.text()).toContain('Verified connection required');
  });

  it('does not publish an already-resolved submission after its UI scope retires', async () => {
    const fixture = await setup();
    await fixture.preview();
    const originalSubmit = ProjectPlan.prototype.submit;
    vi.spyOn(ProjectPlan.prototype, 'submit').mockImplementationOnce(async function (signal) {
      const result = await originalSubmit.call(this, signal);
      queueMicrotask(() => fixture.session.detach());
      return result;
    });
    await button(fixture.wrapper, 'Approve and start this plan').trigger('click');
    await flushPromises();
    expect(fixture.calls).toContain('/api/runs');
    expect(fixture.wrapper.emitted('submitted')).toBeUndefined();
    expect(fixture.wrapper.emitted('submittedPlan')).toBeUndefined();
    expect(fixture.wrapper.text()).not.toContain(ids.run_id);
    expect(fixture.wrapper.text()).not.toContain('Planning status');
    await fixture.reconnect();
    expect(fixture.wrapper.text()).not.toContain('Open acknowledged run');
  });

  it.each(['preview', 'submit', 'status'])(
    'discards a late %s response after detach and daemon replacement',
    async (operation) => {
      const fixture = await setup();
      const { wrapper } = fixture;
      if (operation !== 'preview') await fixture.preview();
      const path =
        operation === 'preview'
          ? '/api/runs/plan'
          : operation === 'submit'
            ? '/api/runs'
            : `/api/runs/${ids.run_id}`;
      fixture.block(path);
      if (operation === 'preview') await editorForm(wrapper).trigger('submit');
      else
        await button(
          wrapper,
          operation === 'submit' ? 'Approve and start this plan' : 'Check submission status',
        ).trigger('click');
      await vi.waitFor(() => expect(fixture.calls).toContain(path));
      await vi.waitFor(() => expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(true));
      fixture.session.detach();
      await fixture.reconnect();
      fixture.release(operation === 'preview' ? plan : run);
      await flushPromises();
      expect(wrapper.findComponent(PlanApproval).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(ids.run_id);
      expect(wrapper.text()).not.toContain('Planning status');
      expect(wrapper.emitted('submitted')).toBeUndefined();
      expect(wrapper.emitted('submittedPlan')).toBeUndefined();
      expect(wrapper.getComponent(ProjectGuide).props('busy')).toBe(false);
      expect(wrapper.getComponent(ProjectGuide).props('step')).toBe(0);
    },
  );
});

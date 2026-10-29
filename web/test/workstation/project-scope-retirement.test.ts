// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ConfigMenu from '../../app/components/project/ConfigMenu.vue';
import RunPipeline from '../../app/components/project/RunPipeline.vue';
import {
  activeBlock,
  builderForm,
  builderStubs,
  button,
  chooseSelections,
  installMemoryStorage,
  modelCatalogue,
} from './project-builder-fixture';

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
beforeEach(() => {
  installMemoryStorage();
});
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
      if (path === '/api/models') return response(modelCatalogue);
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
    global: { stubs: builderStubs },
  });
  cleanups.push(() => {
    wrapper.unmount();
    session.detach();
  });
  const catalogue = new CatalogApi(session);
  const data = await catalogue.resolve('data', 'train.npz');
  const model = await catalogue.selectCustomModel('custom_model');
  await chooseSelections(wrapper, data, model);
  await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
  await wrapper.get('[id$="-training-epochs"]').setValue('17');
  const preview = async () => {
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(planShown(wrapper)).toBe(true));
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
function planShown(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('#approved-plan-title').exists();
}
function draft(wrapper: ReturnType<typeof mount>) {
  return JSON.stringify(wrapper.getComponent(ConfigMenu).props('draft'));
}
function pipelineBlock(wrapper: ReturnType<typeof mount>, index: number) {
  return wrapper.get(`[data-testid="guide-step-${index}"]`);
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
      expect(planShown(fixture.wrapper)).toBe(false);
    },
  );

  it('retires acknowledgment, grants, approval, reset confirmation and progress on local detach before daemon B', async () => {
    const fixture = await setup();
    const { wrapper, session } = fixture;
    await fixture.preview();
    await button(wrapper, 'Approve and start this plan').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Daemon acknowledged the run'));
    expect(wrapper.find('[aria-label="Acknowledged training run"]').exists()).toBe(true);
    // A same-daemon refresh keeps the acknowledgment and the approved plan it belongs to.
    await session.refresh();
    expect(wrapper.find('[aria-label="Acknowledged training run"]').exists()).toBe(true);
    expect(wrapper.text()).toContain(ids.run_id);
    // A later edit never retires the acknowledged run: it stays one click away,
    // while the edited draft becomes a new plan rather than a locked one.
    await wrapper.get('[id$="-training-epochs"]').setValue('18');
    expect(wrapper.text()).toContain('Daemon acknowledged this exact plan.');
    expect(wrapper.text()).toContain('Open acknowledged run');
    expect(wrapper.getComponent(RunPipeline).props('reviewLabel')).toBe('Create plan');
    await wrapper.get('[role="tab"][id$="-tab-model"]').trigger('click');
    expect(activeBlock(wrapper)).toBe('model');
    const emitted = wrapper.emitted('submitted')?.length;
    const before = draft(wrapper);
    session.detach();
    await nextTick();
    expect(wrapper.text()).not.toContain('Daemon acknowledged the run');
    expect(wrapper.text()).not.toContain('Daemon acknowledged this exact plan.');
    expect(wrapper.text()).not.toContain('Open acknowledged run');
    expect(wrapper.getComponent(RunPipeline).props('reviewLabel')).toBe('Create plan');
    expect(wrapper.getComponent(RunPipeline).props('reviewDisabled')).toBe(true);
    expect(planShown(wrapper)).toBe(false);
    expect(pipelineBlock(wrapper, 0).text()).toContain('Not selected');
    expect(pipelineBlock(wrapper, 1).text()).toContain('Not selected');
    expect(pipelineBlock(wrapper, 4).attributes('data-state')).toBe('pending');
    // Training and runtime values are browser-local and survive the daemon's scope.
    expect(draft(wrapper)).toBe(before);
    await fixture.reconnect();
    // Selections branded for daemon A are refused under daemon B.
    await chooseSelections(wrapper, fixture.data, fixture.model);
    expect(pipelineBlock(wrapper, 0).text()).toContain('Not selected');
    expect(pipelineBlock(wrapper, 1).text()).toContain('Not selected');
    expect(wrapper.emitted('submitted')?.length).toBe(emitted);
    expect(wrapper.text()).not.toContain(ids.run_id);
  });

  // Known regression: TrainingInspector owns the confirmation locally and nothing retires it
  // with the daemon scope. Remove `.fails` once a detach clears the pending confirmation.
  it('retires a pending reset confirmation on local detach', async () => {
    const fixture = await setup();
    await button(fixture.wrapper, 'Reset training defaults').trigger('click');
    expect(fixture.wrapper.find('[aria-label="Confirm reset"]').exists()).toBe(true);
    fixture.session.detach();
    await nextTick();
    expect(fixture.wrapper.find('[aria-label="Confirm reset"]').exists()).toBe(false);
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
      if (operation === 'preview') await builderForm(wrapper).trigger('submit');
      else
        await button(
          wrapper,
          operation === 'submit' ? 'Approve and start this plan' : 'Check submission status',
        ).trigger('click');
      await vi.waitFor(() => expect(fixture.calls).toContain(path));
      await vi.waitFor(() =>
        expect(wrapper.getComponent(RunPipeline).props('reviewBusy')).toBe(true),
      );
      fixture.session.detach();
      await fixture.reconnect();
      fixture.release(operation === 'preview' ? plan : run);
      await flushPromises();
      expect(planShown(wrapper)).toBe(false);
      expect(wrapper.text()).not.toContain(ids.run_id);
      expect(wrapper.text()).not.toContain('Planning status');
      expect(wrapper.emitted('submitted')).toBeUndefined();
      expect(wrapper.emitted('submittedPlan')).toBeUndefined();
      expect(wrapper.getComponent(RunPipeline).props('reviewBusy')).toBe(false);
      expect(wrapper.text()).not.toContain('Waiting for daemon…');
      expect(pipelineBlock(wrapper, 0).attributes('data-state')).toBe('pending');
      expect(pipelineBlock(wrapper, 1).attributes('data-state')).toBe('pending');
    },
  );
});

// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { toRaw } from 'vue';
import AdoptRunPanel from '../../app/components/runs/AdoptRunPanel.vue';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';
const runId = '22222222-2222-4222-8222-222222222222';
function json(body: object) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
function ack() {
  return json({
    plan_id: '11111111-1111-4111-8111-111111111111',
    run_id: runId,
    request_id: '33333333-3333-4333-8333-333333333333',
    operation: 'train',
    attempt: 1,
    backend: 'local',
    state: 'supervision_lost',
    uncertainty: true,
    submission_requested: true,
    cancellation_requested: false,
    backend_status: 'unknown',
    adopted: true,
  });
}
async function connection(reply: () => Promise<Response> = async () => ack()) {
  const calls: string[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/health')
        return json({ daemon_id: 'daemon', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
      if (path === '/api/browse') return json({ roots: [{ id: 'runs' }] });
      if (path === '/api/browse/resolve')
        return json({
          root: 'runs',
          relative_path: 'source',
          kind: 'directory',
          path: '/runs/source',
        });
      calls.push(path);
      return reply();
    },
  });
  await session.connect('token');
  const directory = await new CatalogApi(session).resolve('runs', 'source');
  return { session, directory, calls };
}
async function setup(reply: () => Promise<Response> = async () => ack()) {
  const { session, directory, calls } = await connection(reply);
  const wrapper = mount(AdoptRunPanel, { props: { session } });
  await flushPromises();
  return { wrapper, session, directory, calls };
}
describe('adoption form ownership boundary', () => {
  it('adopts through the replacement session and clears the previous selection', async () => {
    const { wrapper, session, directory, calls } = await setup();
    const replacement = await connection();
    wrapper.getComponent(BrowseContainer).vm.$emit('select', directory);
    await flushPromises();
    await wrapper.setProps({ session: replacement.session });
    await flushPromises();
    expect(toRaw(wrapper.getComponent(BrowseContainer).props('session'))).toBe(replacement.session);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls).toHaveLength(0);
    expect(replacement.calls).toHaveLength(0);
    wrapper.getComponent(BrowseContainer).vm.$emit('select', replacement.directory);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.emitted('adoptedRunId')).toEqual([[runId]]));
    expect(calls).toHaveLength(0);
    expect(replacement.calls).toEqual(['/api/runs/adopt']);
    expect(wrapper.get('[role="status"]').text()).toContain('Daemon ownership confirmed');
    expect(wrapper.get('section').attributes('aria-busy')).toBe('false');
    expect(
      wrapper.get('button[aria-label^="Ownership confirmed"]').attributes('aria-label'),
    ).toContain('Daemon ownership confirmed');
    wrapper.unmount();
    session.detach();
    replacement.session.detach();
  });
  it.each(['confirmed', 'failed'])(
    'ignores a retired session %s outcome during replacement adoption',
    async (outcome) => {
      let finishOld: ((response: Response) => void) | undefined;
      let failOld: ((reason: Error) => void) | undefined;
      const { wrapper, session, directory, calls } = await setup(
        () =>
          new Promise((resolve, reject) => {
            finishOld = resolve;
            failOld = reject;
          }),
      );
      let finishCurrent: ((response: Response) => void) | undefined;
      const replacement = await connection(
        () =>
          new Promise((resolve) => {
            finishCurrent = resolve;
          }),
      );
      wrapper.getComponent(BrowseContainer).vm.$emit('select', directory);
      await wrapper.get('form').trigger('submit');
      await vi.waitFor(() => expect(calls).toEqual(['/api/runs/adopt']));
      await wrapper.setProps({ session: replacement.session });
      await flushPromises();
      expect(wrapper.get('section').attributes('aria-busy')).toBe('false');
      wrapper.getComponent(BrowseContainer).vm.$emit('select', replacement.directory);
      await wrapper.get('form').trigger('submit');
      await vi.waitFor(() => expect(replacement.calls).toEqual(['/api/runs/adopt']));
      if (outcome === 'confirmed') finishOld?.(ack());
      else failOld?.(new Error('retired acknowledgement lost'));
      await flushPromises();
      expect(wrapper.emitted('adoptedRunId')).toBeUndefined();
      expect(wrapper.get('section').attributes('aria-busy')).toBe('true');
      expect(wrapper.get('input[type=number]').attributes('disabled')).toBeDefined();
      expect(wrapper.text()).not.toContain('acknowledgement is unknown');
      expect(wrapper.text()).not.toContain('Daemon ownership confirmed');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(replacement.calls).toHaveLength(1);
      finishCurrent?.(ack());
      await vi.waitFor(() => expect(wrapper.emitted('adoptedRunId')).toEqual([[runId]]));
      expect(wrapper.get('section').attributes('aria-busy')).toBe('false');
      expect(
        wrapper.get('button[aria-label^="Ownership confirmed"]').attributes('aria-label'),
      ).toContain('Daemon ownership confirmed');
      expect(calls).toEqual(['/api/runs/adopt']);
      expect(replacement.calls).toEqual(['/api/runs/adopt']);
      wrapper.unmount();
      session.detach();
      replacement.session.detach();
    },
  );
  it('validates the runtime attempt before contacting adoption', async () => {
    const { wrapper, session, directory, calls } = await setup();
    wrapper.getComponent(BrowseContainer).vm.$emit('select', directory);
    await wrapper.get('input[type=number]').setValue('0');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.get('input[type=number]').attributes('aria-invalid')).toBe('true'),
    );
    expect(calls).toHaveLength(0);
    expect(wrapper.emitted('adoptedRunId')).toBeUndefined();
    wrapper.unmount();
    session.detach();
  });
  it('browses only configured roots and requires explicit confirmation', async () => {
    const { wrapper, session, directory, calls } = await setup();
    expect(wrapper.find('input[type=file]').exists()).toBe(false);
    expect(wrapper.getComponent(BrowseContainer).props('allowDirectory')).toBe(true);
    wrapper.getComponent(BrowseContainer).vm.$emit('select', directory);
    await flushPromises();
    expect(calls).toHaveLength(0);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.emitted('adoptedRunId')).toEqual([[runId]]));
    expect(
      wrapper.get('button[aria-label^="Ownership confirmed"]').attributes('aria-label'),
    ).toContain('Daemon ownership confirmed');
    expect(wrapper.text()).toContain('does not establish live supervision');
    expect(calls).toEqual(['/api/runs/adopt']);
    wrapper.unmount();
    session.detach();
  });
  it('rejects a forged directory event without any POST', async () => {
    const { wrapper, directory, calls, session } = await setup();
    wrapper.getComponent(BrowseContainer).vm.$emit('select', { ...directory });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls).toHaveLength(0);
    expect(wrapper.emitted('adoptedRunId')).toBeUndefined();
    wrapper.unmount();
    session.detach();
  });
  it('does not repeat POST or cancel a process when closed while awaiting acknowledgement', async () => {
    let finish: ((response: Response) => void) | undefined;
    const { wrapper, directory, calls, session } = await setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    wrapper.getComponent(BrowseContainer).vm.$emit('select', directory);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls).toHaveLength(1);
    wrapper.unmount();
    finish?.(ack());
    await flushPromises();
    expect(calls).toEqual(['/api/runs/adopt']);
    expect(wrapper.emitted('adoptedRunId')).toBeUndefined();
    session.detach();
  });
  it('lost ack retains request, requires current browse revalidation, and does not silently retry', async () => {
    let failed = true;
    const { wrapper, directory, calls, session } = await setup(async () => {
      if (failed) throw new Error('lost ack');
      return ack();
    });
    wrapper.getComponent(BrowseContainer).vm.$emit('select', directory);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('acknowledgement is unknown'));
    expect(wrapper.get('input[type=number]').attributes('disabled')).toBeDefined();
    failed = false;
    await session.reconnect('token');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls).toHaveLength(1);
    const current = await new CatalogApi(session).resolve('runs', 'source');
    wrapper.getComponent(BrowseContainer).vm.$emit('select', current);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.emitted('adoptedRunId')).toEqual([[runId]]));
    expect(calls).toHaveLength(2);
    wrapper.unmount();
    session.detach();
  });
});

// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toRaw } from 'vue';
import ResultsContainer from '../../workstation/components/results/ResultsContainer.vue';
import CvSummaryPanel from '../../workstation/components/results/CvSummaryPanel.vue';
import ResultOperationForm from '../../workstation/components/results/ResultOperationForm.vue';
import { ConnectionSession, type ConnectionState } from '../../workstation/lib/connection-session';
import * as artifactClient from '../../workstation/lib/artifact-client';

const runId = '22222222-2222-4222-8222-222222222222';
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise not initialized');
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function json(body: object) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
function inventory(path: string, size = 5, sha256 = 'a'.repeat(64)) {
  return json({
    generations: [
      { generation: 'gen-000001', attempt: 1, step: 0, files: { [path]: { size, sha256 } } },
    ],
  });
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});
async function owner(
  daemonId: string,
  publication: () => Promise<Response> | Response,
  download?: () => Promise<Response> | Response,
) {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (init?.signal) signals.push(init.signal);
      if (path === '/api/health')
        return json({ daemon_id: daemonId, build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
      if (path === '/api/browse') return json({ roots: [] });
      if (path.endsWith('/artifacts')) return publication();
      if (download) return download();
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  cleanups.push(() => session.detach());
  expect(await session.connect(`token-${daemonId}`)).toBe(true);
  return { session, calls, signals };
}
function results(session: ConnectionSession) {
  const wrapper = mount(ResultsContainer, { props: { session, runId } });
  cleanups.push(() => wrapper.unmount());
  return wrapper;
}

describe('results session replacement ownership', () => {
  it('remounts captured children and retires selections for the same run and generation', async () => {
    const a = await owner('A', () => inventory('cv_summary.json'));
    const b = await owner('B', () => inventory('cv_summary.json'));
    let retiredListener: ((state: ConnectionState) => void) | undefined;
    const originalSubscribe = a.session.subscribe.bind(a.session);
    vi.spyOn(a.session, 'subscribe').mockImplementation((listener) => {
      retiredListener ??= listener;
      return originalSubscribe(listener);
    });
    const wrapper = results(a.session);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const oldCv = wrapper.getComponent(CvSummaryPanel);
    const oldForm = wrapper.getComponent(ResultOperationForm);
    await oldCv.get('select').setValue('gen-000001');
    await oldForm.get('#result-operation').setValue('plot');
    const priorACalls = a.calls.length;

    await wrapper.setProps({ session: b.session });
    expect(wrapper.text()).not.toContain('cv_summary.json');
    expect(wrapper.findComponent(ResultOperationForm).exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const cv = wrapper.getComponent(CvSummaryPanel);
    const form = wrapper.getComponent(ResultOperationForm);
    expect(cv.vm).not.toBe(oldCv.vm);
    expect(form.vm).not.toBe(oldForm.vm);
    expect(toRaw(cv.props('session'))).toBe(b.session);
    expect(toRaw(form.props('session'))).toBe(b.session);
    expect(cv.get('select').element.value).toBe('');
    expect(form.get('#result-operation').element.value).toBe('test');
    expect(b.calls).toContain('/api/browse');
    expect(a.calls).toHaveLength(priorACalls);

    if (!retiredListener) throw new Error('Missing retired subscription');
    retiredListener({
      status: 'disconnected',
      revision: 999,
      health: null,
      message: null,
      buildMismatch: false,
    });
    await flushPromises();
    expect(wrapper.text()).toContain('cv_summary.json');
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    b.session.detach();
    await flushPromises();
    expect(a.session.snapshot().status).toBe('connected');
    expect(wrapper.text()).not.toContain('cv_summary.json');
    expect(wrapper.findComponent(CvSummaryPanel).exists()).toBe(false);
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('aborts an A inventory and rejects its late completion after B replacement', async () => {
    const pending = deferred<Response>();
    const a = await owner('A', () => pending.promise);
    const b = await owner('B', () => inventory('B.onnx'));
    const wrapper = results(a.session);
    await wrapper.get('button').trigger('click');
    await wrapper.setProps({ session: b.session });
    expect(a.signals.at(-1)?.aborted).toBe(true);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    pending.resolve(inventory('A.onnx'));
    await flushPromises();
    expect(wrapper.text()).toContain('B.onnx');
    expect(wrapper.text()).not.toContain('A.onnx');
    expect(wrapper.text()).not.toContain('could not be loaded');
    expect(a.session.snapshot().status).toBe('connected');
  });

  it('retires pending work synchronously when the run identity changes', async () => {
    const pending = deferred<Response>();
    let initial = true;
    const a = await owner('A', () => {
      if (initial) {
        initial = false;
        return pending.promise;
      }
      return inventory('current.onnx');
    });
    const wrapper = results(a.session);
    await wrapper.get('button').trigger('click');
    await wrapper.setProps({ runId: '44444444-4444-4444-8444-444444444444' });
    expect(a.signals.at(-1)?.aborted).toBe(true);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    pending.resolve(inventory('retired.onnx'));
    await flushPromises();
    expect(wrapper.text()).toContain('current.onnx');
    expect(wrapper.text()).not.toContain('retired.onnx');
    expect(a.calls).toContain('/api/runs/44444444-4444-4444-8444-444444444444/artifacts');
  });

  it('does not publish a pending A blob after replacement', async () => {
    const pending = deferred<Response>();
    const a = await owner(
      'A',
      () => inventory('A.png'),
      () => pending.promise,
    );
    const b = await owner('B', () => inventory('B.onnx'));
    const create = vi.spyOn(URL, 'createObjectURL');
    const wrapper = results(a.session);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const preview = wrapper.findAll('button').find((button) => button.text() === 'View PNG');
    if (!preview) throw new Error('Missing preview action');
    await preview.trigger('click');
    await wrapper.setProps({ session: b.session });
    pending.resolve(new Response('bytes'));
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('verification failed');
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
  });

  it('retires A decode and revokes B images when B detaches while A stays connected', async () => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([73, 72, 68, 82], 12);
    view.setUint32(16, 1);
    view.setUint32(20, 1);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const download = () =>
      new Response(bytes, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '33' },
      });
    const a = await owner('A', () => inventory('A.png', 33, hash), download);
    const b = await owner('B', () => inventory('B.png', 33, hash), download);
    const pending = deferred<Blob>();
    vi.spyOn(artifactClient, 'pngPreviewBlob').mockImplementationOnce(() => pending.promise);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current-B');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const wrapper = results(a.session);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const previewA = wrapper.findAll('button').find((button) => button.text() === 'View PNG');
    if (!previewA) throw new Error('Missing A preview');
    await previewA.trigger('click');
    await vi.waitFor(() => expect(artifactClient.pngPreviewBlob).toHaveBeenCalledTimes(1));
    await wrapper.setProps({ session: b.session });
    pending.resolve(new Blob([bytes], { type: 'image/png' }));
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const previewB = wrapper.findAll('button').find((button) => button.text() === 'View PNG');
    if (!previewB) throw new Error('Missing B preview');
    await previewB.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('img').exists()).toBe(true));
    b.session.detach();
    await flushPromises();
    expect(a.session.snapshot().status).toBe('connected');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('B.png');
    expect(revoke).toHaveBeenCalledWith('blob:current-B');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});

// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ResultsContainer from '../../app/components/results/ResultsContainer.vue';
import ArtifactList from '../../app/components/results/ArtifactList.vue';
import { ConnectionSession } from './session-fixture';
import type { RunView } from '../../app/lib/daemon-api';
import type { RunEvent } from '../../app/lib/event-stream';
import type { RunMonitorSnapshot } from '../../app/lib/run-monitor';

const run: RunView = {
  run_id: '22222222-2222-4222-8222-222222222222',
  plan_id: '11111111-1111-4111-8111-111111111111',
  request_id: '33333333-3333-4333-8333-333333333333',
  backend: 'local',
  operation: 'test',
  attempt: 1,
  state: 'completed',
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: null,
};
const event: RunEvent = {
  protocol: 'wavedl-jsonl',
  version: 1,
  run_id: run.run_id,
  attempt: 1,
  seq: 1,
  type: 'metric',
  ts: '2026-10-08T00:00:00Z',
  payload: { name: 'evaluation', metrics: { mae_avg: 0.125 } },
};
function monitor(
  view: RunView,
  freshness: RunMonitorSnapshot['freshness'],
  events: RunEvent[],
): RunMonitorSnapshot {
  return {
    run: view,
    freshness,
    events,
    liveEvents: events,
    stream: 'stopped',
    message: '',
    cancellation: 'idle',
    truncated: false,
    metrics: [],
    summary: { progress: null, best: null, latest: null },
  };
}
function json(body: object) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

describe('results monitor and published artifacts', () => {
  it('downloads unchanged verified bytes using provenance labels, not backend paths', async () => {
    const bytes = new TextEncoder().encode('metric,value\nmae,0.125\n');
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const calls: string[] = [];
    let generations = ['gen-000001', 'gen-000002'];
    let paths = ['results/metrics.csv'];
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (path === '/api/health')
          return json({ daemon_id: 'd', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
        if (path === '/api/browse') return json({ roots: [] });
        if (path.endsWith('/artifacts'))
          return json({
            generations: generations.map((generation) => ({
              generation,
              attempt: 1,
              step: 0,
              files: Object.fromEntries(
                paths.map((path) => [path, { size: bytes.length, sha256 }]),
              ),
            })),
          });
        return new Response(bytes, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(bytes.length),
          },
        });
      },
    });
    const saved: string[] = [];
    const blobs: Blob[] = [];
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error('Expected verified blob');
      blobs.push(blob);
      return 'blob:verified-artifact';
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    expect(await session.connect('token')).toBe(true);
    const wrapper = mount(ResultsContainer, { props: { session, runId: run.run_id } });
    try {
      await wrapper.get('[data-testid="results-refresh"]').trigger('click');
      await flushPromises();
      for (const download of wrapper
        .findAll('button')
        .filter((button) => button.text() === 'Download')) {
        await download.trigger('click');
        await vi.waitFor(() => expect(download.attributes('disabled')).toBeUndefined());
      }
      expect(saved).toEqual(
        ['gen-000001', 'gen-000002'].map((generation) => `${run.run_id}_${generation}_metrics.csv`),
      );
      expect(await Promise.all(blobs.map((blob) => blob.text()))).toEqual([
        new TextDecoder().decode(bytes),
        new TextDecoder().decode(bytes),
      ]);
      for (const generation of ['gen-000001', 'gen-000002'])
        expect(calls).toContain(
          `/api/runs/${run.run_id}/artifacts/${generation}/results/metrics.csv`,
        );
      generations = ['gen-000003'];
      paths = ['left/metrics.csv', 'right/metrics.csv', 'METRICS.csv'];
      await wrapper.get('[data-testid="results-refresh"]').trigger('click');
      await flushPromises();
      for (const download of wrapper
        .findAll('button')
        .filter((button) => button.text() === 'Download')) {
        await download.trigger('click');
        await vi.waitFor(() => expect(download.attributes('disabled')).toBeUndefined());
      }
      expect(saved).toHaveLength(5);
      expect(new Set(saved.slice(2).map((name) => name.toLowerCase())).size).toBe(3);
      expect(saved.slice(2).every((name) => name.startsWith(`${run.run_id}_gen-000003_`))).toBe(
        true,
      );
      for (const path of paths)
        expect(calls).toContain(`/api/runs/${run.run_id}/artifacts/gen-000003/${path}`);
      generations = [`gen-${'9'.repeat(61)}`];
      await wrapper.get('[data-testid="results-refresh"]').trigger('click');
      await flushPromises();
      const unsupported = wrapper.findAll('button').find((button) => button.text() === 'Download');
      if (!unsupported) throw new Error('Missing artifact download action');
      await unsupported.trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('No file was published.'));
      expect(saved).toHaveLength(5);
      expect(create).toHaveBeenCalledTimes(5);
      session.detach();
      await flushPromises();
      expect(wrapper.findAll('button').some((button) => button.text() === 'Download')).toBe(false);
      expect(saved).toHaveLength(5);
    } finally {
      wrapper.unmount();
      session.detach();
      create.mockRestore();
      click.mockRestore();
    }
  });
  it('retains published download actions for train, empty test, stale and evaluated monitors', async () => {
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input) =>
        String(input).endsWith('/api/health')
          ? json({ daemon_id: 'd', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 })
          : String(input).endsWith('/api/browse')
            ? json({ roots: [] })
            : json({
                generations: [
                  {
                    generation: 'gen-000001',
                    attempt: 1,
                    step: 0,
                    files: { 'model.onnx': { size: 5, sha256: 'a'.repeat(64) } },
                  },
                ],
              }),
    });
    expect(await session.connect('token')).toBe(true);
    const wrapper = mount(ResultsContainer, {
      props: {
        session,
        runId: run.run_id,
        monitor: monitor({ ...run, operation: 'train' }, 'fresh', [event]),
      },
    });
    await wrapper.get('[data-testid="results-refresh"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('model.onnx'));
    for (const snapshot of [
      monitor({ ...run, operation: 'train' }, 'fresh', [event]),
      monitor(run, 'fresh', []),
      monitor(run, 'stale', [event]),
      monitor(run, 'fresh', [event]),
    ]) {
      await wrapper.setProps({ monitor: snapshot });
      expect(wrapper.findComponent(ArtifactList).exists()).toBe(true);
      const download = wrapper.findAll('button').find((button) => button.text() === 'Download');
      expect(download?.attributes('disabled')).toBeUndefined();
      expect(download?.exists()).toBe(true);
      expect(wrapper.text().includes('Evaluation metrics')).toBe(
        snapshot.freshness === 'fresh' &&
          snapshot.run?.operation === 'test' &&
          snapshot.events.length > 0,
      );
    }
    await wrapper.setProps({
      monitor: monitor({ ...run, run_id: '44444444-4444-4444-8444-444444444444' }, 'fresh', [
        event,
      ]),
    });
    expect(wrapper.text()).not.toContain('Evaluation metrics');
    expect(wrapper.text()).toContain('model.onnx');
    session.detach();
    await flushPromises();
    expect(wrapper.text()).not.toContain('model.onnx');
    expect(wrapper.text()).not.toContain('Evaluation metrics');
    wrapper.unmount();
  });
});

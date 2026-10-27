// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { describe, expect, it } from 'vitest';
import EvaluationResultsPanel from '../../app/components/results/EvaluationResultsPanel.vue';
import type { RunView } from '../../app/lib/daemon-api';
import type { RunEvent } from '../../app/lib/event-stream';
import RunDetail from '../../app/components/runs/RunDetail.vue';
import type { RunMonitorSnapshot } from '../../app/lib/run-monitor';

const run: RunView = {
  run_id: '22222222-2222-4222-8222-222222222222',
  plan_id: '11111111-1111-4111-8111-111111111111',
  request_id: '33333333-3333-4333-8333-333333333333',
  backend: 'local',
  operation: 'test',
  attempt: 2,
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
  attempt: 2,
  seq: 5,
  type: 'metric',
  ts: '2026-10-08T00:00:00Z',
  payload: {
    name: 'evaluation',
    metrics: { mae_avg: 0.125, r2: null, parameter: '<img src=x onerror=alert(1)>' },
  },
};
describe('structured evaluation rendering', () => {
  it('mounts the structured consumer in selected run detail and hides historic output when pending or stale', async () => {
    const snapshot: RunMonitorSnapshot = {
      run,
      freshness: 'fresh',
      events: [event],
      liveEvents: [event],
      stream: 'stopped',
      message: '',
      cancellation: 'idle',
      truncated: false,
      metrics: [],
      summary: { progress: null, best: null, latest: null },
    };
    const wrapper = mount(RunDetail, {
      props: { snapshot },
      global: { stubs: { MetricsChart: true } },
    });
    expect(wrapper.text()).toContain('Evaluation metrics');
    await wrapper.setProps({
      snapshot: { ...snapshot, run: { ...run, evidence: { native_pending: true } } },
    });
    expect(wrapper.text()).not.toContain('Evaluation metrics');
    await wrapper.setProps({ snapshot: { ...snapshot, freshness: 'stale' } });
    expect(wrapper.text()).not.toContain('Evaluation metrics');
    wrapper.unmount();
  });
  it('renders current evaluation values safely and suppresses stale lifecycle scopes', async () => {
    const wrapper = mount(EvaluationResultsPanel, {
      props: { run, events: [event], freshness: 'fresh' },
    });
    expect(wrapper.text()).toContain('mae avg');
    expect(wrapper.text()).toContain('0.125');
    expect(wrapper.text()).toContain('Not available');
    expect(wrapper.find('img').exists()).toBe(false);
    for (const update of [
      { run: { ...run, attempt: 3 } },
      { run: { ...run, uncertainty: true } },
      { run: { ...run, evidence: { native_pending: true } } },
      { run, freshness: 'stale' as const },
      { run, freshness: 'unconfirmed' as const },
    ]) {
      await wrapper.setProps({ freshness: 'fresh', ...update });
      expect(wrapper.find('dl').exists()).toBe(false);
    }
    wrapper.unmount();
  });
  it('uses latest structured evaluation sequence, never log text', () => {
    const wrapper = mount(EvaluationResultsPanel, {
      props: {
        run,
        freshness: 'fresh',
        events: [
          { ...event, seq: 7, payload: { name: 'evaluation', metrics: { mae_avg: 0.5 } } },
          event,
          { ...event, seq: 8, type: 'log', payload: { text: 'mae_avg=0.001' } },
        ],
      },
    });
    expect(wrapper.text()).toContain('0.5');
    expect(wrapper.text()).not.toContain('0.125');
    expect(wrapper.text()).not.toContain('0.001');
    wrapper.unmount();
  });
});

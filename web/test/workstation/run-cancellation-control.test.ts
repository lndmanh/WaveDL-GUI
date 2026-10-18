// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RunDetail from '../../workstation/components/runs/RunDetail.vue';
import type { RunMonitorSnapshot } from '../../workstation/lib/run-monitor';

function snapshot(): RunMonitorSnapshot {
  return {
    run: {
      run_id: 'run',
      request_id: 'request',
      plan_id: 'plan',
      backend: 'local',
      operation: 'train',
      attempt: 1,
      state: 'running',
      uncertainty: false,
      submission_requested: true,
      cancellation_requested: false,
      evidence: null,
    },
    freshness: 'fresh',
    events: [],
    liveEvents: [],
    stream: 'live',
    message: '',
    cancellation: 'idle',
    truncated: false,
    metrics: [],
    summary: { progress: null, best: null, latest: null },
  };
}

describe('run cancellation control', () => {
  it('disables acknowledged intent without inventing terminal state; unknown outcome remains retryable', async () => {
    const initial = snapshot();
    const wrapper = mount(RunDetail, {
      props: { snapshot: initial },
      global: { stubs: { MetricsChart: true } },
    });
    const button = () =>
      wrapper.findAll('button').find((item) => item.text() === 'Request cancellation')!;
    expect(button().attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ snapshot: { ...initial, cancellation: 'requested' } });
    expect(button().attributes('disabled')).toBeDefined();
    await button().trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.get('[data-slot="badge"]').text()).toBe('running');
    await wrapper.setProps({ snapshot: { ...initial, cancellation: 'unknown' } });
    expect(button().attributes('disabled')).toBeUndefined();
    await button().trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    await wrapper.setProps({
      snapshot: {
        ...initial,
        run: { ...initial.run!, cancellation_requested: true, state: 'stopping' },
      },
    });
    expect(button().attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-slot="badge"]').text()).toBe('stopping');
    wrapper.unmount();
  });
  it('renders no cancellation authority for absent or confirmed terminal runs', async () => {
    const initial = snapshot();
    const wrapper = mount(RunDetail, {
      props: { snapshot: initial },
      global: { stubs: { MetricsChart: true } },
    });
    const button = () =>
      wrapper.findAll('button').find((item) => item.text() === 'Request cancellation')!;
    await wrapper.setProps({ snapshot: { ...initial, run: null } });
    expect(button().attributes('disabled')).toBeDefined();
    await wrapper.setProps({
      snapshot: { ...initial, run: { ...initial.run!, state: 'completed' } },
    });
    expect(button().attributes('disabled')).toBeDefined();
    await wrapper.setProps({
      snapshot: {
        ...initial,
        run: { ...initial.run!, state: 'supervision_lost', uncertainty: true },
      },
    });
    expect(button().attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});

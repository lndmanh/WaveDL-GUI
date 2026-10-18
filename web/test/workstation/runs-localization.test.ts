// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { provideWorkstationLocale } from '../../workstation/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../workstation/i18n/core';
import MetricSummary from '../../workstation/components/runs/MetricSummary.vue';
import StateBadge from '../../workstation/components/runs/StateBadge.vue';
import LogPanel from '../../workstation/components/runs/LogPanel.vue';
import RunList from '../../workstation/components/runs/RunList.vue';
import RunDetail from '../../workstation/components/runs/RunDetail.vue';
import EvaluationResultsPanel from '../../workstation/components/results/EvaluationResultsPanel.vue';
import type { RunView } from '../../workstation/lib/daemon-api';
import type { RunEvent } from '../../workstation/lib/event-stream';

const run: RunView = {
  run_id: 'raw-run',
  plan_id: 'raw-plan',
  request_id: 'raw-request',
  backend: 'local',
  operation: 'test',
  attempt: 1,
  state: 'running',
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: {},
};
const event: RunEvent = {
  protocol: 'wavedl-jsonl',
  version: 1,
  run_id: run.run_id,
  attempt: 1,
  seq: 1,
  ts: '2026-10-08T00:00:00Z',
  type: 'log',
  payload: { message: 'Training loss' },
};
describe('run presentation localization', () => {
  it('renders every scheduler/lifecycle state without collapsing uncertainty', async () => {
    const states = [
      ['queued', false, 'queued'],
      ['held', false, 'held'],
      ['running', false, 'running'],
      ['terminal_unknown', true, 'terminal unknown'],
      ['observation_unavailable', true, 'observation unavailable'],
      ['supervision_lost', true, 'supervision lost'],
      ['completed', false, 'completed'],
    ] as const;
    const locale = shallowRef<WorkstationLocale>('en');
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () =>
            h(
              'div',
              states.map(([state, uncertainty]) =>
                h(StateBadge, {
                  key: state,
                  run: { ...run, run_id: `run-${state}`, state, uncertainty },
                }),
              ),
            );
        },
      }),
    );
    const text = wrapper.text();
    for (const [, , label] of states) expect(text).toContain(label);
    expect(
      wrapper.findAll('[data-slot="badge"]').filter((badge) => badge.text().includes('uncertain')),
    ).toHaveLength(3);
    wrapper.unmount();
  });

  it('localizes known operation/backend labels without changing run identity or action payloads', async () => {
    const locale = shallowRef<WorkstationLocale>('vi');
    const runs: RunView[] = [
      { ...run, run_id: 'train-run', operation: 'train' },
      { ...run, run_id: 'test-run', operation: 'test', backend: 'slurm' },
      { ...run, run_id: 'plot-run', operation: 'plot' },
    ];
    const snapshot = shallowRef({
      run: runs[1]!,
      freshness: 'fresh' as const,
      events: [],
      liveEvents: [],
      stream: 'live' as const,
      message: '',
      cancellation: 'idle' as const,
      truncated: false,
      metrics: [],
      summary: { progress: null, best: null, latest: null },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () =>
            h('div', [
              h(RunList, { runs, loading: false, page: 0 }),
              h(RunDetail, { snapshot: snapshot.value }),
            ]);
        },
      }),
      { global: { stubs: { MetricsChart: true } } },
    );
    expect(wrapper.text()).toContain('Huấn luyện');
    expect(wrapper.text()).toContain('Đánh giá');
    expect(wrapper.text()).toContain('Vẽ biểu đồ');
    expect(wrapper.text()).toContain('Cụm Slurm');
    await wrapper.getComponent(RunList).findAll('button')[1]!.trigger('click');
    expect(wrapper.getComponent(RunList).emitted('select')).toEqual([['train-run']]);
    expect(runs.map(({ operation, backend }) => [operation, backend])).toEqual([
      ['train', 'local'],
      ['test', 'slurm'],
      ['plot', 'local'],
    ]);
    const detail = wrapper.getComponent(RunDetail);
    snapshot.value = { ...snapshot.value, run: { ...run, backend: 'local' } };
    await nextTick();
    expect(detail.text()).toContain('Máy cục bộ');
    snapshot.value = { ...snapshot.value, run: { ...run, backend: 'custom-backend' } };
    await nextTick();
    expect(detail.text()).toContain('custom-backend');
    locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toContain('train');
    wrapper.unmount();
  });
  it('translates chrome, status and health while retaining raw logs, ids and parameter names', async () => {
    const locale = shallowRef<WorkstationLocale>('vi');
    const health = [
      { label: 'Overfitting', value: 'Gap: 100.0%', status: 'Severe', severity: 'error' as const },
    ];
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () =>
            h('div', [
              h(RunList, { runs: [run], loading: false, page: 0 }),
              h(StateBadge, { run, stale: true }),
              h(LogPanel, { events: [event], truncated: true }),
              h(MetricSummary, {
                summary: {
                  progress: { epoch: 1, totalEpochs: 2, fraction: 0.5 },
                  best: 2,
                  latest: null,
                  current: {
                    trainLoss: 1,
                    validationLoss: 2,
                    r2: null,
                    bestR2: null,
                    learningRate: null,
                    pearson: null,
                    gradientNorm: null,
                    mae: null,
                    epochSeconds: null,
                    elapsedSeconds: null,
                    patience: null,
                    health,
                    parameters: [{ name: 'Training loss', value: null }],
                  },
                },
              }),
              h(EvaluationResultsPanel, {
                run: { ...run, state: 'completed' },
                freshness: 'fresh',
                events: [
                  {
                    ...event,
                    type: 'metric',
                    payload: {
                      name: 'evaluation',
                      metrics: { mae_avg: 0.125, custom_key: 'raw-value' },
                    },
                  },
                ],
              }),
            ]);
        },
      }),
    );
    expect(wrapper.text()).toContain('Lượt chạy');
    expect(wrapper.text()).toContain('đang chạy');
    expect(wrapper.text()).toContain('Quá khớp');
    expect(wrapper.text()).toContain('Chênh lệch: 100.0%');
    expect(wrapper.text()).toContain('Nghiêm trọng');
    expect(wrapper.text()).toContain('MAE trung bình');
    expect(wrapper.text()).toContain('raw-run');
    expect(wrapper.find('pre').text()).toContain('Training loss');
    expect(wrapper.get('[aria-label="MAE theo tham số"]').text()).toContain('Training loss');
    expect(run.state).toBe('running');
    expect(health[0]?.status).toBe('Severe');
    locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toContain('Convergence health');
    expect(wrapper.text()).toContain('Gap: 100.0%');
    expect(wrapper.text()).toContain('mae avg');
    wrapper.unmount();
  });
});

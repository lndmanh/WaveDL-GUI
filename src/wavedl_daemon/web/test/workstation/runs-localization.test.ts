// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import MetricSummary from '../../app/components/runs/MetricSummary.vue';
import RunStateChip from '../../app/components/runs/RunStateChip.vue';
import LogPanel from '../../app/components/runs/LogPanel.vue';
import RunList from '../../app/components/runs/RunList.vue';
import RunDetail from '../../app/components/runs/RunDetail.vue';
import EvaluationResultsPanel from '../../app/components/results/EvaluationResultsPanel.vue';
import type { RunView } from '../../app/lib/daemon-api';
import type { RunEvent } from '../../app/lib/event-stream';

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
  it('leaves the shell logs target empty until there are events and clears it when retired', async () => {
    const target = document.createElement('div');
    target.id = 'shell-panel-tab-logs';
    document.body.append(target);
    const snapshot = {
      run,
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
    const wrapper = mount(RunDetail, {
      props: { snapshot },
      global: { stubs: { MetricsChart: true } },
    });
    await nextTick();
    expect(target.childElementCount).toBe(0);
    await wrapper.setProps({ snapshot: { ...snapshot, events: [event] } });
    expect(target.textContent).toContain('Training loss');
    await wrapper.setProps({ snapshot });
    expect(target.childElementCount).toBe(0);
    wrapper.unmount();
    target.remove();
  });
  it.each(['en', 'vi'] as const)(
    'renders all fourteen states with icons and tones in %s',
    (locale) => {
      const states = [
        {
          state: 'planned',
          en: 'Planned',
          vi: 'Đã lập kế hoạch',
          icon: 'file-text',
          tone: 'outline',
        },
        { state: 'pending', en: 'Pending', vi: 'Đang chờ', icon: 'clock', tone: 'secondary' },
        {
          state: 'submission_unknown',
          en: 'Submission unknown',
          vi: 'Chưa rõ việc gửi',
          icon: 'circle-help',
          tone: 'warning',
        },
        { state: 'submitted', en: 'Submitted', vi: 'Đã gửi', icon: 'send', tone: 'blue' },
        { state: 'queued', en: 'Queued', vi: 'Trong hàng đợi', icon: 'list-ordered', tone: 'blue' },
        { state: 'held', en: 'Held', vi: 'Tạm giữ', icon: 'pause-circle', tone: 'warning' },
        { state: 'running', en: 'Running', vi: 'Đang chạy', icon: 'loader-2', tone: 'blue' },
        {
          state: 'stopping',
          en: 'Stopping',
          vi: 'Đang dừng',
          icon: 'circle-stop',
          tone: 'warning',
        },
        {
          state: 'completed',
          en: 'Completed',
          vi: 'Hoàn tất',
          icon: 'circle-check',
          tone: 'success',
        },
        { state: 'failed', en: 'Failed', vi: 'Thất bại', icon: 'circle-x', tone: 'destructive' },
        { state: 'cancelled', en: 'Cancelled', vi: 'Đã hủy', icon: 'ban', tone: 'secondary' },
        {
          state: 'terminal_unknown',
          en: 'Terminal unknown',
          vi: 'Chưa rõ trạng thái kết thúc',
          icon: 'circle-help',
          tone: 'warning',
        },
        {
          state: 'observation_unavailable',
          en: 'Observation unavailable',
          vi: 'Không có quan sát',
          icon: 'eye-off',
          tone: 'secondary',
        },
        {
          state: 'supervision_lost',
          en: 'Supervision lost',
          vi: 'Mất giám sát',
          icon: 'unplug',
          tone: 'warning',
        },
      ] as const;
      const dashedStates = new Set([
        'submission_unknown',
        'terminal_unknown',
        'observation_unavailable',
        'supervision_lost',
      ]);
      const i18n = createTestI18n(locale);
      const wrapper = mount(
        defineComponent({
          setup: () => () =>
            h(
              'div',
              states.map(({ state }) =>
                h(RunStateChip, {
                  key: state,
                  run: { ...run, run_id: `run-${state}`, state, uncertainty: false },
                  progress:
                    state === 'running' ? { epoch: 1, totalEpochs: 4, fraction: 0.25 } : null,
                }),
              ),
            ),
        }),
        undefined,
        i18n,
      );
      expect(wrapper.findAll('[data-run-state]')).toHaveLength(states.length);
      for (const entry of states) {
        const chip = wrapper.get(`[data-run-state="${entry.state}"]`);
        expect(chip.text()).toContain(entry[locale]);
        expect(chip.attributes('data-run-icon')).toBe(entry.icon);
        expect(chip.attributes('data-effective-icon')).toBe(entry.icon);
        expect(chip.attributes('data-run-tone')).toBe(entry.tone);
        expect(chip.find('svg[data-lucide-icon]').attributes('data-lucide-icon')).toBe(entry.icon);
        expect(chip.classes().includes('run-state-chip--dashed')).toBe(
          dashedStates.has(entry.state),
        );
        if (entry.tone === 'blue') {
          expect(chip.classes()).toContain(
            entry.state === 'running' ? 'run-state-chip--blue' : 'run-state-chip--blue-outline',
          );
        } else {
          const toneClass = {
            outline: 'text-foreground',
            secondary: 'bg-secondary',
            warning: 'bg-yellow-500',
            success: 'bg-green-500',
            destructive: 'bg-destructive',
          }[entry.tone];
          expect(chip.classes()).toContain(toneClass);
        }
      }
      expect(wrapper.find('.run-state-progress [data-slot="progress"]').exists()).toBe(true);
      expect(
        wrapper.get('.run-state-progress [role="progressbar"]').attributes('aria-valuenow'),
      ).toBe('25');
      wrapper.unmount();
    },
  );

  it.each(['en', 'vi'] as const)(
    'exposes uncertainty and stale evidence through keyboard and touch in %s',
    async (locale) => {
      const i18n = createTestI18n(locale);
      const wrapper = mount(
        defineComponent({
          setup: () => () =>
            h('div', [
              h(RunStateChip, { run: { ...run, state: 'completed', uncertainty: true } }),
              h(RunStateChip, { run, stale: true }),
            ]),
        }),
        { attachTo: document.body },
        i18n,
      );
      const uncertainChip = wrapper.get('[data-run-state="completed"]');
      expect(uncertainChip.attributes('data-uncertain')).toBe('true');
      expect(uncertainChip.attributes('data-effective-icon')).toBe('circle-help');
      expect(uncertainChip.classes()).toContain('run-state-chip--dashed');
      expect(uncertainChip.attributes('tabindex')).toBe('0');
      const uncertainLabel = locale === 'en' ? ' · uncertain' : ' · chưa chắc chắn';
      expect(uncertainChip.text()).toContain(uncertainLabel);
      expect(
        wrapper.findAll('[data-run-state]').filter((chip) => chip.text().includes(uncertainLabel)),
      ).toHaveLength(1);
      await uncertainChip.trigger('keydown.enter');
      await nextTick();
      const uncertainTooltipId = uncertainChip.attributes('aria-describedby');
      expect(uncertainTooltipId).toBeTruthy();
      const uncertainTooltip = document.getElementById(uncertainTooltipId ?? '');
      expect(uncertainTooltip?.textContent).toContain(
        locale === 'en'
          ? 'Lifecycle is not currently confirmed. The state above is the last daemon observation, not proof that the run is still running or has finished.'
          : 'Vòng đời hiện chưa được xác nhận. Trạng thái trên là quan sát gần nhất của daemon, không chứng minh lượt chạy vẫn đang chạy hoặc đã kết thúc.',
      );
      await uncertainChip.trigger('keydown.space');
      await nextTick();

      const staleChip = wrapper.get('[data-run-state="running"]');
      expect(staleChip.attributes('data-stale')).toBe('true');
      expect(staleChip.attributes('data-prefix')).toBe('wifi-off');
      expect(staleChip.classes()).toContain('run-state-chip--dimmed');
      expect(staleChip.text()).toContain(
        locale === 'en' ? 'last observed, stale' : 'quan sát gần nhất, đã cũ',
      );
      expect(
        staleChip
          .findAll('svg[data-lucide-icon]')
          .map((icon) => icon.attributes('data-lucide-icon')),
      ).toEqual(['wifi-off', 'loader-2']);
      await staleChip.trigger('click');
      await nextTick();
      const staleTooltipId = staleChip.attributes('aria-describedby');
      expect(staleTooltipId).toBeTruthy();
      const staleTooltip = document.getElementById(staleTooltipId ?? '');
      expect(staleTooltip?.textContent).toContain(
        locale === 'en'
          ? 'Lifecycle is not currently confirmed. The state above is the last daemon observation, not proof that the run is still running or has finished.'
          : 'Vòng đời hiện chưa được xác nhận. Trạng thái trên là quan sát gần nhất của daemon, không chứng minh lượt chạy vẫn đang chạy hoặc đã kết thúc.',
      );
      wrapper.unmount();
    },
  );

  it('localizes known operation/backend labels without changing run identity or action payloads', async () => {
    const i18n = createTestI18n('vi');
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
        setup: () => () =>
          h('div', [
            h(RunList, { runs, loading: false, page: 0 }),
            h(RunDetail, { snapshot: snapshot.value }),
          ]),
      }),
      { global: { stubs: { MetricsChart: true } } },
      i18n,
    );
    expect(wrapper.text()).toContain('Huấn luyện');
    expect(wrapper.text()).toContain('Đánh giá');
    expect(wrapper.text()).toContain('Vẽ biểu đồ');
    expect(wrapper.text()).toContain('Cụm Slurm');
    await wrapper
      .getComponent(RunList)
      .findAll('button.run-row')
      .find((row) => row.text().includes('train-run'))
      ?.trigger('click');
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
    i18n.global.locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toContain('Train');
    wrapper.unmount();
  });
  it('translates chrome, status and health while retaining raw logs, ids and parameter names', async () => {
    const i18n = createTestI18n('vi');
    const health = [
      { label: 'Overfitting', value: 'Gap: 100.0%', status: 'Severe', severity: 'error' as const },
    ];
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h('div', [
            h(RunList, { runs: [run], loading: false, page: 0 }),
            h(RunStateChip, { run, stale: true }),
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
          ]),
      }),
      undefined,
      i18n,
    );
    expect(wrapper.text()).toContain('Lượt chạy');
    expect(wrapper.text()).toContain('Đang chạy');
    expect(wrapper.text()).toContain('Quá khớp');
    expect(wrapper.text()).toContain('Chênh lệch: 100.0%');
    expect(wrapper.text()).toContain('Nghiêm trọng');
    expect(wrapper.text()).toContain('MAE trung bình');
    expect(wrapper.text()).toContain('raw-run');
    expect(wrapper.find('pre').text()).toContain('Training loss');
    expect(wrapper.get('[aria-label="MAE theo tham số"]').text()).toContain('Training loss');
    expect(run.state).toBe('running');
    expect(health[0]?.status).toBe('Severe');
    i18n.global.locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toContain('Convergence health');
    expect(wrapper.text()).toContain('Gap: 100.0%');
    expect(wrapper.text()).toContain('mae avg');
    wrapper.unmount();
  });
});

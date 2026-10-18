// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { provideWorkstationLocale } from '../../workstation/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../workstation/i18n/core';
import MetricSummary from '../../workstation/components/runs/MetricSummary.vue';
import { MetricHistory } from '../../workstation/lib/metric-history';

describe('current dashboard summary', () => {
  it('renders simultaneous metrics, real elapsed, per-parameter nulls and evidenced health', async () => {
    const history = new MetricHistory('run');
    history.apply({
      protocol: 'wavedl-jsonl',
      version: 1,
      run_id: 'run',
      attempt: 1,
      seq: 1,
      ts: '2026-10-07T00:00:00Z',
      type: 'metric',
      payload: {
        name: 'epoch',
        value: 2,
        step: 1,
        metrics: {
          epoch: 1,
          total_epochs: 4,
          train_loss: 1,
          val_loss: 2,
          best_val_loss: 2,
          r2: 0.8,
          pearson: 0.9,
          lr: 0.001,
          grad_norm: 2,
          mae_avg: 0.2,
          epoch_time: 3,
          total_time: 6,
          patience_counter: 1,
          max_patience: 5,
          mae_per_param: [0, null],
        },
      },
    });
    const wrapper = mount(MetricSummary, { props: { summary: history.summary() } });
    for (const label of [
      'Training loss',
      'Validation loss',
      'R²',
      'Learning rate',
      'Pearson',
      'Gradient norm',
      'MAE average',
      'Epoch duration',
      'Best R² (current attempt)',
      'Elapsed training time',
      'Patience',
    ])
      expect(wrapper.text()).toContain(label);
    expect(wrapper.text()).toContain('6 s');
    expect(wrapper.get('[aria-label="Per-parameter MAE"]').text()).toContain('P2Unavailable');
    expect(wrapper.get('[aria-label="Convergence health"]').text()).toContain('Severe');
    expect(wrapper.get('[aria-label="Epoch progress"]').attributes('value')).toBe('0.25');
    await wrapper.setProps({ unconfirmed: true });
    expect(wrapper.text()).toContain('Last known runtime metrics');
    expect(wrapper.text()).toContain('do not confirm that the runtime is still active');
    expect(wrapper.text()).toContain('6 s');
    expect(wrapper.get('[aria-label="Epoch progress"]').attributes('value')).toBe('0.25');
    await wrapper.setProps({ unconfirmed: false });
    expect(wrapper.text()).toContain('Current runtime');
    expect(wrapper.text()).not.toContain('Last known runtime metrics');
    expect(wrapper.text()).toContain('6 s');
    await wrapper.setProps({ summary: { progress: null, best: null, latest: null } });
    expect(wrapper.text()).toContain('Waiting for metrics');
    expect(wrapper.text()).not.toContain('6 s');
    expect(wrapper.find('[aria-label="Convergence health"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('translates last-known evidence labels without changing the summary contract', async () => {
    const locale = shallowRef<WorkstationLocale>('vi');
    const summary = {
      progress: { epoch: 1, totalEpochs: 2, fraction: 0.5 },
      best: 2,
      latest: null,
    };
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () => h(MetricSummary, { summary, unconfirmed: true });
        },
      }),
    );
    expect(wrapper.text()).toContain('Số liệu thời gian chạy được biết gần nhất');
    expect(wrapper.text()).toContain('không xác nhận thời gian chạy vẫn đang hoạt động');
    locale.value = 'en';
    await nextTick();
    expect(wrapper.get('[aria-label="Current runtime metrics"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Last known runtime metrics');
    expect(wrapper.get('[aria-label="Epoch progress"]').attributes('value')).toBe('0.5');
    expect(wrapper.getComponent(MetricSummary).props('summary')).toEqual(summary);
    wrapper.unmount();
  });
});

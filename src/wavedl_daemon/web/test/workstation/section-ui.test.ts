// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountWithI18n, createTestI18n } from './mountWithI18n';
import InfoChip from '../../app/components/common/InfoChip.vue';
import ArtifactList from '../../app/components/results/ArtifactList.vue';
import MetricSummary from '../../app/components/runs/MetricSummary.vue';
import type { MetricRecord } from '../../app/lib/metric-history';

describe.each(['en', 'vi'] as const)('section visual contracts (%s)', (locale) => {
  it('makes the exact hedge available to focus and touch without removing the visible qualifier', async () => {
    const wrapper = mountWithI18n(
      InfoChip,
      {
        props: {
          label: 'Evidence, not completion',
          text: 'A verified publication is not proof of completion.',
          uncertain: true,
        },
        attachTo: document.body,
      },
      createTestI18n(locale),
    );
    const button = wrapper.get('button');
    expect(button.text()).toContain('not completion');
    expect(button.attributes('aria-label')).toContain('not proof of completion');
    expect(button.classes()).toContain('border-dashed');
    await button.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain(
      'A verified publication is not proof of completion.',
    );
    wrapper.unmount();
  });

  it('renders only verified selected PNG previews inline and preserves explicit download actions', async () => {
    const artifact = {
      runId: 'run',
      generation: 'gen',
      attempt: 2,
      path: 'loss.png',
      size: 10,
      sha256: 'a'.repeat(64),
      step: 1,
    };
    const wrapper = mountWithI18n(
      ArtifactList,
      {
        props: {
          artifacts: [artifact],
          busy: false,
          imageUrl: 'blob:verified',
          previewPath: 'gen/loss.png',
        },
      },
      createTestI18n(locale),
    );
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.get('img').attributes('src')).toBe('blob:verified');
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.emitted('download')?.[0]?.[0]).toEqual(artifact);
    await wrapper.setProps({ previewPath: 'other/loss.png' });
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('draws sparklines from actual samples and exposes percentage progress accessibly', () => {
    const records: MetricRecord[] = [1, 2, 3].map((value) => ({
      runId: 'run',
      attempt: 1,
      seq: value,
      step: value,
      name: 'train_loss',
      value,
      unit: '',
      metrics: { train_loss: value, val_loss: value + 1, r2: value / 10, lr: value / 100 },
      sourceGeneration: null,
      active: true,
    }));
    const current = {
      trainLoss: 3,
      validationLoss: 4,
      r2: 0.3,
      bestR2: 0.3,
      learningRate: 0.03,
      pearson: null,
      gradientNorm: null,
      mae: null,
      epochSeconds: null,
      elapsedSeconds: null,
      patience: null,
      parameters: [],
      health: [],
    };
    const wrapper = mountWithI18n(
      MetricSummary,
      {
        props: {
          summary: {
            progress: { epoch: 3, totalEpochs: 10, fraction: 0.3 },
            best: 4,
            latest: records[2]!,
            current,
          },
          records,
        },
      },
      createTestI18n(locale),
    );
    expect(wrapper.findAll('.kpi-tile')).toHaveLength(4);
    expect(wrapper.findAll('svg.sparkline path[fill="none"]')).toHaveLength(4);
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('30');
    expect(wrapper.get('svg.sparkline path[fill="none"]').attributes('d')).toContain('L120,4');
    wrapper.unmount();
  });
});

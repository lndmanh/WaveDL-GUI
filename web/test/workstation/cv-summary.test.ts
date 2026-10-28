// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto';
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactClient } from '../../app/lib/artifact-client';
import { ConnectionSession } from './session-fixture';
import { CV_SUMMARY_BUDGET, loadCvSummary, parseCvSummary } from '../../app/lib/cv-summary';
import CvSummaryPanel from '../../app/components/results/CvSummaryPanel.vue';

function fixture() {
  return {
    config: {
      model: 'raw_model',
      folds: 2,
      stratify: false,
      stratify_bins: 10,
      batch_size: 4,
      lr: 0.001,
      epochs: 10,
      patience: 3,
      loss: 'mse',
      optimizer: 'adam',
      scheduler: 'cosine',
    },
    timestamp: '2026-10-08T12:34:56',
    folds: 2,
    r2_mean: null,
    r2_std: null,
    mae_mean: 0.5,
    mae_std: 0.1,
    val_loss_mean: 0.2,
    val_loss_std: 0.02,
    fold_results: [1, 2].map((fold) => ({
      fold,
      best_val_loss: 0.2,
      best_epoch: 3,
      r2: null,
      mae_normalized: 0.1,
      mae_physical: 0.5,
      epochs_trained: 5,
      r2_target_0: null,
      mae_target_0: 0.5,
    })),
  };
}
function json(value: object) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
async function setup(options: { size?: number; corrupt?: boolean; text?: string } = {}) {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = new TextEncoder().encode(options.text ?? JSON.stringify(fixture()));
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const downloads: string[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/health')
        return json({ daemon_id: 'daemon', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
      if (path.endsWith('/artifacts'))
        return json({
          generations: [1, 2].map((attempt) => ({
            generation: `gen-00000${attempt}`,
            attempt,
            step: 0,
            files: { 'cv_summary.json': { size: options.size ?? bytes.length, sha256: hash } },
          })),
        });
      downloads.push(path);
      return new Response(options.corrupt ? new Uint8Array(bytes.length) : bytes, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.length),
        },
      });
    },
  });
  await session.connect('token');
  const artifacts = await new ArtifactClient(session).list('22222222-2222-4222-8222-222222222222');
  return { session, artifacts, downloads };
}
describe('published CV summary contract', () => {
  it('parses the actual producer mean/std and per-fold target metrics without inventing zero for null', () => {
    const result = parseCvSummary(fixture());
    expect(result.r2_mean).toBeNull();
    expect(result.fold_results[0]?.targets).toEqual([{ index: 0, r2: null, mae: 0.5 }]);
    expect(result.mae_std).toBe(0.1);
  });
  it('rejects nonfinite, malformed, oversized or mismatched fold/target schema', () => {
    expect(() => parseCvSummary({ ...fixture(), r2_mean: Infinity })).toThrow();
    expect(() => parseCvSummary({ ...fixture(), folds: 257 })).toThrow();
    expect(() => parseCvSummary({ ...fixture(), extra: 'raw' })).toThrow();
    expect(() => parseCvSummary({ ...fixture(), mae_std: -1 })).toThrow();
    expect(() =>
      parseCvSummary({ ...fixture(), config: { ...fixture().config, lr: Infinity } }),
    ).toThrow();
    expect(() =>
      parseCvSummary({
        ...fixture(),
        fold_results: [fixture().fold_results[0], fixture().fold_results[0]],
      }),
    ).toThrow();
    const raw = fixture();
    raw.fold_results[0] = { ...raw.fold_results[0]!, r2_target_0: NaN };
    expect(() => parseCvSummary(raw)).toThrow();
  });
  it('refuses a genuine oversized grant before downloading and fails closed for checksum and duplicate JSON', async () => {
    for (const options of [
      { size: CV_SUMMARY_BUDGET + 1 },
      { corrupt: true },
      { text: JSON.stringify(fixture()).replace('"folds":2', '"folds":2,"folds":2') },
      { text: JSON.stringify(fixture()).replace('"lr":0.001', '"lr":1e999') },
    ]) {
      const { session, artifacts, downloads } = await setup(options);
      try {
        await expect(loadCvSummary(session, artifacts[0]!)).rejects.toThrow();
        expect(downloads).toHaveLength('size' in options ? 0 : 1);
      } finally {
        session.detach();
        vi.unstubAllGlobals();
      }
    }
  });
  it('uses the exact listed grant and SHA-verified bounded publication, refusing forged and stale grants', async () => {
    const { session, artifacts, downloads } = await setup();
    try {
      const selected = artifacts[0]!;
      expect((await loadCvSummary(session, selected)).folds).toBe(2);
      expect(downloads).toEqual([
        `/api/runs/${selected.runId}/artifacts/gen-000001/cv_summary.json`,
      ]);
      await expect(loadCvSummary(session, { ...selected })).rejects.toThrow();
      await expect(
        loadCvSummary(session, { ...selected, size: CV_SUMMARY_BUDGET + 1 }),
      ).rejects.toThrow();
      session.detach();
      await expect(loadCvSummary(session, selected)).rejects.toThrow();
      expect(downloads).toHaveLength(1);
    } finally {
      session.detach();
      vi.unstubAllGlobals();
    }
  });
  it('requires explicit generation choice, retains verified data on locale change, clears on disconnect', async () => {
    const { session, artifacts, downloads } = await setup();
    const i18n = createTestI18n('en');
    const listed = shallowRef(artifacts);
    const Host = defineComponent({
      setup() {
        return () => h(CvSummaryPanel, { session, artifacts: listed.value });
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    try {
      expect(downloads).toHaveLength(0);
      expect(wrapper.findAll('button').at(-1)?.attributes('disabled')).toBeDefined();
      wrapper.getComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'gen-000001');
      await flushPromises();
      await wrapper.findAll('button').at(-1)!.trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('Overall mean'));
      expect(wrapper.text()).toContain('Unavailable');
      expect(wrapper.text()).toContain('Parameter 0');
      i18n.global.locale.value = 'vi';
      await flushPromises();
      expect(wrapper.text()).toContain('Trung bình tổng thể');
      expect(wrapper.text()).toContain('Không có');
      expect(wrapper.getComponent({ name: 'Select' }).props('modelValue')).toBe('gen-000001');
      expect(downloads).toHaveLength(1);
      listed.value = [...artifacts];
      await flushPromises();
      expect(wrapper.text()).not.toContain('Trung bình tổng thể');
      expect(wrapper.getComponent({ name: 'Select' }).props('modelValue')).toBe('');
      wrapper.getComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'gen-000002');
      await flushPromises();
      await wrapper.findAll('button').at(-1)!.trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('Trung bình tổng thể'));
      expect(downloads[1]).toContain('/gen-000002/cv_summary.json');
      session.detach();
      await flushPromises();
      expect(wrapper.text()).not.toContain('Trung bình tổng thể');
      expect(wrapper.findAll('button').at(-1)?.attributes('disabled')).toBeDefined();
    } finally {
      wrapper.unmount();
      session.detach();
      vi.unstubAllGlobals();
    }
  });
});

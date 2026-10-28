// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useForm } from 'vee-validate';
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import RunList from '../../app/components/runs/RunList.vue';
import RunDetail from '../../app/components/runs/RunDetail.vue';
import MetricSummary from '../../app/components/runs/MetricSummary.vue';
import TrainingFields from '../../app/components/project/TrainingFields.vue';
import ProjectGuide from '../../app/components/project/ProjectGuide.vue';
import ModelSelector from '../../app/components/catalog/ModelSelector.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import TrainingExport from '../../app/components/project/TrainingExport.vue';
import EnvironmentFields from '../../app/components/project/EnvironmentFields.vue';
import type { TrainingRequest } from '../../shared/schemas/training-request';
import { MetricHistory } from '../../app/lib/metric-history';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';
import { trainingDefaults } from '../../shared/schemas/training-request';
import type { RunView } from '../../app/lib/daemon-api';
import { useShellLayout } from '../../app/composables/useShellLayout';

const run: RunView = {
  run_id: '22222222-2222-4222-8222-222222222222',
  plan_id: 'p',
  request_id: 'q',
  backend: 'local',
  operation: 'train',
  attempt: 1,
  state: 'running',
  uncertainty: true,
  submission_requested: true,
  cancellation_requested: false,
  evidence: {},
};
afterEach(() => {
  vi.restoreAllMocks();
});

async function session() {
  const owner = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async () =>
      new Response(
        JSON.stringify({
          daemon_id: 'review',
          build_id: '1.8.1',
          protocol_min: 1,
          protocol_max: 1,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  });
  expect(await owner.connect('token')).toBe(true);
  return owner;
}

describe.each(['en', 'vi'] as const)('review UI contracts (%s)', (locale) => {
  it('keeps state-chip controls outside the selectable row and hides a needless pager', async () => {
    const i18n = createTestI18n(locale);
    const wrapper = mount(
      RunList,
      {
        props: { runs: [run], page: 0, loading: false, lastRefreshed: '2026-10-27T03:02:29Z' },
        attachTo: document.body,
      },
      i18n,
    );
    const row = wrapper.get('button.run-row');
    expect(row.find('button,[tabindex]').exists()).toBe(false);
    expect(row.element.tagName).toBe('BUTTON');
    row.element.focus();
    expect(document.activeElement).toBe(row.element);
    await row.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[run.run_id]]);
    expect(wrapper.get('[data-run-state]').element.closest('button.run-row')).toBeNull();
    expect(wrapper.find('[data-testid="run-pagination"]').exists()).toBe(false);
    const time = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date('2026-10-27T03:02:29Z'));
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text() === i18n.global.t('runs.updatedTime', { time })),
    ).toBe(true);
    expect(wrapper.get('[data-run-state]').text()).toContain(i18n.global.t('runs.uncertain'));
    await wrapper.setProps({ page: 50, runs: [] });
    expect(wrapper.find('[data-testid="run-pagination"]').exists()).toBe(true);
    expect(wrapper.get('[data-slot="empty"]').text()).toContain(i18n.global.t('runs.noRuns'));
    wrapper.unmount();
  });

  it('formats metrics without mutating data and retains exact values in titles', () => {
    const history = new MetricHistory(run.run_id);
    const raw = 1.054087387888055;
    history.apply({
      protocol: 'wavedl-jsonl',
      version: 1,
      run_id: run.run_id,
      attempt: 1,
      seq: 1,
      ts: '2026-10-27T00:00:00Z',
      type: 'metric',
      payload: {
        name: 'epoch',
        value: 1,
        step: 1,
        metrics: {
          epoch: 1,
          total_epochs: 5,
          train_loss: raw,
          val_loss: raw,
          best_val_loss: raw,
          mae_per_param: [raw],
        },
      },
    });
    const summary = history.summary();
    const before = JSON.stringify(summary);
    const wrapper = mount(MetricSummary, { props: { summary } }, createTestI18n(locale));
    const formatted = new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(raw);
    const loss = wrapper.get('.kpi-tile dd');
    expect(loss.text()).toBe(formatted);
    expect(loss.attributes('title')).toBe(String(raw));
    expect(wrapper.get('p[title]').text()).toContain(formatted);
    expect(wrapper.get('p[title]').attributes('title')).toBe(String(raw));
    const parameter = wrapper.get('section[aria-label] dl.flex dd');
    expect(parameter.text()).toBe(formatted);
    expect(parameter.attributes('title')).toBe(String(raw));
    expect(JSON.stringify(summary)).toBe(before);
    wrapper.unmount();
  });

  it('renders labelled horizontal boolean controls and a badge only for changed advanced values', async () => {
    const i18n = createTestI18n(locale);
    const Host = defineComponent({
      setup() {
        useForm({ initialValues: { config: structuredClone(trainingDefaults) } });
        return () => h(TrainingFields, { disabled: false });
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    expect(
      wrapper.get('[data-testid="training-tab-advanced"]').find('[data-slot="badge"]').exists(),
    ).toBe(false);
    const checkbox = wrapper.get('[id$="-training-nesterov"]');
    const field = checkbox.element.closest('[data-orientation="horizontal"]');
    expect(field).not.toBeNull();
    expect(field?.querySelector('label')?.textContent).toBe(
      i18n.global.t('training.nesterov.label'),
    );
    expect(
      wrapper
        .get('[id$="-training-lr"]')
        .element.closest('[data-slot="field"]')
        ?.querySelector('label')?.textContent,
    ).toBe(i18n.global.t('training.lr.label'));
    await checkbox.trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-testid="training-tab-advanced"] [data-slot="badge"]').text(),
    ).toContain('1');
    expect(wrapper.text()).not.toContain('Available: ()');
    wrapper.unmount();
  });

  it('renders the guide as a current/completed/upcoming stepper without bypassing next logic', async () => {
    const wrapper = mount(
      ProjectGuide,
      { props: { enabled: true, step: 2, busy: false } },
      createTestI18n(locale),
    );
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('data-state')).toBe('completed');
    expect(wrapper.get('[data-testid="guide-step-2"]').attributes('data-state')).toBe('active');
    expect(wrapper.get('[data-testid="guide-step-3"]').attributes('data-state')).toBe('inactive');
    await wrapper.get('[data-testid="guide-step-3"] button').trigger('mousedown');
    expect(wrapper.emitted('next')).toEqual([[]]);
    expect(wrapper.get('[data-testid="guide-step-5"] button').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});

it('opens the logs tab through the public shell API and fills the companion height', async () => {
  const target = document.createElement('div');
  target.id = 'shell-panel-tab-logs';
  document.body.append(target);
  const shell = useShellLayout();
  shell.closePanel();
  const snapshot = {
    run,
    freshness: 'fresh',
    events: [
      {
        protocol: 'wavedl-jsonl',
        version: 1,
        run_id: run.run_id,
        attempt: 1,
        seq: 1,
        ts: '2026-10-27T00:00:00Z',
        type: 'log',
        payload: { message: 'Observed log' },
      },
    ],
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
  await flushPromises();
  await wrapper.get('[data-testid="run-open-logs"]').trigger('click');
  expect(shell.activeTab.value).toBe('logs');
  expect(shell.isPanelOpen.value).toBe(true);
  expect(target.querySelector('.logs-panel')).not.toBeNull();
  expect(target.textContent).toContain('Observed log');
  await wrapper.setProps({ snapshot: { ...snapshot, freshness: 'stale' } });
  expect(
    wrapper
      .findAll('[role="status"]')
      .some((region) =>
        region
          .text()
          .includes(
            'Lifecycle is not currently confirmed. The state above is the last daemon observation, not proof that the run is still running or has finished.',
          ),
      ),
  ).toBe(true);
  wrapper.unmount();
  target.remove();
  shell.closePanel();
});

it('announces catalogue/root emptiness and loading, without a redundant model heading or alert', async () => {
  const owner = await session();
  vi.spyOn(CatalogApi.prototype, 'models').mockResolvedValue([]);
  vi.spyOn(CatalogApi.prototype, 'roots').mockResolvedValue([]);
  const models = mount(ModelSelector, { props: { session: owner } });
  const paths = mount(DatasetPathPicker, { props: { session: owner } });
  expect(models.get('[role="status"]').text()).toContain('Reading model descriptions');
  expect(paths.get('[role="status"]').text()).toContain('Reading dataset paths');
  await flushPromises();
  expect(models.get('[role="status"]').text()).toContain('No matching');
  expect(models.find('h2').exists()).toBe(false);
  expect(models.find('[role="alert"]').exists()).toBe(false);
  expect(paths.get('[role="status"]').text()).toContain('No browse roots');
  models.unmount();
  paths.unmount();
  owner.detach();
});

it('announces an empty directory after navigating the searchable root picker', async () => {
  const owner = await session();
  vi.spyOn(CatalogApi.prototype, 'roots').mockResolvedValue(['data']);
  vi.spyOn(CatalogApi.prototype, 'browse').mockResolvedValue({
    root: 'data',
    path: '',
    entries: [],
    total: 0,
    limit: 100,
    offset: 0,
  });
  const wrapper = mount(DatasetPathPicker, { props: { session: owner } });
  await flushPromises();
  await wrapper.get('[role="combobox"]').trigger('focus');
  await wrapper.get('[role="option"][data-value="data"]').trigger('click');
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe('This directory has no selectable entries.');
  wrapper.unmount();
  owner.detach();
});

it('keeps secondary export and environment panels closed until deliberately opened', async () => {
  // Acceptance scripts prove that opening these panels is a deliberate, side-effect-free action.
  const panels = [
    mount(TrainingExport, { props: { draft: {} as TrainingRequest, disabled: false } }),
    mount(EnvironmentFields, { props: { environment: {}, disabled: false } }),
  ];
  for (const wrapper of panels) {
    const trigger = wrapper.get('[data-slot="collapsible-trigger"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[data-slot="collapsible-content"]').classes()).toContain(
      'data-[state=closed]:hidden',
    );
    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('true');
    wrapper.unmount();
  }
});

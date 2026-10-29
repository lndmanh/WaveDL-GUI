// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useForm } from 'vee-validate';
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import RunList from '../../app/components/runs/RunList.vue';
import RunDetail from '../../app/components/runs/RunDetail.vue';
import MetricSummary from '../../app/components/runs/MetricSummary.vue';
import TrainingInspector from '../../app/components/project/TrainingInspector.vue';
import RunPipeline, { type PipelineBlock } from '../../app/components/project/RunPipeline.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import ConfigMenu from '../../app/components/project/ConfigMenu.vue';
import EnvironmentFields from '../../app/components/project/EnvironmentFields.vue';
import { trainingRequestSchema } from '../../shared/schemas/training-request';
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

  it('renders labelled boolean switches and a count only for changed advanced values', async () => {
    const i18n = createTestI18n(locale);
    const Host = defineComponent({
      setup() {
        useForm({ initialValues: { config: structuredClone(trainingDefaults) } });
        return () => h(TrainingInspector, { disabled: false });
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    const advanced = wrapper.get('[data-testid="training-tab-advanced"]');
    expect(advanced.find('.training-section-count').exists()).toBe(false);
    const control = wrapper.get('[id$="-training-deterministic"]');
    expect(control.attributes('role')).toBe('switch');
    expect(control.attributes('aria-checked')).toBe('false');
    expect(wrapper.get(`label[for="${control.attributes('id')}"]`).text()).toBe(
      i18n.global.t('training.deterministic.label'),
    );
    const lr = wrapper.get('[id$="-training-lr"]');
    expect(wrapper.get(`label[for="${lr.attributes('id')}"]`).text()).toBe(
      i18n.global.t('training.lr.label'),
    );
    await control.trigger('click');
    await flushPromises();
    expect(control.attributes('aria-checked')).toBe('true');
    const counts = advanced.findAll('.training-section-count');
    expect(counts).toHaveLength(1);
    expect(counts[0]?.text()).toBe(i18n.global.t('project.nonDefaultFields', { count: 1 }));
    // The changed row offers a one-click reset to its default.
    await wrapper
      .get(
        `button[aria-label="${i18n.global.t('builder.resetSetting', {
          label: i18n.global.t('training.deterministic.label'),
        })}"]`,
      )
      .trigger('click');
    await flushPromises();
    expect(control.attributes('aria-checked')).toBe('false');
    expect(advanced.find('.training-section-count').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Available: ()');
    wrapper.unmount();
  });

  it('renders the run pipeline as complete/attention/pending tabs that defer selection to the owner', async () => {
    const blocks: PipelineBlock[] = [
      { id: 'dataset', label: 'Dataset', value: 'train.npz', detail: 'data', state: 'complete' },
      { id: 'model', label: 'Model', value: 'custom', detail: 'unverified', state: 'attention' },
      { id: 'training', label: 'Training', value: 'Defaults', detail: '', state: 'complete' },
      { id: 'runtime', label: 'Runs on', value: 'CPU', detail: '', state: 'pending' },
      { id: 'plan', label: 'Plan', value: 'Not ready', detail: '', state: 'pending' },
    ];
    const i18n = createTestI18n(locale);
    const wrapper = mount(
      RunPipeline,
      {
        props: {
          blocks,
          active: 'training',
          panelId: 'panel',
          reviewLabel: i18n.global.t('builder.createPlan'),
          reviewDisabled: true,
          reviewBusy: false,
        },
      },
      i18n,
    );
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe(
      i18n.global.t('builder.runSteps'),
    );
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('data-state')).toBe('complete');
    expect(wrapper.get('[data-testid="guide-step-1"]').attributes('data-state')).toBe('attention');
    expect(wrapper.get('[data-testid="guide-step-3"]').attributes('data-state')).toBe('pending');
    expect(wrapper.get('[data-testid="guide-step-2"]').attributes('aria-current')).toBe('step');
    expect(wrapper.get('[data-testid="guide-step-2"]').attributes('aria-controls')).toBe('panel');
    expect(wrapper.get('[data-testid="guide-step-3"]').attributes('aria-current')).toBeUndefined();
    await wrapper.get('[data-testid="guide-step-3"]').trigger('click');
    await wrapper.get('[data-testid="guide-step-2"]').trigger('keydown', { key: 'ArrowLeft' });
    // The strip only asks; the owner decides whether the active block changes.
    expect(wrapper.emitted('select')).toEqual([['runtime'], ['model']]);
    expect(wrapper.get('[data-testid="guide-step-2"]').attributes('aria-current')).toBe('step');
    const review = wrapper.get('button:not([role="tab"])');
    expect(review.attributes('disabled')).toBeDefined();
    await review.trigger('click');
    expect(wrapper.emitted('review')).toBeUndefined();
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
  vi.spyOn(CatalogApi.prototype, 'roots').mockResolvedValue([]);
  const props = {
    session: owner,
    models: [],
    busy: true,
    message: '',
    selection: null,
    pretrained: false,
    inspection: null,
    singleChannel: false,
    disabled: false,
  } as const;
  const loading = mount(ModelInspector, { props });
  const paths = mount(DatasetPathPicker, { props: { session: owner } });
  expect(loading.get('[role="status"]').text()).toContain('Reading model descriptions');
  expect(paths.get('[role="status"]').text()).toContain('Reading dataset paths');
  loading.unmount();
  const models = mount(ModelInspector, { props: { ...props, busy: false } });
  await flushPromises();
  expect(models.get('[role="status"]').text()).toContain('No matching');
  // The inspector's own title is the only heading; no empty listbox is rendered.
  expect(models.findAll('h2')).toHaveLength(1);
  expect(models.find('[role="listbox"]').exists()).toBe(false);
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
  const draft = trainingRequestSchema.parse({
    backend: 'local',
    operation: 'train',
    config: { ...trainingDefaults, model: 'cnn', data_path: '/data/train.npz' },
    runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  });
  const menu = mount(ConfigMenu, {
    props: { draft, disabled: false },
    attachTo: document.body,
  });
  const menuTrigger = menu.get('[data-testid="config-menu"]');
  expect(menuTrigger.attributes('aria-expanded')).toBe('false');
  expect(document.body.querySelector('[role="menuitem"]')).toBeNull();
  await menuTrigger.trigger('keydown', { key: 'Enter' });
  await flushPromises();
  expect(menuTrigger.attributes('aria-expanded')).toBe('true');
  expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
  // Opening the menu neither exports nor reports anything.
  expect(menu.emitted('notice')).toBeUndefined();
  expect(menu.emitted('import')).toBeUndefined();
  menu.unmount();

  const environment = mount(EnvironmentFields, { props: { environment: {}, disabled: false } });
  const trigger = environment.get('[data-slot="collapsible-trigger"]');
  expect(trigger.attributes('aria-expanded')).toBe('false');
  // Closed content stays mounted for its fields but hidden, so it can animate shut.
  const content = environment.get('[data-slot="collapsible-content"]');
  expect(content.classes()).toContain('collapsible-motion');
  expect(content.attributes('hidden')).toBeDefined();
  await trigger.trigger('click');
  expect(trigger.attributes('aria-expanded')).toBe('true');
  environment.unmount();
});

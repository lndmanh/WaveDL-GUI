// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import RunList from '../../app/components/runs/RunList.vue';
import type { RunState, RunView } from '../../app/lib/daemon-api';
import {
  durationText,
  groupRuns,
  pathName,
  remainingSeconds,
  runCounts,
  runMatches,
} from '../../app/lib/run-overview';

const now = new Date(2026, 9, 29, 15, 0, 0);
function at(days: number, hour = 9): string {
  return new Date(2026, 9, 29 - days, hour).toISOString();
}
function run(id: string, state: RunState, created: string | null, model = 'cnn'): RunView {
  return {
    run_id: id,
    plan_id: `${id}-plan`,
    request_id: `${id}-request`,
    backend: 'local',
    operation: 'train',
    attempt: 1,
    state,
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
    created_at: created,
    summary: {
      name: null,
      model,
      data_path: `/data/${id}/plates.h5`,
      epochs: 50,
      cv: null,
      source_run_id: null,
    },
  };
}

describe('run overview helpers', () => {
  it('puts live runs first and buckets the rest newest-first by calendar day', () => {
    const runs = [
      run('old', 'completed', at(30)),
      run('week', 'failed', at(3)),
      run('yesterday', 'completed', at(1)),
      run('morning', 'completed', at(0, 8)),
      run('noon', 'cancelled', at(0, 12)),
      run('live', 'running', at(40)),
    ];
    expect(groupRuns(runs, now).map((group) => [group.key, group.runs.map((r) => r.run_id)])).toEqual([
      ['live', ['live']],
      ['today', ['noon', 'morning']],
      ['yesterday', ['yesterday']],
      ['week', ['week']],
      ['earlier', ['old']],
    ]);
  });

  it('reverses the oldest-first page for runs from daemons without creation times', () => {
    const runs = [run('a', 'completed', null), run('b', 'completed', null)];
    expect(groupRuns(runs, now)).toEqual([{ key: 'earlier', runs: [runs[1], runs[0]] }]);
  });

  it('counts each state into at most one filter', () => {
    const runs = [
      run('a', 'running', null),
      run('b', 'queued', null),
      run('c', 'completed', null),
      run('d', 'supervision_lost', null),
      run('e', 'cancelled', null),
      run('f', 'planned', null),
    ];
    expect(runCounts(runs)).toEqual({ all: 6, live: 2, completed: 1, attention: 1 });
  });

  it('matches identity, model, dataset name and visible labels without case', () => {
    const subject = run('9f1c2d3e', 'completed', null, 'ResNet18');
    expect(runMatches(subject, 'resnet')).toBe(true);
    expect(runMatches(subject, 'PLATES')).toBe(true);
    expect(runMatches(subject, '9f1c')).toBe(true);
    expect(runMatches(subject, 'train', ['Train'])).toBe(true);
    expect(runMatches(subject, 'missing')).toBe(false);
    expect(runMatches(subject, '   ')).toBe(true);
  });

  it('names host paths for either separator and ignores trailing slashes', () => {
    expect(pathName('/data/set/plates.h5')).toBe('plates.h5');
    expect(pathName('C:\\data\\set\\')).toBe('set');
    expect(pathName(null)).toBe('');
  });

  it('formats durations by their two largest units and estimates the remainder', () => {
    expect(durationText(4332, 'en')).toBe('1h 12m');
    expect(durationText(65, 'en')).toBe('1m 5s');
    expect(durationText(0, 'en')).toBe('0s');
    expect(remainingSeconds({ epoch: 10, totalEpochs: 40 }, 600)).toBe(1800);
    expect(remainingSeconds({ epoch: 40, totalEpochs: 40 }, 600)).toBeNull();
    expect(remainingSeconds({ epoch: 0, totalEpochs: 40 }, 600)).toBeNull();
    expect(remainingSeconds(null, 600)).toBeNull();
  });
});

describe('run sidebar', () => {
  const runs = [
    run('done-run', 'completed', at(0, 8), 'unet'),
    run('live-run', 'running', at(0, 9), 'resnet'),
    run('lost-run', 'supervision_lost', at(2), 'vit'),
  ];

  it('titles rows by model, filters by state and search, and recovers from an empty view', async () => {
    const wrapper = mount(
      RunList,
      { props: { runs, loading: false, page: 0, now }, attachTo: document.body },
      createTestI18n('en'),
    );
    const rows = () => wrapper.findAll('button.run-row').map((row) => row.get('strong').text());
    expect(rows()).toEqual(['resnet', 'unet', 'vit']);
    expect(wrapper.get('h3').text()).toBe('Live now');
    expect(wrapper.findAll('button.run-row')[0]?.text()).toContain('plates.h5');
    await wrapper.setProps({ filter: 'attention' });
    expect(rows()).toEqual(['vit']);
    await wrapper.setProps({ filter: 'all', query: 'UNET' });
    expect(rows()).toEqual(['unet']);
    await wrapper.setProps({ filter: 'live', query: 'nothing' });
    expect(rows()).toEqual([]);
    expect(wrapper.get('[role="status"]').text()).toContain('No runs on this page match.');
    await wrapper.findAll('button').find((button) => button.text() === 'Clear filters')?.trigger('click');
    expect(wrapper.emitted('update:query')).toContainEqual(['']);
    expect(wrapper.emitted('update:filter')).toContainEqual(['all']);
    wrapper.unmount();
  });

  it('moves focus between rows with the arrow keys and marks the selected row', async () => {
    const wrapper = mount(
      RunList,
      {
        props: { runs, loading: false, page: 0, now, selectedRunId: 'done-run' },
        attachTo: document.body,
      },
      createTestI18n('en'),
    );
    const buttons = wrapper.findAll('button.run-row');
    expect(buttons.map((button) => button.attributes('aria-current'))).toEqual([
      undefined,
      'true',
      undefined,
    ]);
    buttons[0]?.element.focus();
    await buttons[0]?.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]?.element);
    await buttons[1]?.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[0]?.element);
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[0]?.element);
    wrapper.unmount();
  });
});

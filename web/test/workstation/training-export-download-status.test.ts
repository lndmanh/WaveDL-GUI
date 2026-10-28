// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TrainingExport from '../../app/components/project/TrainingExport.vue';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';

const draft = trainingRequestSchema.parse({
  backend: 'local',
  operation: 'train',
  config: trainingDefaults,
  runtime: {
    python: '/usr/bin/python3',
    mode: 'selected',
    device: 'cpu',
    environment: {},
  },
  topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('training YAML export status', () => {
  it('does not claim that the browser saved a file after link.click()', async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const wrapper = mount(TrainingExport, { props: { draft, disabled: false } });

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Download YAML')!
      .trigger('click');

    expect(click).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('export requested');
    expect(wrapper.text()).toContain('browser controls where it is saved');
    expect(wrapper.text()).not.toContain('downloaded');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    wrapper.unmount();
  });

  it('reports a rejected browser request without blaming valid training fields or leaking errors', async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('private browser detail');
    });
    const wrapper = mount(TrainingExport, { props: { draft, disabled: false } });

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Download YAML')!
      .trigger('click');

    expect(wrapper.text()).toContain('YAML export could not be requested');
    expect(wrapper.text()).not.toContain('Validate all training');
    expect(wrapper.text()).not.toContain('private browser detail');
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    wrapper.unmount();
  });
});

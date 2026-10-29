// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfigMenu from '../../app/components/project/ConfigMenu.vue';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';

const draft = trainingRequestSchema.parse({
  backend: 'local',
  operation: 'train',
  config: { ...trainingDefaults, model: 'cnn', data_path: '/data/train.npz' },
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

/** Opens the Import / Export menu from the keyboard and returns one of its items. */
async function menuItem(wrapper: VueWrapper, label: string): Promise<HTMLElement> {
  await wrapper.get('[data-testid="config-menu"]').trigger('keydown', { key: 'Enter' });
  await flushPromises();
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!item) throw new Error(`Missing menu item ${label}`);
  return item;
}

/** The run builder shows each notice as its banner title (ProjectContainer.exportNotice). */
function noticeTitles(wrapper: VueWrapper, i18n: ReturnType<typeof createTestI18n>): string[] {
  return (wrapper.emitted('notice') ?? []).map(([message]) =>
    typeof message === 'string' ? i18n.global.t(message) : String(message),
  );
}

describe('training YAML export status', () => {
  it('does not claim that the browser saved a file after link.click()', async () => {
    const i18n = createTestI18n('en');
    const wrapper = mount(
      ConfigMenu,
      { props: { draft, disabled: false }, attachTo: document.body },
      i18n,
    );
    const download = await menuItem(wrapper, 'Download YAML');
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    expect(wrapper.emitted('notice')).toBeUndefined();

    download.click();

    expect(click).toHaveBeenCalledOnce();
    expect(wrapper.emitted('notice')).toEqual([
      [
        'project.yamlExportRequested',
        true,
        'builder.exportSavedDetail',
      ],
    ]);
    const [title] = noticeTitles(wrapper, i18n);
    expect(title).toContain('export requested');
    expect(title).not.toContain('downloaded');
    expect(title).not.toContain('saved');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    wrapper.unmount();
  });

  it('reports a rejected browser request without blaming valid training fields or leaking errors', async () => {
    const i18n = createTestI18n('en');
    const wrapper = mount(
      ConfigMenu,
      { props: { draft, disabled: false }, attachTo: document.body },
      i18n,
    );
    const download = await menuItem(wrapper, 'Download YAML');
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('private browser detail');
    });

    download.click();

    expect(wrapper.emitted('notice')).toEqual([['project.yamlExportFailed', false]]);
    const [title] = noticeTitles(wrapper, i18n);
    expect(title).toContain('YAML export could not be requested');
    expect(title).not.toContain('Validate all training');
    expect(document.body.textContent).not.toContain('private browser detail');
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    wrapper.unmount();
  });
});

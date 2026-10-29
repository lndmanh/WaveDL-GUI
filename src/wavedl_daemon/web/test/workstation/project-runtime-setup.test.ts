// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountWithI18n as mount } from './mountWithI18n';
import { ConnectionSession } from './session-fixture';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import TrainingInspector from '../../app/components/project/TrainingInspector.vue';
import type { HostProfile } from '../../shared/schemas/host-profile';
import {
  builderForm,
  builderStubs,
  installMemoryStorage,
  jsonResponse,
  modelCatalogue,
} from './project-builder-fixture';

const profile: HostProfile = {
  hostname: 'lab-mac',
  os: 'Darwin',
  os_release: '27.0.0',
  arch: 'arm64',
  cpu_count: 12,
  memory_bytes: 25769803776,
  python: '/opt/wavedl/bin/python',
  python_version: '3.13.15',
  accelerators: { torch: '2.14.1', cuda: [], mps: true },
  backends: ['local'],
};
const cleanups: (() => void)[] = [];
beforeEach(() => installMemoryStorage());
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

async function setup(host: object | null) {
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/health')
        return jsonResponse({ daemon_id: 'daemon-a', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
      if (path === '/api/models') return jsonResponse(modelCatalogue);
      if (path === '/api/host')
        return host ? jsonResponse(host) : jsonResponse({ detail: 'Not Found' }, 404);
      throw new Error(`Unexpected route ${path}`);
    },
  });
  expect(await session.connect('credential-a')).toBe(true);
  const wrapper = mount(ProjectContainer, {
    props: { session },
    global: { stubs: builderStubs },
    attachTo: document.body,
  });
  cleanups.push(() => {
    wrapper.unmount();
    session.detach();
  });
  await flushPromises();
  return { wrapper, session };
}
function python(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.get('input[name="runtime.python"]').element;
  return input instanceof HTMLInputElement ? input.value : null;
}

describe('runtime setup', () => {
  it('prefills the detected Local setup automatically and keeps it in Manual', async () => {
    const { wrapper, session } = await setup(profile);
    expect(session.snapshot().status).toBe('connected');
    expect(wrapper.get('[data-testid="host-profile"]').text()).toContain('lab-mac');
    expect(wrapper.get('[data-testid="host-profile"]').text()).toContain('24 GB');
    expect(wrapper.get('[data-testid="runtime-automatic"]').text()).toContain('Apple GPU');
    expect(python(wrapper)).toBe('/opt/wavedl/bin/python');
    expect(wrapper.get('[data-testid="guide-step-3"]').text()).toContain('Apple GPU');
    // Slurm is not registered on this daemon, so it cannot be chosen.
    expect(wrapper.get('[data-testid="runtime-backend"] [data-value="slurm"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="runtime-setup"] [data-value="manual"]').trigger('click');
    expect(wrapper.find('[data-testid="runtime-automatic"]').exists()).toBe(false);
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    expect(python(wrapper)).toBe('/usr/bin/python3');
    const useDetected = wrapper.findAll('button').find((item) => item.text() === 'Use detected values');
    await useDetected?.trigger('click');
    expect(python(wrapper)).toBe('/opt/wavedl/bin/python');
  });

  it('falls back to Manual without breaking the connection when the daemon has no profile', async () => {
    const { wrapper, session } = await setup(null);
    expect(session.snapshot().status).toBe('connected');
    expect(wrapper.find('[data-testid="runtime-automatic"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="host-profile"]').text()).toContain('Couldn’t read this machine');
    expect(wrapper.get('[data-testid="runtime-manual"]').attributes('style') ?? '').not.toContain('none');
    expect(python(wrapper)).toBe('');
  });

  it('shows a blocked plan as a danger alert linking to each block to fix', async () => {
    const { wrapper } = await setup(null);
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(wrapper.find('.run-message').exists()).toBe(true));
    const alert = wrapper.get('.run-message');
    expect(alert.attributes('data-tone')).toBe('destructive');
    expect(alert.text()).toContain('Can’t create the plan yet');
    const fixes = alert.findAll('.run-message-fix').map((item) => item.text());
    expect(fixes.some((text) => text.startsWith('Dataset'))).toBe(true);
    expect(fixes.some((text) => text.startsWith('Model'))).toBe(true);
  });

  it('jumps from a setting search result into its closed group', async () => {
    const { wrapper } = await setup(profile);
    const training = wrapper.getComponent(TrainingInspector);
    const search = training.get('[data-testid="training-advanced-search"]');
    await search.trigger('focus');
    await search.setValue('weight decay');
    const option = training.get('[role="option"]');
    expect(option.text()).toContain('Weight decay');
    expect(option.text()).toContain('Optimizer tuning');
    await option.trigger('click');
    await flushPromises();
    expect(training.find('[role="option"]').exists()).toBe(false);
    const row = training.get('[data-field="weight_decay"]');
    expect(row.element.closest('[data-slot="collapsible"]')?.getAttribute('data-state')).toBe('open');
  });
});

// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsWorkspace from '../../app/components/settings/SettingsWorkspace.vue';
import AppearanceSettings from '../../app/components/settings/AppearanceSettings.vue';
import TrainingDefaultsSettings from '../../app/components/settings/TrainingDefaultsSettings.vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import { ConnectionSession } from './session-fixture';
import {
  defaultAppearance,
  appearanceSchema,
  defaultTrainingPreferences,
  loadAppearance,
  loadTrainingPreferences,
  saveAppearance,
  saveTrainingPreferences,
  trainingPreferenceFields,
} from '../../app/lib/preferences';

beforeEach(() => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

describe('settings workspace acceptance', () => {
  it('is available disconnected, enables both languages and links safely to feedback', async () => {
    const wrapper = mount(SettingsWorkspace, { props: { daemonId: null } });
    await flushPromises();
    expect(wrapper.text()).toContain('Connect to a daemon');
    expect(wrapper.text()).toContain('not daemon administration');
    expect(wrapper.get('#preference-language').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('#preference-language').text()).toContain('Tiếng Việt');
    const link = wrapper.get('a');
    expect(link.attributes('href')).toBe('https://github.com/ductho-le/WaveDL');
    expect(link.attributes('rel')).toContain('noopener');
    expect(wrapper.text()).toContain('browser chooses where');
    wrapper.unmount();
  });

  it('saves numeric zoom through the actual native select and emits validated settings', async () => {
    const wrapper = mount(AppearanceSettings);
    await flushPromises();
    await wrapper.get('#preference-zoom').setValue('125');
    await wrapper.get('#preference-theme').setValue('dark');
    await wrapper.get('#preference-accent').setValue('green');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Browser preferences saved.'));
    expect(loadAppearance()).toEqual({
      ...defaultAppearance,
      zoom: 125,
      theme: 'dark',
      accent: 'green',
    });
    expect(wrapper.emitted('changed')).toEqual([[loadAppearance()]]);
    expect(document.documentElement.style.fontSize).toBe('20px');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await wrapper.get('#preference-theme').setValue('light');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Discard changes')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.get('#preference-theme').element).toHaveProperty('value', 'dark');
    wrapper.unmount();
  });

  it('keeps session appearance on media changes even if browser storage rejects saving', async () => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    const storage = window.localStorage;
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const wrapper = mount(AppearanceSettings);
    await flushPromises();
    await wrapper.get('#preference-theme').setValue('dark');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Applied for this session'));
    media.dispatchEvent(new Event('change'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(loadAppearance().theme).toBe('system');
    wrapper.unmount();
  });

  it('restores session-only settings when reopened and discards to the last applied value', async () => {
    const appearance = { ...defaultAppearance, theme: 'dark', zoom: 125 };
    const parsed = appearanceSchema.parse(appearance);
    const wrapper = mount(SettingsWorkspace, { props: { daemonId: null, appearance: parsed } });
    await flushPromises();
    expect(wrapper.get('#preference-theme').element).toHaveProperty('value', 'dark');
    expect(wrapper.get('#preference-zoom').element).toHaveProperty('value', '125');
    await wrapper.get('#preference-theme').setValue('light');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Discard changes')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.get('#preference-theme').element).toHaveProperty('value', 'dark');
    wrapper.unmount();
  });

  it('renders only safe defaults and saves, switches daemon and resets without touching appearance', async () => {
    saveTrainingPreferences('one', { ...defaultTrainingPreferences(), epochs: 13 });
    saveTrainingPreferences('two', { ...defaultTrainingPreferences(), epochs: 27 });
    saveAppearance({ ...defaultAppearance, theme: 'dark' });
    const wrapper = mount(TrainingDefaultsSettings, { props: { daemonId: 'one' } });
    await flushPromises();
    for (const name of trainingPreferenceFields)
      expect(wrapper.findAll(`[id$="-training-${name}"]`)).toHaveLength(1);
    expect(wrapper.find('[id$="-training-import_modules"]').exists()).toBe(false);
    expect(wrapper.get('[id$="-training-epochs"]').element).toHaveProperty('value', '13');
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(loadTrainingPreferences('one').epochs).toBe(17));
    await wrapper.setProps({ daemonId: 'two' });
    await flushPromises();
    expect(wrapper.get('[id$="-training-epochs"]').element).toHaveProperty('value', '27');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Reset training defaults')
      ?.trigger('click');
    await flushPromises();
    expect(loadTrainingPreferences('two')).toEqual(defaultTrainingPreferences());
    expect(loadTrainingPreferences('one').epochs).toBe(17);
    expect(loadAppearance().theme).toBe('dark');
    wrapper.unmount();
  });

  it('uses saved defaults and guide only when a fresh project mounts, not on settings saves', async () => {
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async () =>
        new Response(
          JSON.stringify({ daemon_id: 'one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 }),
          { headers: { 'content-type': 'application/json' } },
        ),
    });
    expect(await owner.connect('credential')).toBe(true);
    saveAppearance({ ...defaultAppearance, showProjectGuide: false });
    saveTrainingPreferences('one', { ...defaultTrainingPreferences(), epochs: 13 });
    const wrapper = mount(ProjectContainer, { props: { session: owner } });
    await flushPromises();
    expect(wrapper.get('[id$="-training-epochs"]').element).toHaveProperty('value', '13');
    expect(wrapper.find('[aria-current="step"]').exists()).toBe(false);
    saveTrainingPreferences('one', { ...defaultTrainingPreferences(), epochs: 99 });
    await flushPromises();
    expect(wrapper.get('[id$="-training-epochs"]').element).toHaveProperty('value', '13');
    wrapper.unmount();
    saveAppearance({ ...defaultAppearance, showProjectGuide: true });
    // The intentionally minimal health fixture is not a catalogue response;
    // reverify identity before constructing the next fresh draft.
    expect(await owner.connect('credential')).toBe(true);
    const next = mount(ProjectContainer, { props: { session: owner } });
    await flushPromises();
    expect(next.get('[id$="-training-epochs"]').element).toHaveProperty('value', '99');
    expect(next.find('[aria-current="step"]').exists()).toBe(true);
    next.unmount();
    owner.detach();
  });
});

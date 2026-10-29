// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appearanceSchema,
  defaultAppearance,
  defaultTrainingPreferences,
  trainingPreferencesSchema,
  trainingPreferenceFields,
  loadAppearance,
  loadKeepSignedIn,
  saveAppearance,
  saveKeepSignedIn,
  loadTrainingPreferences,
  saveTrainingPreferences,
  resetTrainingPreferences,
  applyTrainingPreferences,
  applyAppearance,
  PREFERENCES_LIMIT,
} from '../../app/lib/preferences';
import { trainingDefaults } from '../../shared/schemas/training-request';

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
    get length() {
      return items.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('bounded browser preferences', () => {
  it('preserves valid version-one English appearance and round-trips Vietnamese', () => {
    const english = { ...defaultAppearance, theme: 'dark', zoom: 125 };
    window.localStorage.setItem(
      'wavedl.appearance.v1',
      JSON.stringify({ version: 1, preferences: english }),
    );
    expect(loadAppearance()).toEqual(english);
    const vietnamese = appearanceSchema.parse({ ...english, language: 'vi' });
    expect(saveAppearance(vietnamese)).toBe(true);
    expect(loadAppearance()).toEqual(vietnamese);
    expect(JSON.parse(window.localStorage.getItem('wavedl.appearance.v1') ?? '{}').version).toBe(1);
    const root = document.createElement('div');
    applyAppearance(vietnamese, root, false);
    expect(root.lang).toBe('vi');
    applyAppearance(defaultAppearance, root, false);
    expect(root.lang).toBe('en');
  });

  it('defaults the keep-signed-in preference off for legacy envelopes and stores only a boolean', () => {
    window.localStorage.setItem(
      'wavedl.appearance.v1',
      JSON.stringify({
        version: 1,
        preferences: {
          theme: 'system',
          accent: 'neutral',
          zoom: 100,
          language: 'en',
          showProjectGuide: true,
        },
      }),
    );
    expect(loadKeepSignedIn()).toBe(false);
    expect(loadAppearance()).not.toHaveProperty('keepSignedIn');

    expect(saveKeepSignedIn(true)).toBe(true);
    expect(loadKeepSignedIn()).toBe(true);
    expect(window.localStorage.getItem('wavedl.keep-signed-in.v1')).toBe('true');
    const stored = JSON.parse(window.localStorage.getItem('wavedl.appearance.v1') ?? '{}');
    expect(stored.preferences).not.toHaveProperty('keepSignedIn');
  });

  it('keeps appearance saved before the project guide was retired', () => {
    window.localStorage.setItem(
      'wavedl.appearance.v1',
      JSON.stringify({
        version: 1,
        preferences: {
          theme: 'dark',
          accent: 'violet',
          zoom: 110,
          language: 'vi',
          showProjectGuide: false,
        },
      }),
    );
    expect(loadAppearance()).toEqual({ theme: 'dark', accent: 'violet', zoom: 110, language: 'vi' });
  });

  it('keeps opt-out independent of a stale appearance save', () => {
    const staleAppearance = loadAppearance();
    expect(saveKeepSignedIn(true)).toBe(true);
    expect(saveKeepSignedIn(false)).toBe(true);
    expect(saveAppearance({ ...staleAppearance, theme: 'dark' })).toBe(true);
    expect(loadKeepSignedIn()).toBe(false);
    expect(window.localStorage.getItem('wavedl.keep-signed-in.v1')).toBe('false');
    expect(appearanceSchema.safeParse({ ...staleAppearance, keepSignedIn: true }).success).toBe(
      false,
    );
  });

  it.each(['"true"', '{}', '[true]', ' true ', 'true'.repeat(100)])(
    'rejects invalid or oversized sign-in preference %s',
    (raw) => {
      window.localStorage.setItem('wavedl.keep-signed-in.v1', raw);
      expect(loadKeepSignedIn()).toBe(false);
    },
  );

  it.each(['fr', 'EN', 'vi-VN', '', null])(
    'rejects unsupported appearance language %s',
    (language) => {
      expect(appearanceSchema.safeParse({ ...defaultAppearance, language }).success).toBe(false);
      window.localStorage.setItem(
        'wavedl.appearance.v1',
        JSON.stringify({ version: 1, preferences: { ...defaultAppearance, language } }),
      );
      expect(loadAppearance()).toEqual(defaultAppearance);
    },
  );

  it('round-trips independent appearance and daemon-specific defaults', () => {
    expect(saveAppearance({ ...defaultAppearance, zoom: 125, theme: 'dark' })).toBe(true);
    const first = { ...defaultTrainingPreferences(), epochs: 7, wandb: true };
    const second = { ...defaultTrainingPreferences(), epochs: 21 };
    expect(saveTrainingPreferences('one/東京', first)).toBe(true);
    expect(saveTrainingPreferences('two', second)).toBe(true);
    expect(loadAppearance()).toMatchObject({ zoom: 125, theme: 'dark' });
    expect(loadTrainingPreferences('one/東京')).toEqual(first);
    expect(loadTrainingPreferences('two')).toEqual(second);
    expect(resetTrainingPreferences('one/東京')).toBe(true);
    expect(loadTrainingPreferences('one/東京')).toEqual(defaultTrainingPreferences());
    expect(loadTrainingPreferences('two')).toEqual(second);
    expect(loadAppearance().zoom).toBe(125);
  });

  it.each([
    'model',
    'data_path',
    'runtime',
    'environment',
    'token',
    'python',
    'import_modules',
    'resume',
    'constraint_file',
    'output_dir',
    'project_name',
    'run_name',
  ])('rejects authority or private field %s instead of silently storing it', (name) => {
    const value = { ...defaultTrainingPreferences(), [name]: 'private' };
    expect(trainingPreferencesSchema.safeParse(value).success).toBe(false);
    expect(saveTrainingPreferences('one', value)).toBe(false);
    expect(window.localStorage.length).toBe(0);
    expect(trainingPreferenceFields).not.toContain(name);
  });

  it.each([Number.NaN, Infinity, -Infinity, 0])('rejects invalid learning rate %s', (lr) => {
    expect(saveTrainingPreferences('one', { ...defaultTrainingPreferences(), lr })).toBe(false);
  });

  it.each(['', 'x'.repeat(257), 'one\0two', 'one\ntwo'])(
    'rejects invalid daemon identity',
    (id) => {
      expect(saveTrainingPreferences(id, defaultTrainingPreferences())).toBe(false);
      expect(resetTrainingPreferences(id)).toBe(false);
      expect(loadTrainingPreferences(id)).toEqual(defaultTrainingPreferences());
    },
  );

  it('does not trust a valid preference envelope from a different daemon', () => {
    window.localStorage.setItem(
      'wavedl.training-defaults.v1.one',
      JSON.stringify({
        version: 1,
        daemonId: 'two',
        preferences: { ...defaultTrainingPreferences(), epochs: 999 },
      }),
    );
    expect(loadTrainingPreferences('one')).toEqual(defaultTrainingPreferences());
  });

  it.each([
    '{',
    'null',
    '[]',
    '{"version":2}',
    JSON.stringify({ version: 1, preferences: { ...defaultAppearance, language: 'fr' } }),
    JSON.stringify({ version: 1, preferences: { ...defaultAppearance, zoom: '125' } }),
    JSON.stringify({
      version: 1,
      preferences: { ...defaultAppearance, theme: 'dark' },
      token: 'private',
    }),
    `{"version":2,"version":1,"preferences":${JSON.stringify({ ...defaultAppearance, theme: 'dark' })}}`,
    `{"version":2,"\\u0076ersion":1,"preferences":${JSON.stringify({ ...defaultAppearance, theme: 'dark' })}}`,
    ' '.repeat(PREFERENCES_LIMIT) +
      JSON.stringify({ version: 1, preferences: { ...defaultAppearance, theme: 'dark' } }),
    '東京'.repeat(PREFERENCES_LIMIT / 3),
  ])('falls back safely on malformed, ambiguous or oversized appearance', (raw) => {
    window.localStorage.setItem('wavedl.appearance.v1', raw);
    expect(loadAppearance()).toEqual(defaultAppearance);
  });

  it('falls back safely on nonfinite and duplicate training values', () => {
    const encoded = JSON.stringify(defaultTrainingPreferences());
    for (const raw of [
      encoded.replace(/"lr":[^,]+/, '"lr":1e999'),
      encoded.replace(/"epochs":\d+/, '"epochs":999,"epochs":100'),
    ]) {
      window.localStorage.setItem(
        'wavedl.training-defaults.v1.one',
        `{"version":1,"daemonId":"one","preferences":${raw}}`,
      );
      expect(loadTrainingPreferences('one')).toEqual(defaultTrainingPreferences());
    }
  });

  it('contains getter, read, write and reset failures without throwing', () => {
    const broken = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    expect(loadAppearance(broken)).toEqual(defaultAppearance);
    expect(saveAppearance(defaultAppearance, broken)).toBe(false);
    expect(loadTrainingPreferences('one', broken)).toEqual(defaultTrainingPreferences());
    expect(saveTrainingPreferences('one', defaultTrainingPreferences(), broken)).toBe(false);
    expect(resetTrainingPreferences('one', broken)).toBe(false);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadAppearance()).toEqual(defaultAppearance);
    expect(saveAppearance(defaultAppearance)).toBe(false);
  });

  it('creates a fresh draft without changing the current configuration or private selections', () => {
    const current = {
      ...trainingDefaults,
      model: 'custom',
      data_path: '/private/data.npz',
      import_modules: ['my_model'],
      resume: '/private/resume',
      run_name: 'my-run',
    };
    const snapshot = structuredClone(current);
    const result = applyTrainingPreferences(current, {
      ...defaultTrainingPreferences(),
      epochs: 12,
    });
    expect(current).toEqual(snapshot);
    expect(result).toEqual({ ...snapshot, epochs: 12 });
    expect(result).not.toBe(current);
  });

  it('applies explicit/system themes and resets inline accents to stylesheet defaults', () => {
    const root = document.createElement('div');
    applyAppearance(
      { ...defaultAppearance, theme: 'system', accent: 'violet', zoom: 125 },
      root,
      true,
    );
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.fontSize).toBe('20px');
    expect(root.style.getPropertyValue('--primary')).toContain('oklch');
    // Custom accents must not inherit the dark default's dark button foreground.
    expect(root.style.getPropertyValue('--primary-foreground')).toBe('#ffffff');
    applyAppearance({ ...defaultAppearance, theme: 'light' }, root, true);
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.style.fontSize).toBe('16px');
    for (const name of ['--primary', '--ring', '--primary-foreground'])
      expect(root.style.getPropertyValue(name)).toBe('');
    expect(appearanceSchema.safeParse({ ...defaultAppearance, zoom: 101 }).success).toBe(false);
  });
});

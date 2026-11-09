import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { computed, shallowRef } from 'vue';
import {
  DEFAULT_SHELL_SIDEBAR,
  storedShellSidebarSchema,
  locateRequestSchema,
  resultExportSchema,
  runtimeDeviceSchema,
  segmentedSelectionSchema,
} from '../../shared/schemas/workstation-controls';
import { planManifestSchema, planPreviewContextSchema } from '../../shared/schemas/plan-summary';
import {
  trainingConfigBaseSchema,
  trainingDefaults,
  trainingFieldMetadata,
} from '../../shared/schemas/training-request';
import { inferenceConfigSchema } from '../../shared/schemas/result-request';
import { trainingCommand } from '../../app/lib/training-export';
import {
  clearDataPreferences,
  loadShellDockSlots,
  loadShellSidebar,
  PREFERENCES_LIMIT,
  saveShellDockSlots,
  saveShellSidebar,
} from '../../app/lib/preferences';
import { DEFAULT_SHELL_DOCK_SLOTS } from '../../app/constants/shellDock';
import type { PreferenceStorage } from '../../types/preferences';

function storage(): PreferenceStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('shell sidebar preferences', () => {
  it('defaults each sidebar preference independently', () => {
    const saved = storage();

    expect(DEFAULT_SHELL_SIDEBAR).toEqual({ collapsed: false, activeRunsOpen: true });
    expect(storedShellSidebarSchema.parse({})).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(storedShellSidebarSchema.parse({ collapsed: true, activeRunsOpen: 'x' })).toEqual({
      collapsed: true,
      activeRunsOpen: true,
    });
    expect(storedShellSidebarSchema.parse({ collapsed: 'x', activeRunsOpen: false })).toEqual({
      collapsed: false,
      activeRunsOpen: false,
    });

    for (const value of [{}, { collapsed: true, activeRunsOpen: 'x' }]) {
      saved.setItem('wavedl.shell-sidebar.v1', JSON.stringify(value));
      expect(loadShellSidebar(saved)).toEqual(storedShellSidebarSchema.parse(value));
    }

    saved.setItem('wavedl.shell-sidebar.v1', 'null');
    expect(loadShellSidebar(saved)).toEqual(DEFAULT_SHELL_SIDEBAR);
  });

  it('persists sidebar preferences independently of the dock and clears both', () => {
    const saved = storage();
    const sidebar = { collapsed: true, activeRunsOpen: false };

    expect(loadShellSidebar(saved)).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(saveShellDockSlots(DEFAULT_SHELL_DOCK_SLOTS, saved)).toBe(true);
    expect(saveShellSidebar(sidebar, saved)).toBe(true);
    expect(saved.getItem('wavedl.shell-sidebar.v1')).toBe(JSON.stringify(sidebar));
    expect(loadShellSidebar(saved)).toEqual(sidebar);
    expect(loadShellDockSlots(saved)).toEqual(DEFAULT_SHELL_DOCK_SLOTS);
    expect(clearDataPreferences(saved)).toBe(true);
    expect(saved.getItem('wavedl.shell-sidebar.v1')).toBeNull();
    expect(saved.getItem('wavedl.shell-dock.v1')).toBeNull();
    expect(loadShellSidebar(saved)).toEqual(DEFAULT_SHELL_SIDEBAR);
  });

  it('tolerates invalid, oversized and unavailable sidebar storage', () => {
    const saved = storage();

    const blocked: PreferenceStorage = {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Storage blocked');
      },
      removeItem: () => {
        throw new Error('Storage blocked');
      },
    };

    for (const raw of ['not JSON', 'null', '[]', 'true', '1', '"sidebar"']) {
      saved.setItem('wavedl.shell-sidebar.v1', raw);
      expect(loadShellSidebar(saved)).toEqual(DEFAULT_SHELL_SIDEBAR);
    }

    const raw = JSON.stringify({ collapsed: true, padding: 'é'.repeat(PREFERENCES_LIMIT / 2) });
    expect(raw.length).toBeLessThan(PREFERENCES_LIMIT);
    saved.setItem('wavedl.shell-sidebar.v1', raw);
    expect(loadShellSidebar(saved)).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(loadShellSidebar(blocked)).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(loadShellSidebar(null)).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(saveShellSidebar(DEFAULT_SHELL_SIDEBAR, blocked)).toBe(false);
    expect(saveShellSidebar(DEFAULT_SHELL_SIDEBAR, null)).toBe(false);
  });
});

describe('shell sidebar preference store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('defineStore', defineStore);
    vi.stubGlobal('shallowRef', shallowRef);
    vi.stubGlobal('computed', computed);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves manual changes, resets both preferences and reloads after clearing', async () => {
    const saved = storage();
    vi.stubGlobal('window', { localStorage: saved });
    const { useShellPreferencesStore } = await import('../../app/stores/shellPreferenceStore');
    const preferences = useShellPreferencesStore();

    expect(preferences.sidebar).toEqual(DEFAULT_SHELL_SIDEBAR);
    preferences.toggleSidebarCollapsed();
    preferences.setActiveRunsOpen(false);
    expect(preferences.sidebar).toEqual({ collapsed: true, activeRunsOpen: false });
    expect(loadShellSidebar(saved)).toEqual(preferences.sidebar);
    expect(preferences.saveFailed).toBe(false);
    preferences.toggleSidebarCollapsed();
    expect(preferences.sidebar).toEqual({ collapsed: false, activeRunsOpen: false });
    preferences.updateSlots(['results', 'project', 'datasets', 'experiments', 'settings']);
    expect(preferences.sidebar.collapsed).toBe(false);
    preferences.reset();
    expect(preferences.dockSlots).toEqual(DEFAULT_SHELL_DOCK_SLOTS);
    expect(loadShellDockSlots(saved)).toEqual(DEFAULT_SHELL_DOCK_SLOTS);
    expect(preferences.sidebar).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(loadShellSidebar(saved)).toEqual(DEFAULT_SHELL_SIDEBAR);

    saveShellSidebar({ collapsed: true, activeRunsOpen: false }, saved);
    preferences.reload();
    expect(preferences.sidebar).toEqual({ collapsed: true, activeRunsOpen: false });
    clearDataPreferences(saved);
    preferences.reload();
    expect(preferences.sidebar).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(preferences.dockSlots).toEqual(DEFAULT_SHELL_DOCK_SLOTS);
    expect(preferences.saveFailed).toBe(false);
  });

  it.each(['wavedl.shell-dock.v1', 'wavedl.shell-sidebar.v1'])(
    'reports a reset failure when only %s is blocked',
    async (blockedKey) => {
      const saved = storage();

      const partial: PreferenceStorage = {
        ...saved,
        setItem: (key, value) => {
          if (key === blockedKey) throw new Error('Storage blocked');
          saved.setItem(key, value);
        },
      };

      vi.stubGlobal('window', { localStorage: partial });
      const { useShellPreferencesStore } = await import('../../app/stores/shellPreferenceStore');
      const preferences = useShellPreferencesStore();

      preferences.reset();
      expect(preferences.saveFailed).toBe(true);
      expect(preferences.sidebar).toEqual(DEFAULT_SHELL_SIDEBAR);
      expect(preferences.dockSlots).toEqual(DEFAULT_SHELL_DOCK_SLOTS);
    },
  );

  it('keeps manual changes in memory when saving fails and clears the error on reload', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('Storage blocked');
      },
    });
    const { useShellPreferencesStore } = await import('../../app/stores/shellPreferenceStore');
    const preferences = useShellPreferencesStore();

    preferences.toggleSidebarCollapsed();
    expect(preferences.sidebar).toEqual({ collapsed: true, activeRunsOpen: true });
    expect(preferences.saveFailed).toBe(true);
    preferences.setActiveRunsOpen(false);
    expect(preferences.sidebar).toEqual({ collapsed: true, activeRunsOpen: false });
    expect(preferences.saveFailed).toBe(true);
    preferences.reset();
    expect(preferences.sidebar).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(preferences.saveFailed).toBe(true);
    preferences.reload();
    expect(preferences.sidebar).toEqual(DEFAULT_SHELL_SIDEBAR);
    expect(preferences.saveFailed).toBe(false);
  });
});

describe('workstation control boundaries', () => {
  it('accepts declared select values without coercing other emit values', () => {
    for (const device of ['cpu', 'cuda', 'mps', 'auto'])
      expect(runtimeDeviceSchema.parse(device)).toBe(device);

    for (const value of ['', 1, false, null, {}, ['cpu']])
      expect(runtimeDeviceSchema.safeParse(value).success).toBe(false);

    expect(resultExportSchema.parse(null)).toBeNull();
    expect(resultExportSchema.parse('onnx')).toBe('onnx');
    expect(resultExportSchema.safeParse('other').success).toBe(false);
    expect(segmentedSelectionSchema(['cpu', 'cuda']).safeParse('').success).toBe(false);
    expect(segmentedSelectionSchema(['cpu', 'cuda']).parse('cuda')).toBe('cuda');
    expect(segmentedSelectionSchema([]).safeParse('cpu').success).toBe(false);
  });

  it('keeps additive locate request behavior', () => {
    expect(locateRequestSchema.parse({ root: '', path: '', extra: true })).toEqual({
      root: '',
      path: '',
    });
    expect(locateRequestSchema.safeParse({ root: 'data', path: 1 }).success).toBe(false);
  });

  it('rejects unknown, stale, empty and non-string checkpoint choices', () => {
    const choices = segmentedSelectionSchema(['best_checkpoint', 'epoch_5_checkpoint']);

    expect(choices.parse('epoch_5_checkpoint')).toBe('epoch_5_checkpoint');

    for (const value of ['interrupted_checkpoint', '', 2, {}, null])
      expect(choices.safeParse(value).success).toBe(false);

    expect(
      segmentedSelectionSchema(['best_checkpoint']).safeParse('epoch_5_checkpoint').success,
    ).toBe(false);
  });

  it('keeps every selectable training default among its declared choices', () => {
    const choices = trainingFieldMetadata.filter((field) => field.choices.length > 0);

    expect(choices.map((field) => field.name)).toEqual([
      'loss',
      'optimizer',
      'scheduler',
      'cache_validate',
      'precision',
      'constraint_reduction',
    ]);

    for (const field of choices) expect(field.choices).toContain(trainingDefaults[field.name]);
  });

  it('retains the original manifest while decoding review fields once', () => {
    const manifest = { operation: 1, resolved_config: [], runtime: { device: false }, extra: true };
    const parsed = planManifestSchema.parse(manifest);

    expect(parsed.manifest).toEqual(manifest);
    expect(parsed.review).toEqual({
      operation: undefined,
      resolved_config: {},
      runtime: { device: undefined },
    });
    expect(planManifestSchema.safeParse([]).success).toBe(false);
    expect(planPreviewContextSchema.parse({ target: null, topology: false })).toEqual({
      target: undefined,
      topology: {},
    });
    expect(
      planManifestSchema.parse({ runtime: { device: 'cuda' }, resolved_config: { epochs: 4 } })
        .review,
    ).toMatchObject({ runtime: { device: 'cuda' }, resolved_config: { epochs: 4 } });
  });

  it('rejects NUL characters before a request reaches the daemon', () => {
    expect(trainingConfigBaseSchema.shape.model.safeParse('\0').success).toBe(false);
  });

  it('refuses only list entries that upstream would read as a flag', () => {
    const config = trainingConfigBaseSchema.shape;
    const listed = config.constraint.safeParse(['y0 - y1', '-y0']);

    expect(listed.success).toBe(false);

    if (!listed.success)
      expect(listed.error.issues[0]?.message).toBe('List entries cannot start with "-".');
    expect(config.import_modules.safeParse(['-m']).success).toBe(false);
    expect(inferenceConfigSchema.shape.param_names.safeParse(['-a']).success).toBe(false);
    expect(inferenceConfigSchema.shape.import_modules.safeParse(['-m']).success).toBe(false);
    expect(config.run_name.parse('-x')).toBe('-x');
    expect(config.grad_clip.parse(-1e-7)).toBe(-1e-7);
    expect(inferenceConfigSchema.shape.input_key.parse('-X')).toBe('-X');
  });

  it('exports negative list numbers only in a form argparse reads as values', () => {
    const request = (constraint_weight: number[]) =>
      trainingCommand({
        backend: 'local',
        operation: 'train',
        config: { ...trainingDefaults, grad_clip: -1e-7, constraint_weight },
        runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
        topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
      });

    expect(request([-0.5, -2])).toContain(' --constraint_weight -0.5 -2');
    expect(request([-0.5])).toContain(' --grad_clip=-1e-7');
    expect(() => request([-1e-7])).toThrow(
      'List entries in command-line exports can’t start with an option prefix. Export as YAML instead.',
    );
  });

  it('exports a runnable command with only changed options for any device and runtime', () => {
    const command = trainingCommand({
      backend: 'local',
      operation: 'train',
      config: { ...trainingDefaults, data_path: '/data/my set.npz', epochs: 200 },
      runtime: {
        python: 'C:\\Python\\python.exe',
        mode: 'container',
        device: 'auto',
        environment: { CUDA_VISIBLE_DEVICES: '0,1', NOTE: "it's" },
      },
      topology: { num_machines: 1, processes_per_machine: 2, machine_rank: 0 },
    });

    expect(command).toBe(
      "CUDA_VISIBLE_DEVICES=0,1 NOTE='it'\\''s' wavedl-train --num_gpus 2 " +
        "--model=cnn --epochs=200 '--data_path=/data/my set.npz' --output_dir ./results",
    );
  });
});

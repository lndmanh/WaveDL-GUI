import { describe, expect, it } from 'vitest';
import {
  clearProjectDraft,
  draftRequest,
  draftSetup,
  loadProjectDraft,
  projectDraft,
  saveProjectDraft,
  validDraftConfig,
  type DraftSnapshot,
} from '../../app/lib/project-draft';
import type { PreferenceStorage } from '../../app/lib/preferences';
import { projectDraftSchema } from '../../shared/schemas/project-draft';
import {
  trainingDefaults,
  trainingRequestSchema,
  type TrainingRequest,
} from '../../shared/schemas/training-request';

function memoryStorage() {
  const items = new Map<string, string>();
  const storage: PreferenceStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
  return { items, storage };
}
const throwingStorage: PreferenceStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};
function freshRequest(): TrainingRequest {
  return trainingRequestSchema.parse({
    backend: 'local',
    operation: 'train',
    config: trainingDefaults,
    runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'auto', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  });
}
function snapshot(request: TrainingRequest = freshRequest()): DraftSnapshot {
  return {
    block: 'training',
    data: {
      path: '/srv/data/waves/train.npz',
      root: 'data',
      relativePath: 'waves/train.npz',
      daemonId: 'daemon-one',
      kind: 'file',
    },
    model: { model: 'cnn', daemonId: 'daemon-one' },
    request,
    setup: 'manual',
  };
}
const key = 'wavedl.training-draft.v1.daemon-one';

describe('browser-local training drafts', () => {
  it('keeps individually valid config values and drops invalid ones field by field', () => {
    const config = validDraftConfig({
      ...trainingDefaults,
      lr: Number.NaN,
      batch_size: -4,
      betas: '0.9',
      optimizer: 'not-an-optimizer',
      epochs: 25,
      scheduler: 'cosine',
    });
    expect(config).not.toHaveProperty('lr');
    expect(config).not.toHaveProperty('batch_size');
    expect(config).not.toHaveProperty('betas');
    expect(config).not.toHaveProperty('optimizer');
    expect(config).toMatchObject({ epochs: 25, scheduler: 'cosine', loss: 'mse' });
    expect(config).not.toHaveProperty('data_path');
    expect(config).not.toHaveProperty('model');
    expect(validDraftConfig({ epochs: undefined, patience: 3 })).toEqual({ patience: 3 });
  });

  it('snapshots selections and runtime but never stores environment values', () => {
    const request = freshRequest();
    const draft = projectDraft(
      'daemon-one',
      snapshot({
        ...request,
        config: { ...request.config, epochs: 12, lr: Number.NaN },
        runtime: { ...request.runtime, environment: { API_TOKEN: 'private-secret' } },
        topology: { num_machines: Number.NaN, processes_per_machine: 2, machine_rank: 0 },
        storage_map: [
          { host_root: '/srv/data', execution_root: '/mnt/data' },
          { host_root: 'relative', execution_root: '/mnt/other' },
        ],
      }),
    );
    expect(draft).toMatchObject({
      version: 1,
      daemonId: 'daemon-one',
      block: 'training',
      dataset: { root: 'data', relativePath: 'waves/train.npz' },
      model: { id: 'cnn', custom: false },
      backend: 'local',
      setup: 'manual',
      runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'auto' },
      topology: { processes_per_machine: 2, machine_rank: 0 },
      storage_map: [{ host_root: '/srv/data', execution_root: '/mnt/data' }],
    });
    expect(draft.config.epochs).toBe(12);
    expect(draft.config).not.toHaveProperty('lr');
    expect(draft.topology).not.toHaveProperty('num_machines');
    expect(draft.runtime).not.toHaveProperty('environment');
    expect(JSON.stringify(draft)).not.toContain('private-secret');
    expect(JSON.stringify(draft)).not.toContain('API_TOKEN');
    expect(
      projectDraft('daemon-one', {
        ...snapshot(),
        data: null,
        model: { model: 'my.Net', daemonId: 'daemon-one', source: 'custom' },
      }),
    ).toMatchObject({ dataset: null, model: { id: 'my.Net', custom: true } });
  });

  it('round-trips through storage under a per-daemon key', () => {
    const { items, storage } = memoryStorage();
    expect(saveProjectDraft('daemon-one', snapshot(), storage)).toBe(true);
    expect([...items.keys()]).toEqual([key]);
    const loaded = loadProjectDraft('daemon-one', storage);
    expect(loaded).toEqual(projectDraftSchema.parse(JSON.parse(items.get(key) ?? '{}')));
    expect(loaded?.dataset).toEqual({ root: 'data', relativePath: 'waves/train.npz' });
    expect(loadProjectDraft('daemon-two', storage)).toBeNull();
    expect(saveProjectDraft('daemon/two', snapshot(), storage)).toBe(true);
    expect(items.has('wavedl.training-draft.v1.daemon%2Ftwo')).toBe(true);
    expect(loadProjectDraft('daemon/two', storage)?.daemonId).toBe('daemon/two');
  });

  it('rejects drafts recorded for another daemon, corrupt or oversized', () => {
    const { items, storage } = memoryStorage();
    saveProjectDraft('daemon-one', snapshot(), storage);
    const other = items.get(key) ?? '';
    items.set('wavedl.training-draft.v1.daemon-two', other);
    expect(loadProjectDraft('daemon-two', storage)).toBeNull();
    items.set(key, '{not json');
    expect(loadProjectDraft('daemon-one', storage)).toBeNull();
    items.set(key, JSON.stringify({ ...JSON.parse(other), extra: true }));
    expect(loadProjectDraft('daemon-one', storage)).toBeNull();
    items.set(key, JSON.stringify({ ...JSON.parse(other), version: 2 }));
    expect(loadProjectDraft('daemon-one', storage)).toBeNull();
    // Whitespace keeps the JSON valid, so only the size bound can refuse it.
    items.set(key, other + ' '.repeat(64 * 1024));
    expect(loadProjectDraft('daemon-one', storage)).toBeNull();
    items.set(key, other);
    expect(loadProjectDraft('daemon-one', storage)).not.toBeNull();
  });

  it('refuses invalid daemon identities without touching storage', () => {
    const { items, storage } = memoryStorage();
    expect(saveProjectDraft('', snapshot(), storage)).toBe(false);
    expect(saveProjectDraft('a'.repeat(257), snapshot(), storage)).toBe(false);
    expect(saveProjectDraft('daemon\none', snapshot(), storage)).toBe(false);
    expect(items.size).toBe(0);
    expect(loadProjectDraft('', storage)).toBeNull();
    expect(() => clearProjectDraft('', storage)).not.toThrow();
  });

  it('clears only the daemon draft it names', () => {
    const { items, storage } = memoryStorage();
    saveProjectDraft('daemon-one', snapshot(), storage);
    saveProjectDraft('daemon-two', snapshot(), storage);
    clearProjectDraft('daemon-one', storage);
    expect(loadProjectDraft('daemon-one', storage)).toBeNull();
    expect(loadProjectDraft('daemon-two', storage)).not.toBeNull();
    expect(items.size).toBe(1);
  });

  it('treats unavailable or refusing storage as no draft', () => {
    expect(saveProjectDraft('daemon-one', snapshot(), null)).toBe(false);
    expect(loadProjectDraft('daemon-one', null)).toBeNull();
    expect(saveProjectDraft('daemon-one', snapshot(), throwingStorage)).toBe(false);
    expect(loadProjectDraft('daemon-one', throwingStorage)).toBeNull();
    expect(() => clearProjectDraft('daemon-one', throwingStorage)).not.toThrow();
  });

  it('infers the runtime setup of drafts saved before setups existed', () => {
    const { setup: _setup, ...legacy } = projectDraft('daemon-one', snapshot());
    expect(draftSetup({ ...legacy })).toBe('manual');
    expect(draftSetup({ ...legacy, runtime: { ...legacy.runtime, python: ' ' } })).toBe('automatic');
    expect(draftSetup({ ...legacy, setup: 'automatic' })).toBe('automatic');
  });

  it('merges draft values over a fresh request without restoring environment values', () => {
    const request = freshRequest();
    const draft = projectDraft(
      'daemon-one',
      snapshot({
        ...request,
        backend: 'slurm',
        config: { ...request.config, epochs: 40, optimizer: 'sgd', momentum: 0.8 },
        runtime: { python: '/opt/py/bin/python', mode: 'selected', device: 'cuda', environment: {} },
        topology: { num_machines: 2, processes_per_machine: 4, machine_rank: 1 },
        storage_map: [{ host_root: '/srv/data', execution_root: '/mnt/data' }],
      }),
    );
    const fresh = {
      ...freshRequest(),
      runtime: { ...freshRequest().runtime, environment: { KEEP: 'fresh-value' } },
    };
    const merged = draftRequest(draft, fresh);
    expect(merged).toMatchObject({
      backend: 'slurm',
      operation: 'train',
      runtime: {
        python: '/opt/py/bin/python',
        mode: 'selected',
        device: 'cuda',
        environment: { KEEP: 'fresh-value' },
      },
      topology: { num_machines: 2, processes_per_machine: 4, machine_rank: 1 },
      storage_map: [{ host_root: '/srv/data', execution_root: '/mnt/data' }],
    });
    expect(merged.config).toEqual({
      ...trainingDefaults,
      epochs: 40,
      optimizer: 'sgd',
      momentum: 0.8,
    });
    expect(trainingRequestSchema.safeParse(merged).success).toBe(true);

    const partial = draftRequest(
      { ...draft, config: { epochs: 7 }, topology: {}, storage_map: [] },
      fresh,
    );
    expect(partial.config).toEqual({ ...trainingDefaults, epochs: 7 });
    expect(partial.topology).toEqual(fresh.topology);
    expect(partial.storage_map).toBeUndefined();
  });
});

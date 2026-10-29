import { describe, expect, it } from 'vitest';
import {
  mappedStoragePath,
  normalizedStoragePath,
  storageMapSchema,
} from '../../shared/schemas/storage-mapping';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';
import { resultRequestSchema } from '../../shared/schemas/result-request';

describe('explicit approved storage mapping', () => {
  it.each([
    [{ host_root: 'relative', execution_root: '/exec' }],
    [{ host_root: '/host', execution_root: 'https://site/exec' }],
    [{ host_root: '/host/../data', execution_root: '/exec' }],
    [{ host_root: '/host', execution_root: '/exec/../data' }],
    [{ host_root: '/host\0', execution_root: '/exec' }],
    [{ host_root: '/host', execution_root: '/exec\n' }],
    [{ host_root: '/host', execution_root: 'C:\\exec' }],
    [{ host_root: '/host', execution_root: '/exec', extra: true }],
    [
      { host_root: '/host', execution_root: '/exec' },
      { host_root: '/host/.', execution_root: '/other' },
    ],
    [
      { host_root: 'C:\\host', execution_root: 'D:\\exec' },
      { host_root: 'c:/HOST/', execution_root: 'E:/other' },
    ],
    Array.from({ length: 33 }, (_, index) => ({
      host_root: `/host/${index}`,
      execution_root: '/exec',
    })),
  ])('rejects unsafe, cross-platform, duplicate or unbounded roots %j', (value) => {
    expect(storageMapSchema.safeParse(value).success).toBe(false);
  });
  it('uses longest host prefix and permits nonbijective execution roots without inverse guessing', () => {
    const mappings = storageMapSchema.parse([
      { host_root: '/host', execution_root: '/exec' },
      { host_root: '/host/data', execution_root: '/exec/special' },
      { host_root: '/other', execution_root: '/exec' },
      { host_root: '/exec', execution_root: '/never-apply-twice' },
    ]);
    expect(mappedStoragePath('/host/data/train.npz', mappings)).toBe('/exec/special/train.npz');
    expect(mappedStoragePath('/host/venv/bin/python', mappings)).toBe('/exec/venv/bin/python');
    expect(mappedStoragePath('/hosted/train.npz', mappings)).toBe('/hosted/train.npz');
    expect(mappedStoragePath('/other/train.npz', mappings)).toBe('/exec/train.npz');
    expect(normalizedStoragePath('/host/venv/./bin/python')).toBe('/host/venv/bin/python');
  });
  it('compares Windows paths by normalized components and platform', () => {
    const mappings = storageMapSchema.parse([
      { host_root: 'C:\\Host', execution_root: 'D:\\Exec' },
    ]);
    expect(mappedStoragePath('c:/HOST/venv/bin/python.exe', mappings)).toBe(
      'd:/exec/venv/bin/python.exe',
    );
    expect(mappedStoragePath('C:/Hosted/python.exe', mappings)).toBe('c:/hosted/python.exe');
    expect(normalizedStoragePath('\\\\server\\share\\venv\\python.exe')).toBe(
      '//server/share/venv/python.exe',
    );
  });
  it('does not add storage_map to old request bodies and preserves explicit maps on result schemas', () => {
    const request = trainingRequestSchema.parse({
      backend: 'local',
      operation: 'train',
      config: { ...trainingDefaults, data_path: '/data/train.npz' },
      runtime: { python: '/venv/bin/python', mode: 'existing', device: 'cpu', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    });
    expect(Object.hasOwn(request, 'storage_map')).toBe(false);
    expect(resultRequestSchema.shape.storage_map.parse(undefined)).toBeUndefined();
    const map = [{ host_root: '/host', execution_root: '/exec' }];
    expect(resultRequestSchema.shape.storage_map.parse(map)).toEqual(map);
  });
});

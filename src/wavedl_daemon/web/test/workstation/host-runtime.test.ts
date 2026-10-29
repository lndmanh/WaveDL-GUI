import { describe, expect, it } from 'vitest';
import {
  automaticRuntime,
  gigabytes,
  hostAccelerator,
  matchesAutomatic,
  visibleDevices,
} from '../../app/lib/host-runtime';
import { hostProfileSchema, type HostProfile } from '../../shared/schemas/host-profile';
import { trainingDefaults, type TrainingRequest } from '../../shared/schemas/training-request';

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

function request(): TrainingRequest {
  return {
    backend: 'slurm',
    operation: 'train',
    config: structuredClone(trainingDefaults),
    runtime: { python: '', mode: 'selected', device: 'cuda', environment: { A: '1' } },
    topology: { num_machines: 2, processes_per_machine: 2, machine_rank: 0 },
    storage_map: [{ host_root: '/a', execution_root: '/b' }],
  };
}

describe('automatic runtime', () => {
  it('plans one Local auto-device process on the daemon interpreter', () => {
    const current = { ...request(), ...automaticRuntime(profile), storage_map: [] };
    expect(current.runtime).toEqual({
      python: '/opt/wavedl/bin/python',
      mode: 'existing',
      device: 'auto',
      environment: {},
    });
    expect(matchesAutomatic(current, profile)).toBe(true);
    expect(matchesAutomatic(request(), profile)).toBe(false);
    expect(matchesAutomatic({ ...current, storage_map: request().storage_map }, profile)).toBe(
      false,
    );
  });

  it('names the accelerator auto resolves to, and nothing without PyTorch', () => {
    expect(hostAccelerator(profile)).toBe('mps');
    const cuda = { torch: '2', cuda: [{ name: 'A100', memory_bytes: 1 }], mps: false };
    expect(hostAccelerator({ ...profile, accelerators: cuda })).toBe('cuda');
    expect(hostAccelerator({ ...profile, accelerators: { ...cuda, cuda: [] } })).toBe('cpu');
    expect(hostAccelerator({ ...profile, accelerators: { ...cuda, torch: null } })).toBe('unknown');
    expect(hostAccelerator({ ...profile, accelerators: null })).toBe('unknown');
  });

  it('formats memory and visible devices', () => {
    expect(gigabytes(25769803776)).toBe('24 GB');
    expect(gigabytes(8 * 1024 ** 3 + 1024 ** 3 / 2)).toBe('8.5 GB');
    expect(visibleDevices(3)).toBe('0,1,2');
    expect(visibleDevices(0)).toBe('0');
  });

  it('ignores additive profile fields and refuses malformed ones', () => {
    expect(hostProfileSchema.safeParse({ ...profile, future: true }).success).toBe(true);
    expect(hostProfileSchema.safeParse({ ...profile, python: '' }).success).toBe(false);
    expect(hostProfileSchema.safeParse({ ...profile, cpu_count: -1 }).success).toBe(false);
  });
});

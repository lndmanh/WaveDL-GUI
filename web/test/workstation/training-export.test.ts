import { describe, expect, it } from 'vitest';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';
import { quotePosix, trainingCommand, trainingYaml } from '../../workstation/lib/training-export';
const draft = trainingRequestSchema.parse({
  backend: 'local',
  operation: 'train',
  config: trainingDefaults,
  runtime: {
    python: '/opt/My Python/bin/python',
    mode: 'selected',
    device: 'cpu',
    environment: {},
  },
  topology: { num_machines: 1, processes_per_machine: 2, machine_rank: 0 },
});
describe('standalone training exports', () => {
  it('exports all config fields as unambiguous YAML scalars without runtime secrets', () => {
    const yaml = trainingYaml({
      ...draft,
      runtime: { ...draft.runtime, environment: { TOKEN: 'private-secret' } },
    });
    for (const [name, value] of Object.entries(draft.config))
      expect(yaml).toContain(`${name}: ${JSON.stringify(value)}\n`);
    expect(yaml).not.toContain('private-secret');
    expect(yaml).not.toContain('TOKEN');
  });
  it('quotes executable and metacharacter paths, maps imports and preserves explicit CPU topology/precision', () => {
    const command = trainingCommand({
      ...draft,
      config: {
        ...draft.config,
        data_path: "/data/a'b; $(touch nope).npz",
        import_modules: ['my_package.models'],
        precision: 'no',
        run_name: '--compile',
      },
    });
    expect(command).toContain(quotePosix(draft.runtime.python));
    expect(command).toContain(quotePosix("--data_path=/data/a'b; $(touch nope).npz"));
    expect(command).toContain("'--num_gpus' '2'");
    expect(command).toContain("'--cpu'");
    expect(command).toContain("'--mixed_precision' 'no'");
    expect(command).toContain("'--import' 'my_package.models'");
    expect(command).toContain("'--run_name=--compile'");
  });
  it('visibly rejects incomplete standalone environment/topology rather than dropping options', () => {
    expect(() =>
      trainingCommand({ ...draft, runtime: { ...draft.runtime, device: 'auto' } }),
    ).toThrow('explicit CPU or CUDA');
    expect(() =>
      trainingCommand({
        ...draft,
        runtime: { ...draft.runtime, environment: { TOKEN: 'secret' } },
      }),
    ).toThrow('not exported');
    expect(() =>
      trainingCommand({
        ...draft,
        topology: { num_machines: 2, processes_per_machine: 1, machine_rank: 0 },
      }),
    ).toThrow('rendezvous');
    expect(() =>
      trainingCommand({ ...draft, config: { ...draft.config, constraint: ['--wandb'] } }),
    ).toThrow('YAML');
  });
});

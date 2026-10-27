import options from '../../shared/training-options.json';
import { trainingRequestSchema, type TrainingRequest } from '../../shared/schemas/training-request';

/** JSON scalar syntax is also safe YAML syntax; no implicit YAML typing. */
export function trainingYaml(draft: TrainingRequest): string {
  const { config } = trainingRequestSchema.parse(draft);
  return (
    '# WaveDL training configuration. Runtime credentials and environment are omitted.\n' +
    Object.entries(config)
      .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
      .join('\n') +
    '\n'
  );
}
export function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
/** A standalone host command is not a daemon plan or a scheduler submission. */
export function trainingCommand(draft: TrainingRequest): string {
  const request = trainingRequestSchema.parse(draft);
  if (!request.runtime.python.startsWith('/'))
    throw new Error(
      'This exporter quotes POSIX shell commands only. Windows host commands require a Windows-specific exporter; use the YAML configuration.',
    );
  if (request.topology.num_machines !== 1 || request.topology.machine_rank !== 0)
    throw new Error(
      'Multi-node standalone commands require explicit rendezvous and are not exported by this editor.',
    );
  if (!['cpu', 'cuda'].includes(request.runtime.device))
    throw new Error('Choose explicit CPU or CUDA for a reproducible standalone command.');
  if (request.runtime.mode === 'container')
    throw new Error(
      'Container startup is operator-owned; a standalone host command cannot reproduce it.',
    );
  if (Object.keys(request.runtime.environment).length)
    throw new Error(
      'Explicit environment values are not exported because they may contain secrets. Configure them safely on the host, or clear them before exporting a command.',
    );
  const argv = [
    request.runtime.python,
    '-m',
    'wavedl.launcher',
    '--num_gpus',
    String(request.topology.processes_per_machine),
    '--mixed_precision',
    request.config.precision,
  ];
  if (request.runtime.device === 'cpu') argv.push('--cpu');
  for (const option of options) {
    const entry = Object.entries(request.config).find(([name]) => name === option.name);
    if (!entry) throw new Error('Incomplete training schema.');
    const value = entry[1];
    if (value === null || value === false || (Array.isArray(value) && !value.length)) continue;
    const flag = option.name === 'import_modules' ? '--import' : `--${option.name}`;
    if (value === true) argv.push(flag);
    else if (Array.isArray(value)) {
      if (value.some((item) => typeof item === 'string' && item.startsWith('-')))
        throw new Error(
          'Standalone CLI list entries cannot start with an option prefix; use the YAML export.',
        );
      argv.push(flag, ...value.map(String));
    } else argv.push(`${flag}=${value}`);
  }
  argv.push('--output_dir', './results');
  return argv.map(quotePosix).join(' ');
}

import type { StorageMapping } from '../../shared/schemas/storage-mapping';

/** Stored plans use execution paths; catalogue selections use daemon-host paths. */
export function hostPath(value: string, mappings: readonly StorageMapping[] | undefined): {
  path: string;
  ambiguous: boolean;
} {
  const candidates = (mappings ?? []).flatMap(({ execution_root, host_root }) => {
    const root = execution_root.replace(/[\\/]+$/, '');

    if (value !== root && !value.startsWith(`${root}/`) && !value.startsWith(`${root}\\`)) return [];

    return [host_root.replace(/[\\/]+$/, '') + value.slice(root.length)];
  });
  const paths = [...new Set(candidates)];

  return { path: paths.length === 1 ? paths[0] ?? value : value, ambiguous: paths.length > 1 };
}

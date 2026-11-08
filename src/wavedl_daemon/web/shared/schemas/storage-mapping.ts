import { clientError } from '../../app/i18n/client-messages';
import { z } from 'zod';

/** Lexical only: browsers cannot resolve host symlinks or invent inverse maps. */
function pathParts(
  value: string,
): { platform: 'posix' | 'windows'; root: string; parts: string[] } | null {
  if (
    !value ||
    value.length > 8192 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return null;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
    const parts = value.slice(1).split('/').filter(Boolean);
    if (parts.some((part) => part === '..')) return null;
    return { platform: 'posix', root: '/', parts: parts.filter((part) => part !== '.') };
  }
  const normalized = value.replaceAll('\\', '/');
  const drive = normalized.match(/^([A-Za-z]:)\//);
  const unc = value.startsWith('\\\\') ? normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/|$)/) : null;
  if (unc && [unc[1], unc[2]].some((part) => part === '.' || part === '..')) return null;
  const root = drive ? `${drive[1]}/` : unc ? `//${unc[1]}/${unc[2]}/` : null;
  if (!root || /[<>:"|?*]/.test(normalized.slice(drive ? 2 : 0))) return null;
  const parts = normalized.slice(root.length).split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) return null;
  return { platform: 'windows', root, parts: parts.filter((part) => part !== '.') };
}
export function normalizedStoragePath(value: string): string {
  const path = pathParts(value);
  if (!path) throw clientError('unsafeStoragePath', {});
  const result = path.root + path.parts.join('/');
  return path.platform === 'windows' ? result.toLowerCase() : result;
}
const rootSchema = z
  .string()
  .max(8192)
  .refine((value) => pathParts(value) !== null, {
    params: { clientMessageKey: 'unsafeStorageRoot' },
  });
export const storageMappingSchema = z
  .strictObject({
    host_root: rootSchema,
    execution_root: rootSchema,
  })
  .refine(
    (mapping) =>
      pathParts(mapping.host_root)?.platform === pathParts(mapping.execution_root)?.platform,
    { params: { clientMessageKey: 'storagePlatformMismatch' } },
  );
export const storageMapSchema = z
  .array(storageMappingSchema)
  .max(32)
  .refine(
    (mappings) =>
      mappings.every((mapping) => pathParts(mapping.host_root) !== null) &&
      new Set(mappings.map((mapping) => normalizedStoragePath(mapping.host_root))).size ===
        mappings.length,
    { params: { clientMessageKey: 'storageHostRootsMustBeUnique' } },
  );
export type StorageMapping = z.infer<typeof storageMappingSchema>;

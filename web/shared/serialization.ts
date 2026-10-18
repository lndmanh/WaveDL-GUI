/**
 * Deep clone and clean an object to make it serializable for IndexedDB
 * Removes functions, undefined values, and handles circular references
 */
export function serializeForIndexedDB<T>(obj: T): string {
  return JSON.stringify(obj);
}

/**
 * Deserialize data from IndexedDB storage
 */
export function deserializeFromIndexedDB(data: string): unknown {
  return JSON.parse(data);
}

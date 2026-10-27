import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function boundedFile(path, cap = 2 * 1024 * 1024, allowEmpty = false) {
  // Reject ancestor symlinks too; /private is the canonical macOS temporary root.
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const stat = await lstat(parent);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "Evidence parent must be an ordinary directory",
    );
  }
  const before = await lstat(path);
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.size >= (allowEmpty ? 0 : 1) &&
      before.size <= cap,
    "Evidence must be a bounded nonempty regular file",
  );
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(
      stat.isFile() &&
        stat.dev === before.dev &&
        stat.ino === before.ino &&
        stat.size >= (allowEmpty ? 0 : 1) &&
        stat.size <= cap,
      "Evidence changed during open",
    );
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    assert(length === stat.size && length <= cap, "Evidence size changed during read");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

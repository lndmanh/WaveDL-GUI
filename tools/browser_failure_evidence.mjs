// Diagnostic retention only: these prefixes never establish PNG acceptance.
// Caller must supply its isolated, owned download directory, after stopping
// browser writes and before cleaning that directory. Never use a user Downloads.
import { constants } from "node:fs";
import { lstat, realpath, open, opendir, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const LIMITS = Object.freeze({
  entries: 128,
  basenameBytes: 256,
  files: 16,
  prefixBytes: 4096,
  totalBytes: 65536,
});

function requireCondition(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function scopedPath(path) {
  requireCondition(
    typeof path === "string" && isAbsolute(path) && resolve(path) === path && !path.includes("\0"),
    "EVIDENCE_PATH",
  );
  // Broad filesystem/home/workspace roots and their ancestors are never targets.
  requireCondition(
    ![homedir(), process.cwd()].some(
      (root) => root === path || root.startsWith(path.endsWith(sep) ? path : path + sep),
    ),
    "EVIDENCE_BROAD_ROOT",
  );
}

async function ordinaryDirectory(path) {
  requireCondition((await realpath(path)) === path, "EVIDENCE_NONCANONICAL");
  let component = path;
  while (true) {
    const info = await lstat(component);
    requireCondition(info.isDirectory() && !info.isSymbolicLink(), "EVIDENCE_DIRECTORY");
    const parent = dirname(component);
    if (parent === component) break;
    component = parent;
  }
  const info = await lstat(path);
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    requireCondition(
      opened.isDirectory() && opened.dev === info.dev && opened.ino === info.ino,
      "EVIDENCE_DIRECTORY_CHANGED",
    );
    return opened;
  } finally {
    await handle.close();
  }
}

async function sameDirectory(path, original) {
  const current = await ordinaryDirectory(path);
  requireCondition(
    current.dev === original.dev && current.ino === original.ino,
    "EVIDENCE_DIRECTORY_CHANGED",
  );
}

/** Retain only bounded prefixes, with neutral private filenames and byte-free metadata.
 * Failure leaves any newly created partial evidence in place; error.evidence names
 * it. This helper never deletes either source files or retained evidence.
 */
export async function retainFailurePrefixes({ downloads, destination, expected = [] }) {
  const report = {
    destination: null,
    status: "failed",
    limits: { ...LIMITS },
    files: [],
    totalPrefixBytes: 0,
  };
  try {
    scopedPath(downloads);
    scopedPath(destination);
    scopedPath(dirname(destination));
    requireCondition(
      destination !== downloads &&
        !destination.startsWith(downloads + sep) &&
        !downloads.startsWith(destination + sep),
      "EVIDENCE_OVERLAP",
    );
    requireCondition(
      Array.isArray(expected) &&
        expected.length <= LIMITS.entries &&
        expected.every(
          (name) =>
            typeof name === "string" &&
            name !== "." &&
            name !== ".." &&
            basename(name) === name &&
            !name.includes("\0") &&
            Buffer.byteLength(name) <= LIMITS.basenameBytes,
        ),
      "EVIDENCE_EXPECTED",
    );
    const sourceDirectory = await ordinaryDirectory(downloads);
    const destinationParent = await ordinaryDirectory(dirname(destination));
    const names = [];
    // Iteration, rather than readdir(), also bounds the in-memory directory list.
    const directory = await opendir(downloads);
    for await (const entry of directory) {
      requireCondition(
        names.length < LIMITS.entries && Buffer.byteLength(entry.name) <= LIMITS.basenameBytes,
        "EVIDENCE_ENTRY_BOUND",
      );
      names.push(entry.name);
    }
    names.sort();
    const candidates = [];
    for (const name of names) {
      const info = await lstat(join(downloads, name));
      // No recursive traversal, special files, or even hard-linked files.
      requireCondition(
        info.isFile() && !info.isSymbolicLink() && info.nlink === 1,
        "EVIDENCE_SOURCE_TYPE",
      );
      if (!expected.includes(name)) candidates.push({ name, info });
    }
    requireCondition(candidates.length <= LIMITS.files, "EVIDENCE_FILE_BOUND");
    await sameDirectory(downloads, sourceDirectory);
    await sameDirectory(dirname(destination), destinationParent);
    // Nonrecursive mkdir refuses an existing destination, including a symlink.
    await mkdir(destination, { mode: 0o700 });
    report.destination = destination;
    const evidenceDirectory = await ordinaryDirectory(destination);
    const directoryHandle = await open(
      destination,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directoryHandle.chmod(0o700);
    } finally {
      await directoryHandle.close();
    }
    for (const [index, candidate] of candidates.entries()) {
      await sameDirectory(downloads, sourceDirectory);
      const path = join(downloads, candidate.name);
      const info = await lstat(path);
      requireCondition(
        info.isFile() &&
          !info.isSymbolicLink() &&
          info.nlink === 1 &&
          info.dev === candidate.info.dev &&
          info.ino === candidate.info.ino,
        "EVIDENCE_SOURCE_CHANGED",
      );
      const source = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let prefix, observedSize;
      try {
        const opened = await source.stat();
        requireCondition(
          opened.isFile() &&
            opened.nlink === 1 &&
            opened.dev === info.dev &&
            opened.ino === info.ino &&
            Number.isSafeInteger(opened.size) &&
            opened.size >= 0,
          "EVIDENCE_SOURCE_CHANGED",
        );
        observedSize = opened.size;
        const stable = await source.stat({ bigint: true });
        requireCondition(stable.size === BigInt(opened.size), "EVIDENCE_SOURCE_CHANGED");
        const buffer = Buffer.alloc(LIMITS.prefixBytes);
        const wanted = Math.min(opened.size, LIMITS.prefixBytes);
        let offset = 0;
        while (offset < wanted) {
          const { bytesRead } = await source.read(buffer, offset, wanted - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        prefix = buffer.subarray(0, offset);
        const finished = await source.stat({ bigint: true });
        requireCondition(
          finished.isFile() &&
            finished.dev === stable.dev &&
            finished.ino === stable.ino &&
            finished.nlink === 1n &&
            finished.size === stable.size &&
            finished.mtimeNs === stable.mtimeNs &&
            finished.ctimeNs === stable.ctimeNs &&
            prefix.length === Math.min(opened.size, LIMITS.prefixBytes),
          "EVIDENCE_SOURCE_CHANGED",
        );
        const current = await lstat(path, { bigint: true });
        requireCondition(
          current.isFile() &&
            current.dev === stable.dev &&
            current.ino === stable.ino &&
            current.nlink === 1n &&
            current.size === stable.size &&
            current.mtimeNs === stable.mtimeNs &&
            current.ctimeNs === stable.ctimeNs,
          "EVIDENCE_SOURCE_CHANGED",
        );
      } finally {
        await source.close();
      }
      requireCondition(
        report.totalPrefixBytes + prefix.length <= LIMITS.totalBytes,
        "EVIDENCE_BYTE_BOUND",
      );
      await sameDirectory(destination, evidenceDirectory);
      const destinationPath = join(destination, `${String(index).padStart(3, "0")}.bin`);
      const output = await open(
        destinationPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      const metadata = {
        sourceIndex: index,
        observedSize,
        prefixLength: prefix.length,
        prefixSha256: createHash("sha256").update(prefix).digest("hex"),
        destinationPath: `${String(index).padStart(3, "0")}.bin`,
      };
      // Register before writing so even a failed write identifies the partial file.
      report.files.push(metadata);
      report.totalPrefixBytes += prefix.length;
      try {
        await output.chmod(0o600);
        await output.writeFile(prefix);
      } finally {
        await output.close();
      }
    }
    report.status = "retained";
    return report;
  } catch (error) {
    // Do not include filesystem exception messages (which may echo source names).
    const code =
      typeof error.code === "string" && /^[A-Z_0-9]{1,64}$/.test(error.code)
        ? error.code
        : "EVIDENCE_FAILED";
    throw Object.assign(new Error(`Failure-prefix retention refused (${code})`), {
      code,
      evidence: report,
    });
  }
}

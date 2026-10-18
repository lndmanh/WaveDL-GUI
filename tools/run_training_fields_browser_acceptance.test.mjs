import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportDestination, ownedEvidencePath } from "./run_training_fields_browser_acceptance.mjs";

test("report destination permits only owned empty ordinary directories", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "wavedl-fields-guard-"));
  try {
    const good = join(root, "good");
    assert.equal(await reportDestination(good), good);
    await writeFile(join(good, "user-data"), "preserve");
    await assert.rejects(reportDestination(good), /empty/);
    assert.equal(await readFile(join(good, "user-data"), "utf8"), "preserve");
    const regular = join(root, "regular");
    await writeFile(regular, "preserve");
    await assert.rejects(reportDestination(regular));
    const link = join(root, "link");
    await symlink(good, link);
    await assert.rejects(reportDestination(link));
    await assert.rejects(reportDestination(join(link, "child")), /symlinks/);
    await assert.rejects(reportDestination());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("runner refuses escaped source evidence including symlink aliases", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "wavedl-fields-source-"));
  try {
    const owned = join(root, "owned");
    const foreign = join(root, "foreign");
    await mkdir(owned);
    await mkdir(foreign);
    const good = join(owned, "report.json");
    const bad = join(foreign, "report.json");
    await writeFile(good, "{}");
    await writeFile(bad, "{}");
    assert.equal(await ownedEvidencePath(owned, good), good);
    await assert.rejects(ownedEvidencePath(owned, bad));
    await assert.rejects(ownedEvidencePath(owned, owned));
    const link = join(owned, "link.json");
    await symlink(bad, link);
    await assert.rejects(ownedEvidencePath(owned, link));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

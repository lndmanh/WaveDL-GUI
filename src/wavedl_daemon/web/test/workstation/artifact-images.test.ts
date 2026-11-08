import { describe, expect, it, vi } from 'vitest';
import { ArtifactImageCache } from '../../app/lib/artifact-images';
import type { ArtifactImageResource } from '../../app/lib/artifact-images';
import { pngPreviewImage } from '../../app/lib/artifact-client';
import type { Artifact } from '../../types/artifact-client';

function artifact(path: string, modified = '2026-11-03T10:00:00Z'): Artifact {
  return { runId: '22222222-2222-4222-8222-222222222222', path, size: 33, modified };
}

function setup() {
  const loads: Array<{
    artifact: Artifact;
    signal: AbortSignal;
    resolve(value: ArtifactImageResource): void;
    reject(reason: Error): void;
  }> = [];

  const release = vi.fn();
  const changed = vi.fn();

  const cache = new ArtifactImageCache(
    (selected, signal) =>
      new Promise((resolve, reject) => {
        loads.push({ artifact: selected, signal, resolve, reject });
      }),
    release,
    changed,
  );

  function finish(index: number) {
    const load = loads[index];

    if (!load) throw new Error('Missing image load');
    load.resolve({ url: `blob:${index}`, width: 10, height: 20 });
  }

  return { cache, loads, release, changed, finish };
}

describe('artifact image queue and scoped cache', () => {
  it('runs two FIFO reads, deduplicates requests and retains the original artifact', async () => {
    const { cache, loads, finish } = setup();
    const first = artifact('first.png');
    const second = artifact('second.png');
    const third = artifact('third.png');
    const one = cache.request(first);
    const two = cache.request(second);
    const three = cache.request(third);
    expect(cache.request(first)).toBe(one);
    expect(loads.map((load) => load.artifact)).toEqual([first, second]);
    expect(loads[0]?.artifact).toBe(first);
    expect(cache.state(third).status).toBe('loading');
    finish(0);
    await one;
    expect(loads[2]?.artifact).toBe(third);
    finish(1);
    finish(2);
    await Promise.all([two, three]);
    expect(cache.state(first)).toEqual({ status: 'ready', url: 'blob:0', width: 10, height: 20 });
    await cache.request(first);
    expect(loads).toHaveLength(3);
  });

  it('promotes a queued lightbox request ahead of FIFO thumbnails without duplicating it', async () => {
    const { cache, loads, finish } = setup();
    const one = cache.request(artifact('first.png'));
    cache.request(artifact('second.png'));
    const third = artifact('third.png');
    const fourth = artifact('fourth.png');
    cache.request(third);
    const queued = cache.request(fourth);
    expect(cache.request(fourth, { priority: true })).toBe(queued);
    finish(0);
    await one;
    expect(loads[2]?.artifact).toBe(fourth);
    finish(2);
    await queued;
    expect(loads[3]?.artifact).toBe(third);
    cache.reset();
  });

  it('keys by run, path, size and modified time, and retries only when requested', async () => {
    const { cache, loads, finish } = setup();
    const first = artifact('plot.png');
    const pending = cache.request(first);
    const load = loads[0];

    if (!load) throw new Error('Missing image load');
    load.reject(new Error('Interrupted'));
    expect(await pending).toEqual({ status: 'error' });
    await cache.request(first);
    expect(loads).toHaveLength(1);
    const retry = cache.request(first, { retry: true });
    finish(1);
    await retry;
    const updated = cache.request(artifact('plot.png', '2026-11-03T11:00:00Z'));
    const resized = cache.request({ ...first, size: 34 });
    expect(loads).toHaveLength(4);
    finish(2);
    finish(3);
    await Promise.all([updated, resized]);
    cache.request({ ...first, runId: '33333333-3333-4333-8333-333333333333' });
    expect(loads).toHaveLength(5);
    cache.reset();
  });

  it('aborts active reads, settles queued callers, revokes URLs and discards late results', async () => {
    const { cache, loads, release, finish } = setup();
    const first = artifact('first.png');
    const ready = cache.request(first);
    finish(0);
    await ready;
    const active = cache.request(artifact('active.png'));
    const other = cache.request(artifact('other.png'));
    const queued = cache.request(artifact('queued.png'));
    cache.reset();
    expect(await Promise.all([active, other, queued])).toEqual([null, null, null]);
    expect(loads.every((load) => load.signal.aborted)).toBe(true);
    expect(release).toHaveBeenCalledWith('blob:0');
    expect(cache.state(first).status).toBe('idle');
    const fresh = cache.request(first);
    finish(1);
    await Promise.resolve();
    expect(release).toHaveBeenCalledWith('blob:1');
    expect(cache.state(first).status).toBe('loading');
    finish(3);
    await fresh;
    expect(cache.state(first).url).toBe('blob:3');
    cache.reset();
    expect(release).toHaveBeenCalledWith('blob:3');
  });
});

it('extracts bounded PNG dimensions while retaining the existing PNG preview validation', async () => {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 640);
  view.setUint32(20, 480);
  const image = await pngPreviewImage(new Blob([bytes]));
  expect(image.width).toBe(640);
  expect(image.height).toBe(480);
  expect(image.blob.type).toBe('image/png');
  view.setUint32(16, 8192);
  view.setUint32(20, 8192);
  await expect(pngPreviewImage(new Blob([bytes]))).rejects.toThrow('too large to preview');
  await expect(pngPreviewImage(new Blob(['<svg/>']))).rejects.toThrow('PNG');
});

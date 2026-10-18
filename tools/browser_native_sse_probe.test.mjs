import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { nativeSseProbeScript, nativeSplitWitness } from './browser_native_sse_probe.mjs';

function environment() {
  const nativeError = new Error('native locked reader');
  class Reader {
    constructor(results) { this.results = results; }
    read() {
      if (!(this instanceof Reader)) return Promise.reject(nativeError);
      if (this.released) return Promise.reject(nativeError);
      return Promise.resolve(this.results.shift());
    }
    cancel(reason) {
      if (!(this instanceof Reader) || this.released || this.cancelFails) return Promise.reject(nativeError);
      this.cancelReason = reason;
      return Promise.resolve(this.cancelResult);
    }
    releaseLock() { this.released = true; }
  }
  const release = Reader.prototype.releaseLock;
  const context = createContext({ window: {}, ReadableStreamDefaultReader: Reader, Uint8Array, TextDecoder, crypto: webcrypto });
  runInContext(nativeSseProbeScript, context);
  return { Reader, probe: context.window.__wavedlSseProbe, release, nativeError };
}
test('returns original native result/value, records bytes and preserves releaseLock', async () => {
  const { Reader, probe, release, nativeError } = environment();
  const value = new Uint8Array([195]);
  const result = { done: false, value };
  const reader = new Reader([result, { done: false, value: new Uint8Array([179,13]) }, { done: false, value: new Uint8Array([10]) }]);
  assert.strictEqual(await reader.read(), result);
  assert.strictEqual(result.value, value);
  await reader.read(); await reader.read();
  const snapshot = await probe.snapshot();
  assert.equal(snapshot.streams[0].bytes, 4);
  assert.deepEqual(Array.from(snapshot.chunks.map(chunk => [chunk.offset,chunk.length,chunk.first,chunk.last]).flat()), [0,1,195,195,1,2,179,13,3,1,10,null]);
  assert.strictEqual(Reader.prototype.releaseLock, release);
  reader.releaseLock();
  await assert.rejects(reader.read(), error => error === nativeError);
  await assert.rejects(Reader.prototype.read.call({}), error => error === nativeError);
});
test('does not serialize raw bodies, headers, credentials or URLs', async () => {
  const { Reader, probe } = environment();
  const raw = 'Bearer private-token http://private/path';
  const value = new TextEncoder().encode(raw);
  await new Reader([{done:false,value}]).read();
  const serialized = JSON.stringify(await probe.snapshot());
  assert(!serialized.includes(raw) && !serialized.includes('private-token') && !serialized.includes('http://'));
});

test('derives actual splits within the selected stream despite unrelated interleaved readers', () => {
  const probe = { chunks: [
    { stream: 5, last: 195, sseLike: true },
    { stream: 6, first: null, last: null },
    { stream: 5, first: 179, last: 13, sseLike: false },
    { stream: 7, first: null, last: null },
    { stream: 5, first: 10, last: null, sseLike: true },
  ] };
  assert.deepEqual(nativeSplitWitness(probe, 5), { utf8: true, crlf: true });
  assert.deepEqual(nativeSplitWitness(probe, 6), { utf8: false, crlf: false });
});

test('records only successful native cancellation without altering receiver/result/rejection or persisting reason', async () => {
  const { Reader, probe, nativeError } = environment();
  const reader = new Reader([{done:false,value:new Uint8Array([195])}]);
  await reader.read();
  reader.cancelFails = true;
  await assert.rejects(reader.cancel('private-secret-reason'), error => error === nativeError);
  assert.equal((await probe.snapshot()).streams[0].canceled, false);
  reader.cancelFails = false;
  const nativeResult = {};
  reader.cancelResult = nativeResult;
  assert.strictEqual(await reader.cancel('private-secret-reason'), nativeResult);
  assert.equal(reader.cancelReason, 'private-secret-reason');
  const snapshot = await probe.snapshot();
  assert.equal(snapshot.streams[0].done, false);
  assert.equal(snapshot.streams[0].canceled, true);
  assert(!JSON.stringify(snapshot).includes('private-secret-reason'));
  await assert.rejects(Reader.prototype.cancel.call({}), error => error === nativeError);
});

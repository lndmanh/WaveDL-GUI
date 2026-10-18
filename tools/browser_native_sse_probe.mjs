// Scoped QA observer: native reader results are returned unchanged.
export function installNativeSseProbe() {
  if (Object.hasOwn(window, '__wavedlSseProbe')) throw new Error('Probe already installed');
  const nativeRead = ReadableStreamDefaultReader.prototype.read;
  const nativeCancel = ReadableStreamDefaultReader.prototype.cancel;
  const readers = new WeakMap();
  const streams = [];
  const chunks = [];
  const pending = [];
  const captured = [];
  const digest = bytes => crypto.subtle.digest('SHA-256', bytes).then(value =>
    Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join(''));
  const probe = {
    scope: 'instrumented-native-sse-read-results',
    snapshot: async (requestedRanges = []) => {
      const frozenStreams = streams.map(stream => ({ ...stream }));
      const frozenParts = captured.map(parts => [...parts]);
      const frozenChunks = [...chunks];
      await Promise.all([...pending]);
      const buffers = [];
      const summaries = await Promise.all(frozenStreams.map(async stream => {
        const bytes = new Uint8Array(stream.bytes);
        let offset = 0;
        for (const part of frozenParts[stream.index]) {
          bytes.set(part, offset);
          offset += part.length;
        }
        buffers[stream.index] = bytes;
        return { ...stream, sha256: await digest(bytes) };
      }));
      if (!Array.isArray(requestedRanges) || requestedRanges.length > 4) throw new Error('Probe range budget');
      const ranges = await Promise.all(requestedRanges.map(async range => {
        const buffer = buffers[range.stream];
        if (!buffer || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end > buffer.length) throw new Error('Probe range bounds');
        return { ...range, sha256: await digest(buffer.slice(range.start, range.end)) };
      }));
      return { scope: probe.scope, streams: summaries, chunks: frozenChunks.map(chunk => ({ ...chunk })), ranges };
    },
  };
  const wrappedRead = function(...args) {
    const reader = this;
    // Invoke native first: invalid/released receiver exceptions and rejections
    // propagate without registering a replacement reader or touching its lock.
    return Reflect.apply(nativeRead, reader, args).then(result => {
      let stream = readers.get(reader);
      if (!stream) {
        if (streams.length >= 16) throw new Error('SSE probe stream budget');
        stream = { index: streams.length, bytes: 0, reads: 0, done: false, canceled: false };
        readers.set(reader, stream);
        streams.push(stream);
        captured.push([]);
      }
      if (result.done) stream.done = true;
      if (result.value) {
        const value = result.value;
        if (!(value instanceof Uint8Array) || chunks.length >= 4096 ||
            stream.bytes + value.byteLength > 8388608) throw new Error('SSE probe byte budget');
        const text = new TextDecoder().decode(value);
        const chunk = {
          stream: stream.index,
          index: stream.reads++,
          offset: stream.bytes,
          length: value.byteLength,
          sha256: null,
          sseLike: text.includes('id: ') || text.includes('event: ') || text.includes('QA native split'),
          // Do not persist arbitrary ASCII/diagnostic bytes, URLs or headers.
          first: value[0] === 0x0a || value[0] >= 0x80 ? value[0] : null,
          last: value.at(-1) === 0x0d || value.at(-1) >= 0x80 ? value.at(-1) : null,
        };
        stream.bytes += value.byteLength;
        captured[stream.index].push(value.slice());
        chunks.push(chunk);
        pending.push(digest(value).then(hash => { chunk.sha256 = hash; }));
      }
      return result;
    });
  };
  Object.defineProperty(ReadableStreamDefaultReader.prototype, 'read', {
    configurable: true,
    value: wrappedRead,
  });
  Object.defineProperty(ReadableStreamDefaultReader.prototype, 'cancel', {
    configurable: true,
    value: function(...args) {
      const reader = this;
      return Reflect.apply(nativeCancel, reader, args).then(result => {
        const stream = readers.get(reader);
        if (stream) stream.canceled = true;
        return result;
      });
    },
  });
  Object.defineProperty(window, '__wavedlSseProbe', { configurable: true, value: probe });
}
export const nativeSseProbeScript = `(${installNativeSseProbe.toString()})()`;

export function nativeSplitWitness(probe, stream) {
  const chunks = probe.chunks.filter(chunk => chunk.stream === stream);
  const adjacent = chunks.slice(0, -1).map((chunk, index) => [chunk, chunks[index + 1]]);
  return {
    utf8: adjacent.some(([left, right]) =>
      [0xc2, 0xc3, 0xe2, 0xe3, 0xe4, 0xf0, 0xf1, 0xf2, 0xf3, 0xf4].includes(left.last)
      && right.first >= 0x80 && right.first <= 0xbf),
    crlf: adjacent.some(([left, right]) => left.last === 0x0d && right.first === 0x0a),
  };
}

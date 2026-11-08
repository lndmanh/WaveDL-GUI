import { describe, expect, it, vi } from 'vitest';
import { EventStreamParser, INITIAL_CURSOR, validCursor } from '../../app/lib/event-stream';
import { runEventSchema } from '../../shared/schemas/event-stream';
import type { FixtureEventOverrides } from './fixture-schemas';
import type { RunEvent, Cursor } from '../../types/event-stream';

const run = '11111111-1111-1111-1111-111111111111';
const encoder = new TextEncoder();

function event(attempt = 1, seq = 0, overrides: FixtureEventOverrides = {}) {
  return {
    protocol: 'wavedl-run',
    version: 2,
    run_id: run,
    attempt,
    seq,
    type: 'warning',
    ts: '2026-10-05T00:00:00Z',
    payload: { code: 'metrics_malformed_line', message: 'wave 🌊' },
    ...overrides,
  };
}

function frame(attempt = 1, seq = 0, overrides: FixtureEventOverrides = {}) {
  return `id: ${attempt}:${seq}\ndata: ${JSON.stringify(event(attempt, seq, overrides))}\n\n`;
}

describe('attempt aware fetch stream', () => {
  it('shares sparse ordering and deduplication between JSON ingress and SSE decoding', async () => {
    const received: RunEvent[] = [];

    const parser = new EventStreamParser(run, INITIAL_CURSOR, (value) => {
      received.push(value);
    });

    await parser.accept(runEventSchema.parse(event(1, 3)));
    await parser.push(encoder.encode(frame(1, 3) + frame(1, 19)));
    await parser.accept(runEventSchema.parse(event(1, 4)));
    await parser.accept(runEventSchema.parse(event(4, 3)));
    await parser.push(encoder.encode(frame(2, 99)));
    expect(received.map((value) => [value.attempt, value.seq])).toEqual([
      [1, 3],
      [1, 19],
      [4, 3],
    ]);
    expect(parser.cursor).toEqual({ attempt: 4, seq: 3 });
  });
  it.each(['failed commit', 'revoked commit', 'already aborted'])(
    'does not advance JSON ingress after %s',
    async (outcome) => {
      const abort = new AbortController();
      const advance = vi.fn();

      const commit = vi.fn(async () => {
        if (outcome === 'failed commit') throw new Error('commit failed');
        await Promise.resolve();
        abort.abort();
      });

      const parser = new EventStreamParser(
        run,
        INITIAL_CURSOR,
        commit,
        advance,
        undefined,
        abort.signal,
      );

      if (outcome === 'already aborted') abort.abort();
      await expect(parser.accept(runEventSchema.parse(event()))).rejects.toThrow();
      expect(advance).not.toHaveBeenCalled();
      expect(parser.cursor).toEqual(INITIAL_CURSOR);

      if (outcome === 'already aborted') expect(commit).not.toHaveBeenCalled();
    },
  );
  it.each([
    { run_id: '22222222-2222-2222-2222-222222222222' },
    { ts: '2026-02-30T00:00:00Z' },
    { payload: { message: '🌊'.repeat(270000) } },
  ])('retains JSON ingress ownership, timestamp and byte bounds', async (patch) => {
    const parser = new EventStreamParser(run, INITIAL_CURSOR, () => undefined);
    await expect(parser.accept(runEventSchema.parse(event(1, 0, patch)))).rejects.toMatchObject({
      code: 'protocol',
    });
    expect(parser.cursor).toEqual(INITIAL_CURSOR);
  });
  it('decodes additive cursor fields without weakening the zero-attempt sentinel', () => {
    expect(validCursor({ attempt: 0, seq: -1, extra: true })).toBe(true);
    expect(validCursor({ attempt: 1, seq: -1 })).toBe(true);
    expect(validCursor({ attempt: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER })).toBe(
      true,
    );

    for (const value of [
      { attempt: 0, seq: 0 },
      { attempt: 1, seq: null },
      { attempt: 1.5, seq: 0 },
      { attempt: 1, seq: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(validCursor(value)).toBe(false);
    }
  });

  it('does not advance a callback revoked while its commit was pending', async () => {
    const abort = new AbortController();
    const saved: Cursor[] = [];

    const parser = new EventStreamParser(
      run,
      INITIAL_CURSOR,
      async () => {
        await Promise.resolve();
        abort.abort();
      },
      (cursor) => {
        saved.push(cursor);
      },
      undefined,
      abort.signal,
    );

    await expect(parser.push(encoder.encode(frame()))).rejects.toThrow();
    expect(saved).toEqual([]);
    expect(parser.cursor).toEqual(INITIAL_CURSOR);
  });
  it('rejects duplicate JSON ownership', async () => {
    const parser = new EventStreamParser(run, INITIAL_CURSOR, () => undefined);
    const text = frame().replace('"attempt":1', '"attempt":2,"attempt":1');
    await expect(parser.push(encoder.encode(text))).rejects.toMatchObject({ code: 'protocol' });
  });
  it('decodes every UTF-8/newline split, including CRLF', async () => {
    const bytes = encoder.encode(frame().replaceAll('\n', '\r\n'));

    for (let split = 0; split <= bytes.length; split++) {
      const received: RunEvent[] = [];

      const parser = new EventStreamParser(run, INITIAL_CURSOR, (value) => {
        received.push(value);
      });

      await parser.push(bytes.slice(0, split));
      await parser.push(bytes.slice(split));
      await parser.finish();
      expect(received).toHaveLength(1);
      expect(received[0]?.payload.message).toBe('wave 🌊');
      expect(parser.cursor).toEqual({ attempt: 1, seq: 0 });
    }
  });
  it('deduplicates replay and accepts requeue seq zero', async () => {
    const received: RunEvent[] = [];

    const parser = new EventStreamParser(run, INITIAL_CURSOR, (value) => {
      received.push(value);
    });

    await parser.push(encoder.encode(frame() + frame() + frame(1, 1) + frame(2, 0) + frame(1, 1)));
    expect(received.map((value) => [value.attempt, value.seq])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
    expect(parser.cursor).toEqual({ attempt: 2, seq: 0 });
  });
  it.each(['SSE', 'JSON'])('commits %s callbacks before cursor advance', async (source) => {
    const order: string[] = [];

    const parser = new EventStreamParser(
      run,
      INITIAL_CURSOR,
      async () => {
        order.push('commit');
      },
      () => {
        order.push('cursor');
      },
    );

    if (source === 'SSE') await parser.push(encoder.encode(frame()));
    else await parser.accept(runEventSchema.parse(event()));
    expect(order).toEqual(['commit', 'cursor']);

    const rejected = new EventStreamParser(run, INITIAL_CURSOR, () => {
      throw new Error('cannot commit');
    });

    await expect(
      source === 'SSE'
        ? rejected.push(encoder.encode(frame()))
        : rejected.accept(runEventSchema.parse(event())),
    ).rejects.toThrow('cannot commit');
    expect(rejected.cursor).toEqual(INITIAL_CURSOR);
  });
  it('controls and comments never advance the cursor', async () => {
    const controls: string[] = [];

    const parser = new EventStreamParser(
      run,
      { attempt: 1, seq: 4 },
      () => {
        throw new Error('not runtime');
      },
      undefined,
      (value) => {
        controls.push(value.type);
      },
    );

    await parser.push(
      encoder.encode(
        ': heartbeat\n\nevent: overflow\ndata: {"resumePosition":{"attempt":1,"seq":4}}\n\nevent: error\ndata: {"resumePosition":{"attempt":1,"seq":4}}\n\n',
      ),
    );
    expect(controls).toEqual(['overflow', 'error']);
    expect(parser.cursor).toEqual({ attempt: 1, seq: 4 });
  });
  it.each([
    frame(1, 0, { run_id: '22222222-2222-2222-2222-222222222222' }),
    frame(1, 0, { version: 1 }),
    frame(1, 0, { protocol: 'wavedl-jsonl' }),
    frame(1, 0, { type: 'hello' }),
    frame(1, 0, { seq: 9007199254740992 }),
    frame(1, 0).replace('id: 1:0', 'id: 1:1'),
    frame(1, 0, { payload: [] }),
    frame(1, 0, { ts: 'not a timestamp' }),
  ])('rejects ownership/protocol/id/gap errors', async (text) => {
    const parser = new EventStreamParser(run, INITIAL_CURSOR, () => undefined);
    await expect(parser.push(encoder.encode(text))).rejects.toMatchObject({ code: 'protocol' });
    expect(parser.cursor).toEqual(INITIAL_CURSOR);
  });
  it('accepts sparse durable sequence numbers and attempts', async () => {
    const received: RunEvent[] = [];

    const parser = new EventStreamParser(run, INITIAL_CURSOR, (value) => {
      received.push(value);
    });

    await parser.push(encoder.encode(frame(1, 5) + frame(1, 19) + frame(4, 3)));
    expect(received.map((value) => [value.attempt, value.seq])).toEqual([
      [1, 5],
      [1, 19],
      [4, 3],
    ]);
    expect(parser.cursor).toEqual({ attempt: 4, seq: 3 });
  });
  it('accepts large finite metrics but never unsafe integer cursor fields', async () => {
    const received: RunEvent[] = [];

    const parser = new EventStreamParser(run, INITIAL_CURSOR, (value) => {
      received.push(value);
    });

    await parser.push(encoder.encode(frame(1, 0, { payload: { metric: 1e100 } })));
    expect(received[0]?.payload.metric).toBe(1e100);
    await expect(
      parser.push(encoder.encode(frame(1, 1, { seq: 9007199254740992 }))),
    ).rejects.toMatchObject({ code: 'protocol' });
  });
  it('refuses controls advertising uncommitted progress', async () => {
    const parser = new EventStreamParser(run, { attempt: 1, seq: 4 }, () => undefined);
    await expect(
      parser.push(
        encoder.encode('event: overflow\ndata: {"resumePosition":{"attempt":2,"seq":0}}\n\n'),
      ),
    ).rejects.toMatchObject({ code: 'protocol' });
    expect(parser.cursor).toEqual({ attempt: 1, seq: 4 });
  });
  it('rejects oversized lines and frames, malformed UTF8 and incomplete JSON', async () => {
    for (const bytes of [
      encoder.encode('x'.repeat(1024 * 1024 + 1)),
      encoder.encode(
        `data: ${'x'.repeat(700000)}\ndata: ${'x'.repeat(700000)}\ndata: ${'x'.repeat(700000)}\n\n`,
      ),
      new Uint8Array([255]),
      encoder.encode('id: 1:0\ndata: {\n\n'),
    ]) {
      await expect(
        new EventStreamParser(run, INITIAL_CURSOR, () => undefined).push(bytes),
      ).rejects.toThrow();
    }
  });
  it('does not dispatch incomplete final frame', async () => {
    const received: RunEvent[] = [];

    const parser = new EventStreamParser(run, INITIAL_CURSOR, (value) => {
      received.push(value);
    });

    await parser.push(encoder.encode(frame().slice(0, -1)));
    await parser.finish();
    expect(received).toEqual([]);
  });
  it('does not notify or advance the cursor when a commit fails', async () => {
    const saved: Cursor[] = [];

    const parser = new EventStreamParser(
      run,
      INITIAL_CURSOR,
      () => {
        throw new Error('commit failed');
      },
      (cursor) => {
        saved.push(cursor);
      },
    );

    await expect(parser.push(encoder.encode(frame()))).rejects.toThrow('commit failed');
    expect(saved).toEqual([]);
    expect(parser.cursor).toEqual(INITIAL_CURSOR);
  });
  it('caps multibyte lines by UTF8 bytes, not character count', async () => {
    await expect(
      new EventStreamParser(run, INITIAL_CURSOR, () => undefined).push(
        encoder.encode('🌊'.repeat(270000)),
      ),
    ).rejects.toThrow('live updates is too long');
  });
  it('rejects invalid parser identities before consuming events', () => {
    expect(() => new EventStreamParser('invalid-run', INITIAL_CURSOR, () => undefined)).toThrow();
    expect(() => new EventStreamParser(run, { attempt: 0, seq: 0 }, () => undefined)).toThrow();
  });
  it('does not commit or advance a frame after abort', async () => {
    const abort = new AbortController();
    const received: RunEvent[] = [];
    const saved: Cursor[] = [];

    const parser = new EventStreamParser(
      run,
      INITIAL_CURSOR,
      (value) => {
        received.push(value);
      },
      (cursor) => {
        saved.push(cursor);
      },
      undefined,
      abort.signal,
    );

    abort.abort();
    await expect(parser.push(encoder.encode(frame()))).rejects.toThrow();
    expect(received).toEqual([]);
    expect(saved).toEqual([]);
    expect(parser.cursor).toEqual(INITIAL_CURSOR);
  });
});

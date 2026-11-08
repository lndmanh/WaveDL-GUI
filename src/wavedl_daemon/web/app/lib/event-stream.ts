import { DaemonApiError, object, parseJson } from './daemon-api';

import { cursorSchema, runEventSchema } from '../../shared/schemas/event-stream';
import type { Json } from '~~/types/json';
import type { Cursor, RunEvent, StreamControl } from '~~/types/event-stream';

export const INITIAL_CURSOR: Readonly<Cursor> = Object.freeze({ attempt: 0, seq: -1 });
const MAX_LINE = 1024 * 1024;
const MAX_FRAME = 2 * 1024 * 1024;

export function validCursor(value: Json | Cursor | undefined): value is Cursor {
  return cursorSchema.safeParse(value).success;
}

function envelope(data: string, runId: string, id: string): RunEvent {
  let value;

  try {
    value = parseJson(data);
  } catch {
    throw DaemonApiError.fromKey('protocol', 'malformedOrUnsafeRunEventJson');
  }

  const parsed = runEventSchema.safeParse(value);

  if (
    !parsed.success ||
    parsed.data.run_id !== runId ||
    id !== `${parsed.data.attempt}:${parsed.data.seq}`
  ) {
    throw DaemonApiError.fromKey('protocol', 'invalidEventScope');
  }

  return parsed.data;
}

/** Shared ordered ingress for decoded SSE frames and validated JSON events. */
class EventIngress {
  #cursor: Cursor;
  constructor(
    private readonly runId: string,
    cursor: Cursor,
    private readonly commit: (event: RunEvent) => void | Promise<void>,
    private readonly advance: (cursor: Cursor) => void,
    private readonly signal?: AbortSignal,
  ) {
    if (
      !validCursor(cursor) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)
    )
      throw DaemonApiError.fromKey('response', 'invalidCursorOrRunIdentity');
    this.#cursor = { ...cursor };
  }
  get cursor(): Cursor {
    return { ...this.#cursor };
  }
  async accept(event: RunEvent): Promise<void> {
    this.signal?.throwIfAborted();

    if (event.run_id !== this.runId)
      throw DaemonApiError.fromKey('protocol', 'invalidEventScope');

    if (new Date(event.ts).toISOString().slice(0, 19) !== event.ts.slice(0, 19))
      throw DaemonApiError.fromKey('protocol', 'invalidEventTimestamp');
    const current = this.#cursor;

    if (
      event.attempt < current.attempt ||
      (event.attempt === current.attempt && event.seq <= current.seq)
    )
      return;
    // Durable journals can be sparse. Only ordering, not adjacency, is promised.
    await this.commit(event);
    // Revocation during an async commit must not advance unseen progress.
    this.signal?.throwIfAborted();
    const next = { attempt: event.attempt, seq: event.seq };
    this.advance(next);
    this.#cursor = next;
  }
}

/** Sequential async callbacks provide backpressure; commit precedes cursor advance. */
export class EventStreamParser {
  #decoder = new TextDecoder('utf-8', { fatal: true });
  #pending = '';
  #lineBytes = 0;
  #data: string[] = [];
  #id = '';
  #type = '';
  #frameBytes = 0;
  #ingress: EventIngress;
  constructor(
    private readonly runId: string,
    cursor: Cursor,
    commit: (event: RunEvent) => void | Promise<void>,
    advance: (cursor: Cursor) => void = () => undefined,
    private readonly control: (event: StreamControl) => void | Promise<void> = () => undefined,
    private readonly signal?: AbortSignal,
  ) {
    this.#ingress = new EventIngress(runId, cursor, commit, advance, signal);
  }
  get cursor(): Cursor {
    return this.#ingress.cursor;
  }
  /** JSON pages already passed transport schema validation; no SSE framing round-trip. */
  async accept(event: RunEvent): Promise<void> {
    this.signal?.throwIfAborted();
    // Match the former single data-line bound without synthesizing/decoding a frame.
    if (new TextEncoder().encode(JSON.stringify(event)).byteLength + 6 > MAX_LINE)
      throw DaemonApiError.fromKey('protocol', 'streamLineExceedsLimit');
    await this.#ingress.accept(event);
  }
  async push(chunk: Uint8Array): Promise<void> {
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      let text: string;

      try {
        text = this.#decoder.decode(chunk.subarray(offset, offset + 65536), { stream: true });
      } catch {
        throw DaemonApiError.fromKey('protocol', 'invalidUtf8Stream');
      }

      await this.#consume(text);
    }
  }
  async finish(): Promise<void> {
    let text: string;

    try {
      text = this.#decoder.decode();
    } catch {
      throw DaemonApiError.fromKey('protocol', 'truncatedUtf8Stream');
    }

    await this.#consume(text);
    // An incomplete final frame is discarded and replayed on reconnect.
    this.#pending = '';
    this.#lineBytes = 0;
    this.#reset();
  }
  async #consume(text: string): Promise<void> {
    // Slice before appending, so a large network chunk cannot create an unbounded line.
    let start = 0;

    for (;;) {
      const newline = text.indexOf('\n', start);
      const part = text.slice(start, newline < 0 ? text.length : newline);
      this.#lineBytes += new TextEncoder().encode(part).byteLength;

      if (this.#lineBytes > MAX_LINE)
        throw DaemonApiError.fromKey('protocol', 'streamLineExceedsLimit');
      this.#pending += part;

      if (newline < 0) return;
      const line = this.#pending.endsWith('\r') ? this.#pending.slice(0, -1) : this.#pending;
      this.#pending = '';
      this.#lineBytes = 0;
      await this.#line(line);
      start = newline + 1;
    }
  }
  async #line(line: string): Promise<void> {
    this.#frameBytes += new TextEncoder().encode(line).byteLength + 1;

    if (this.#frameBytes > MAX_FRAME)
      throw DaemonApiError.fromKey('protocol', 'streamFrameExceedsLimit');

    if (!line) {
      await this.#dispatch();
      this.#reset();

      return;
    }

    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);

    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') this.#data.push(value);
    else if (field === 'id') {
      if (this.#id || value.includes('\0'))
        throw DaemonApiError.fromKey('protocol', 'ambiguousEventId');
      this.#id = value;
    } else if (field === 'event') {
      if (this.#type) throw DaemonApiError.fromKey('protocol', 'ambiguousEventType');
      this.#type = value;
    }
  }
  #reset(): void {
    this.#data = [];
    this.#id = '';
    this.#type = '';
    this.#frameBytes = 0;
  }
  async #dispatch(): Promise<void> {
    this.signal?.throwIfAborted();

    if (!this.#data.length) return;
    const data = this.#data.join('\n');

    if (this.#type === 'overflow' || this.#type === 'error') {
      const value = parseJson(data);

      if (this.#id || !object(value))
        throw DaemonApiError.fromKey('protocol', 'invalidStreamControl');
      const resume = value.resumePosition;

      if (!validCursor(resume)) throw DaemonApiError.fromKey('protocol', 'invalidStreamControl');

      const current = this.cursor;

      if (
        resume.attempt > current.attempt ||
        (resume.attempt === current.attempt && resume.seq > current.seq)
      ) {
        throw DaemonApiError.fromKey('protocol', 'uncommittedStreamProgress');
      }

      await this.control({
        type: this.#type,
        resumePosition: { attempt: resume.attempt, seq: resume.seq },
      });

      return; // Server controls NEVER advance a runtime cursor.
    }

    if (this.#type && this.#type !== 'message')
      throw DaemonApiError.fromKey('protocol', 'unsupportedStreamEvent');
    await this.#ingress.accept(envelope(data, this.runId, this.#id));
  }
}

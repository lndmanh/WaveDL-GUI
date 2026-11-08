import type { Artifact } from '~~/types/artifact-client';

export interface ArtifactImageState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  url?: string;
  width?: number;
  height?: number;
}

export interface ArtifactImageResource {
  url: string;
  width: number;
  height: number;
}

export interface ArtifactImageOptions {
  priority?: boolean;
  retry?: boolean;
}

interface Entry {
  artifact: Artifact;
  state: ArtifactImageState;
  promise: Promise<ArtifactImageState | null>;
  resolve(value: ArtifactImageState | null): void;
}

const idle: ArtifactImageState = Object.freeze({ status: 'idle' });

function key(artifact: Artifact): string {
  return JSON.stringify([artifact.runId, artifact.path, artifact.size, artifact.modified]);
}

/** A scope owns both queued work and object URLs; reset also settles queued callers. */
export class ArtifactImageCache {
  #entries = new Map<string, Entry>();
  #queue: Entry[] = [];
  #running = new Set<Entry>();
  #scope = new AbortController();
  readonly #load: (artifact: Artifact, signal: AbortSignal) => Promise<ArtifactImageResource>;
  readonly #release: (url: string) => void;
  readonly #changed: () => void;

  constructor(
    load: (artifact: Artifact, signal: AbortSignal) => Promise<ArtifactImageResource>,
    release: (url: string) => void,
    changed: () => void,
  ) {
    this.#load = load;
    this.#release = release;
    this.#changed = changed;
  }

  state(artifact: Artifact): ArtifactImageState {
    return this.#entries.get(key(artifact))?.state ?? idle;
  }

  request(
    artifact: Artifact,
    options: ArtifactImageOptions = {},
  ): Promise<ArtifactImageState | null> {
    const identity = key(artifact);
    const existing = this.#entries.get(identity);

    if (existing && !(options.retry && existing.state.status === 'error')) {
      const index = this.#queue.indexOf(existing);

      if (options.priority && index > 0) {
        this.#queue.splice(index, 1);
        this.#queue.unshift(existing);
      }

      return existing.promise;
    }

    let settle: (value: ArtifactImageState | null) => void = () => undefined;

    const promise = new Promise<ArtifactImageState | null>((resolve) => {
      settle = resolve;
    });

    const entry: Entry = {
      artifact,
      state: { status: 'loading' },
      promise,
      resolve: settle,
    };

    this.#entries.set(identity, entry);

    if (options.priority) this.#queue.unshift(entry);
    else this.#queue.push(entry);
    this.#changed();
    this.#pump();

    return promise;
  }

  reset(): void {
    this.#scope.abort();
    this.#scope = new AbortController();

    for (const entry of this.#entries.values()) {
      if (entry.state.url) this.#release(entry.state.url);
      entry.resolve(null);
    }

    this.#entries.clear();
    this.#queue = [];
    this.#running.clear();
    this.#changed();
  }

  /** Stop queued and in-flight work but keep decoded images, so a hidden page returns without reloading them. */
  cancelPending(): void {
    this.#scope.abort();
    this.#scope = new AbortController();

    for (const [identity, entry] of this.#entries) {
      if (entry.state.status === 'ready') continue;
      entry.resolve(null);
      this.#entries.delete(identity);
    }

    this.#queue = [];
    this.#running.clear();
    this.#changed();
  }

  #pump(): void {
    while (this.#running.size < 2) {
      const entry = this.#queue.shift();

      if (!entry) break;
      this.#running.add(entry);
      void this.#execute(entry, this.#scope.signal);
    }
  }

  async #execute(entry: Entry, signal: AbortSignal): Promise<void> {
    try {
      const resource = await this.#load(entry.artifact, signal);

      if (signal.aborted) this.#release(resource.url);
      else {
        entry.state = { status: 'ready', ...resource };
        entry.resolve(entry.state);
      }
    } catch {
      if (!signal.aborted) {
        entry.state = { status: 'error' };
        entry.resolve(entry.state);
      }
    } finally {
      this.#running.delete(entry);

      if (!signal.aborted) {
        this.#changed();
        this.#pump();
      }
    }
  }
}

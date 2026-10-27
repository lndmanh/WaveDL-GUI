import { DaemonApi, DaemonApiError, stripBootstrapUrl, type Health } from './daemon-api';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authentication'
  | 'skew'
  | 'offline'
  | 'error';
export interface ConnectionState {
  status: ConnectionStatus;
  health: Health | null;
  message: string | null;
  revision: number;
  buildMismatch: boolean;
}
export interface ConnectionOptions {
  origin: string;
  buildId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  online?: boolean;
}
export interface WorkOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export class ConnectionSessionError extends Error {
  constructor(
    public readonly code:
      | 'unavailable'
      | 'stale'
      | 'authentication'
      | 'skew'
      | 'response'
      | 'request',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ConnectionSessionError';
  }
}

/** One browser-memory authority scope. Detaching never cancels server work. */
export class ConnectionSession {
  #state: ConnectionState = Object.freeze({
    status: 'disconnected',
    health: null,
    message: null,
    revision: 0,
    buildMismatch: false,
  });
  #listeners = new Set<(state: ConnectionState) => void>();
  #api: DaemonApi | null = null;
  #scope: AbortController | null = null;
  #daemonId: string | undefined;
  #online: boolean;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;
  readonly #origin: string;
  readonly #buildId: string;

  constructor(options: ConnectionOptions) {
    this.#origin = options.origin;
    this.#buildId = options.buildId;
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1)
      throw new Error('Invalid connection deadline');
    this.#online = options.online ?? true;
    if (!this.#online) this.#state = Object.freeze({ ...this.#state, status: 'offline' });
  }
  get api(): DaemonApi | null {
    return this.#state.status === 'connected' ? this.#api : null;
  }
  snapshot(): ConnectionState {
    return this.#state;
  }
  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }
  #publish(
    status: ConnectionStatus,
    message: string | null = null,
    health: Health | null = null,
    buildMismatch = false,
  ): void {
    this.#state = Object.freeze({
      status,
      message,
      health,
      revision: this.#state.revision,
      buildMismatch,
    });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #revoke(): void {
    this.#state = Object.freeze({ ...this.#state, revision: this.#state.revision + 1 });
    this.#scope?.abort();
    this.#scope = null;
    this.#api?.clearToken();
    this.#api = null;
  }
  detach(): void {
    this.#revoke();
    this.#daemonId = undefined;
    this.#publish(this.#online ? 'disconnected' : 'offline');
  }
  setOnline(online: boolean): void {
    if (online === this.#online) return;
    this.#online = online;
    this.#revoke();
    this.#publish(
      online ? 'disconnected' : 'offline',
      online
        ? 'Reconnect explicitly to verify the daemon again.'
        : 'Offline: live status and actions are unavailable.',
    );
  }
  async connect(token: string): Promise<boolean> {
    return this.#connect(async (api, signal) => {
      api.setToken(token);
      return api.health(signal);
    });
  }
  async reconnect(token: string): Promise<boolean> {
    return this.connect(token);
  }
  /** Raw stream consumers report fatal transport/contract errors to the owner. */
  reportFailure(error?: Error, expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== this.#state.revision) return;
    if (error instanceof DaemonApiError && error.code === 'http') return;
    if (error instanceof ConnectionSessionError && error.code === 'stale') return;
    this.#fail(error);
  }
  async bootstrap(input: string, replaceUrl: (url: string) => void): Promise<boolean> {
    // Strip credentials even when offline, before starting the connection work.
    try {
      replaceUrl(stripBootstrapUrl(input).url);
    } catch {
      this.#fail();
      return false;
    }
    return this.#connect(async (api, signal) => {
      if (!(await api.bootstrap(input, () => undefined))) return null;
      return api.health(signal);
    });
  }
  async refresh(): Promise<boolean> {
    const revision = this.#state.revision;
    try {
      const health = await this.perform((api, signal) => api.health(signal));
      if (revision !== this.#state.revision || !this.api) return false;
      this.#publish('connected', null, Object.freeze(health));
      return true;
    } catch {
      return false;
    }
  }
  async #connect(
    handshake: (api: DaemonApi, signal: AbortSignal) => Promise<Health | null>,
  ): Promise<boolean> {
    this.#revoke();
    if (!this.#online) {
      this.#publish('offline', 'Offline: live status and actions are unavailable.');
      return false;
    }
    const revision = this.#state.revision;
    const scope = new AbortController();
    this.#scope = scope;
    this.#publish('connecting');
    if (revision !== this.#state.revision || scope.signal.aborted) return false;
    let candidate: DaemonApi | null = null;
    try {
      let handshakeSignal = scope.signal;
      const scopedFetch: typeof fetch = (input, init) =>
        this.#fetcher(input, {
          ...init,
          signal: AbortSignal.any([
            scope.signal,
            handshakeSignal,
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
      const api = new DaemonApi(
        this.#origin,
        { daemonId: this.#daemonId, buildId: this.#buildId },
        scopedFetch,
      );
      candidate = api;
      const health = await this.#bounded(
        (signal) => {
          handshakeSignal = signal;
          return handshake(api, signal).finally(() => {
            // An injected/slow transport may finish even after abort. Do not
            // let a late bootstrap retain a credential on its retired client.
            if (signal.aborted || revision !== this.#state.revision) api.clearToken();
          });
        },
        scope.signal,
        this.#timeoutMs,
      );
      if (revision !== this.#state.revision || scope.signal.aborted) {
        candidate.clearToken();
        return false;
      }
      if (!health) {
        candidate.clearToken();
        this.#scope = null;
        this.#publish('authentication', 'Enter the daemon bearer credential.');
        return false;
      }
      this.#daemonId = health.daemon_id;
      this.#api = candidate;
      this.#publish('connected', null, Object.freeze(health));
      return revision === this.#state.revision && this.api === candidate;
    } catch (error) {
      candidate?.clearToken();
      if (revision === this.#state.revision) this.#fail(error instanceof Error ? error : undefined);
      return false;
    }
  }
  async perform<T>(
    work: (api: DaemonApi, signal: AbortSignal) => Promise<T>,
    options: WorkOptions = {},
  ): Promise<T> {
    const api = this.api;
    const scope = this.#scope;
    if (!this.#online || !api || !scope)
      throw new ConnectionSessionError(
        'unavailable',
        'Connect to a verified daemon before using live actions.',
      );
    const revision = this.#state.revision;
    const signal = options.signal ? AbortSignal.any([scope.signal, options.signal]) : scope.signal;
    try {
      const result = await this.#bounded(
        (requestSignal) => work(api, requestSignal),
        signal,
        options.timeoutMs ?? this.#timeoutMs,
      );
      if (revision !== this.#state.revision || signal.aborted)
        throw new ConnectionSessionError(
          'stale',
          'The connection scope changed; discard this result.',
        );
      return result;
    } catch (error) {
      if (revision !== this.#state.revision || signal.aborted)
        throw new ConnectionSessionError(
          'stale',
          'The connection scope changed; discard this result.',
        );
      this.reportFailure(error instanceof Error ? error : undefined);
      throw this.#safeError(error instanceof Error ? error : undefined);
    }
  }
  async #bounded<T>(
    work: (signal: AbortSignal) => Promise<T>,
    scope: AbortSignal,
    timeoutMs: number,
  ): Promise<T> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)
      throw new ConnectionSessionError('request', 'Invalid request deadline.');
    const controller = new AbortController();
    const signal = AbortSignal.any([scope, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () =>
        reject(
          new ConnectionSessionError(
            'request',
            'The request was interrupted or timed out; verify its outcome before retrying.',
          ),
        );
      signal.addEventListener('abort', rejectAbort, { once: true });
      if (signal.aborted) rejectAbort();
    });
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (signal.aborted) return await aborted;
      return await Promise.race([work(signal), aborted]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
    }
  }
  #safeError(error?: Error): ConnectionSessionError {
    if (error instanceof ConnectionSessionError) return error;
    if (error instanceof DaemonApiError) {
      if (error.code === 'authentication')
        return new ConnectionSessionError(
          'authentication',
          'Credential expired or rejected; enter it again.',
        );
      if (error.code === 'identity' || error.code === 'protocol')
        return new ConnectionSessionError(
          'skew',
          'Daemon identity, build or protocol changed. Update the client or explicitly disconnect before changing daemon scope.',
        );
      if (error.code === 'response')
        return new ConnectionSessionError(
          'response',
          'The daemon returned an invalid response. Reconnect to verify its identity.',
        );
    }
    return new ConnectionSessionError(
      'request',
      'The daemon request failed. Verify connectivity and the operation outcome before retrying.',
      error instanceof DaemonApiError &&
        error.code === 'http' &&
        typeof error.status === 'number' &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599
        ? error.status
        : undefined,
    );
  }
  #fail(error?: Error): void {
    const safe = this.#safeError(error);
    this.#revoke();
    this.#publish(
      safe.code === 'authentication' ? 'authentication' : safe.code === 'skew' ? 'skew' : 'error',
      safe.message,
      null,
      error instanceof DaemonApiError && error.buildMismatch,
    );
  }
}

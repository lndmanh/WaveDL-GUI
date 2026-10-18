export type InstallationRefusal = 'capacity' | 'verification';

/** Only the public Workstation worker may report an installation refusal. */
export function installationRefusalMessage(
  event: { source: unknown; data: unknown },
  origin: string,
): InstallationRefusal | null {
  if (typeof ServiceWorker === 'undefined' || !(event.source instanceof ServiceWorker)) {
    return null;
  }
  if (event.source.scriptURL !== `${origin}/sw.js`) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const keys = Reflect.ownKeys(data);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('reason')) return null;
  if (!('type' in data) || data.type !== 'WAVEDL_UPDATE_REFUSED' || !('reason' in data)) {
    return null;
  }
  return data.reason === 'capacity' || data.reason === 'verification' ? data.reason : null;
}

export function installationRefusalQueryResult(
  event: { source: unknown; data: unknown },
  origin: string,
): InstallationRefusal | null {
  if (typeof ServiceWorker === 'undefined' || !(event.source instanceof ServiceWorker)) return null;
  if (event.source.scriptURL !== `${origin}/sw.js`) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const keys = Reflect.ownKeys(data);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('reason')) return null;
  if (!('type' in data) || data.type !== 'WAVEDL_UPDATE_REFUSAL_RESULT' || !('reason' in data))
    return null;
  return data.reason === 'capacity' || data.reason === 'verification' ? data.reason : null;
}

export interface UpdateState {
  readonly available: boolean;
  readonly dismissed: boolean;
  readonly updating: boolean;
  readonly failed: boolean;
  readonly installationRefusal: InstallationRefusal | null;
}

/** Worker activation is shared; permission to reload belongs to this client. */
export class UpdateConsent {
  #state: UpdateState = Object.freeze({
    available: false,
    dismissed: false,
    updating: false,
    failed: false,
    installationRefusal: null,
  });
  #approved = false;
  #controlled = false;
  #reloaded = false;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #settle: (() => void) | undefined;

  constructor(
    private readonly options: {
      activate: () => Promise<void>;
      reload: () => void;
      changed?: (state: UpdateState) => void;
    },
  ) {}

  snapshot(): UpdateState {
    return this.#state;
  }
  #publish(patch: Partial<UpdateState>): void {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    this.options.changed?.(this.#state);
  }
  available(): void {
    // A later waiting worker needs its own activation, even if an earlier
    // update already took control while this client deferred reloading.
    this.#controlled = false;
    if (!this.#reloaded) {
      this.#publish({
        available: true,
        dismissed: false,
        failed: false,
        installationRefusal: null,
      });
    }
  }
  defer(): void {
    if (!this.#state.updating) this.#publish({ dismissed: true });
  }
  registrationFailed(): void {
    this.#fail(this.#attempt);
  }
  installationRefused(reason: InstallationRefusal): void {
    if (this.#reloaded) return;
    this.#fail(this.#attempt);
    this.#publish({ available: true, dismissed: false, installationRefusal: reason });
  }
  #clearPending(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#settle?.();
    this.#settle = undefined;
  }
  #fail(attempt: number): void {
    if (attempt !== this.#attempt || this.#reloaded) return;
    this.#attempt++;
    this.#approved = false;
    this.#clearPending();
    this.#publish({ updating: false, failed: true });
  }
  #reload(): void {
    if (this.#reloaded) return;
    this.#reloaded = true;
    this.#approved = false;
    this.#attempt++;
    this.#clearPending();
    this.#publish({ available: false, updating: false, failed: false });
    this.options.reload();
  }
  controlled(): void {
    this.#controlled = true;
    if (this.#reloaded) return;
    if (this.#approved) this.#reload();
    else this.#publish({ available: true, dismissed: false });
  }
  async approve(): Promise<void> {
    if (
      !this.#state.available ||
      this.#state.updating ||
      this.#state.installationRefusal !== null ||
      this.#reloaded
    )
      return;
    if (this.#controlled) {
      this.#reload();
      return;
    }
    const attempt = ++this.#attempt;
    this.#approved = true;
    this.#publish({ updating: true, failed: false, dismissed: false });
    const completed = new Promise<void>((resolve) => {
      this.#settle = resolve;
      this.#timer = setTimeout(() => this.#fail(attempt), 15000);
    });
    try {
      // The SDK's request resolves after sending SKIP_WAITING, not takeover.
      // Consent remains pending until controlled(), failure or the deadline.
      await Promise.race([this.options.activate(), completed]);
    } catch {
      this.#fail(attempt);
    }
  }
}

import { clientError } from '../i18n/client-messages';
import type { ConnectionSession } from './connection-session';
import { DaemonApiError } from './daemon-api';
import type { PlanView, RunView } from '~~/types/daemon-api';
import type { ClientErrorKey } from '~~/types/i18n';
import type { JsonObject } from '~~/types/json';

/** Memory-only approval scope; invalidation never rotates an unchanged request key. */
export class RequestApproval {
  #request: JsonObject | null = null;
  #fingerprint = '';
  #key = '';
  #approved: PlanView | null = null;
  #revision = -1;
  #epoch = 0;
  constructor(
    readonly session: ConnectionSession,
    readonly keyFactory: () => string,
  ) {}
  get approved(): PlanView | null {
    return this.#revision === this.session.snapshot().revision ? this.#approved : null;
  }
  get key(): string {
    return this.#key;
  }
  invalidate(): void {
    this.#epoch++;
    this.#approved = null;
    this.#request = null;
  }
  /** The domain invalidates before validating selections, including failed preparations. */
  prepare(request: JsonObject): void {
    const fingerprint = JSON.stringify(request);

    if (fingerprint !== this.#fingerprint) {
      this.#key = this.keyFactory();
      this.#fingerprint = fingerprint;
    }

    this.#request = request;
    this.#revision = this.session.snapshot().revision;
  }
  async preview(
    errors: {
      requestRequired: ClientErrorKey;
      validationRequired: ClientErrorKey;
      draftChanged: ClientErrorKey;
    },
    signal?: AbortSignal,
  ): Promise<PlanView> {
    if (!this.#request) throw clientError(errors.requestRequired, {});

    if (this.#revision !== this.session.snapshot().revision || !this.session.api)
      throw clientError(errors.validationRequired, {});
    const request = this.#request;
    const key = this.#key;
    const epoch = this.#epoch;
    const revision = this.#revision;

    const plan = await this.session.perform((api, scoped) => api.plan(request, key, scoped), {
      signal,
    });

    if (
      epoch !== this.#epoch ||
      key !== this.#key ||
      request !== this.#request ||
      revision !== this.session.snapshot().revision
    )
      throw clientError(errors.draftChanged, {});
    this.#approved = plan;

    return plan;
  }
  async submit(required: ClientErrorKey, signal?: AbortSignal): Promise<RunView> {
    const plan = this.approved;

    if (!plan) throw clientError(required, {});

    return this.session.perform((api, scoped) => api.submit(plan, scoped), { signal });
  }
  async status(
    required: ClientErrorKey,
    mismatch: ClientErrorKey,
    signal?: AbortSignal,
  ): Promise<RunView> {
    const plan = this.approved;

    if (!plan) throw clientError(required, {});

    return this.session.perform(
      async (api, scoped) => {
        const run = await api.getRun(plan.run_id, scoped);

        if (run.plan_id !== plan.plan_id || run.request_id !== plan.request_id)
          throw DaemonApiError.fromKey('identity', mismatch);

        return run;
      },
      { signal },
    );
  }
}

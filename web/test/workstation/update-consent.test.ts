import { afterEach, describe, expect, it, vi } from 'vitest';
import { installationRefusalMessage, UpdateConsent } from '../../workstation/lib/update-consent';

function client(activate: () => Promise<void> = vi.fn(async () => undefined)) {
  const reload = vi.fn();
  const consent = new UpdateConsent({ activate, reload });
  consent.available();
  return { consent, activate, reload };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('per-client update consent', () => {
  it.each(['capacity', 'verification'] as const)(
    'keeps %s installation refusal visible without activation until a verified waiting candidate',
    async (reason) => {
      const { consent, activate, reload } = client();
      consent.defer();
      consent.installationRefused(reason);
      expect(consent.snapshot()).toMatchObject({
        available: true,
        dismissed: false,
        updating: false,
        failed: true,
        installationRefusal: reason,
      });
      consent.controlled();
      await consent.approve();
      expect(activate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      consent.available();
      expect(consent.snapshot()).toMatchObject({ installationRefusal: null, failed: false });
      await consent.approve();
      expect(activate).toHaveBeenCalledOnce();
      expect(reload).not.toHaveBeenCalled();
      consent.controlled();
      expect(reload).toHaveBeenCalledOnce();
    },
  );

  it('revokes pending approval and its expiry timer on installation refusal', async () => {
    vi.useFakeTimers();
    let reject: ((error: Error) => void) | undefined;
    const { consent, activate, reload } = client(
      vi.fn(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      ),
    );
    const pending = consent.approve();
    consent.installationRefused('capacity');
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    consent.controlled();
    reject?.(new Error('late failed request'));
    await Promise.resolve();
    await consent.approve();
    await vi.advanceTimersByTimeAsync(15000);
    expect(consent.snapshot()).toMatchObject({ installationRefusal: 'capacity', updating: false });
    expect(activate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
  it('keeps a deferred client loaded when another client activates the worker', async () => {
    const a = client();
    const b = client();
    b.consent.defer();
    await a.consent.approve();
    a.consent.controlled();
    b.consent.controlled();
    expect(a.reload).toHaveBeenCalledOnce();
    expect(b.reload).not.toHaveBeenCalled();
    expect(b.consent.snapshot()).toMatchObject({ available: true, dismissed: false });
    await b.consent.approve();
    b.consent.controlled();
    expect(b.activate).not.toHaveBeenCalled();
    expect(b.reload).toHaveBeenCalledOnce();
  });

  it('sends one activation request and reloads once after explicit approval', async () => {
    const { consent, activate, reload } = client();
    await Promise.all([consent.approve(), consent.approve()]);
    expect(activate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    consent.controlled();
    consent.controlled();
    await consent.approve();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('activates a later waiting worker rather than treating an earlier takeover as current', async () => {
    const { consent, activate, reload } = client();
    consent.controlled();
    consent.available();
    await consent.approve();
    expect(activate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    consent.controlled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('withdraws consent after activation request failure, then permits explicit retry', async () => {
    const activate = vi.fn(async () => {
      throw new Error('offline');
    });
    const { consent, reload } = client(activate);
    await consent.approve();
    expect(consent.snapshot()).toMatchObject({ updating: false, failed: true });
    consent.controlled();
    expect(reload).not.toHaveBeenCalled();
    await consent.approve();
    expect(reload).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
  });

  it('withdraws approval on the SDK registration-error hook before external takeover', async () => {
    const { consent, reload } = client();
    await consent.approve();
    consent.registrationFailed();
    consent.controlled();
    expect(consent.snapshot()).toMatchObject({ updating: false, failed: true });
    expect(reload).not.toHaveBeenCalled();
    await consent.approve();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('expires approval if no activation arrives and ignores late request completion', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const { consent, reload } = client(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const request = consent.approve();
    await vi.advanceTimersByTimeAsync(15000);
    expect(consent.snapshot()).toMatchObject({ updating: false, failed: true });
    consent.controlled();
    finish?.();
    await request;
    expect(reload).not.toHaveBeenCalled();
    await consent.approve();
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('installation refusal message boundary', () => {
  const origin = 'https://workstation.example';
  class WorkerSource {
    constructor(readonly scriptURL: string) {}
  }
  const payload = { type: 'WAVEDL_UPDATE_REFUSED', reason: 'capacity' };

  it('accepts only the exact public worker URL and supported reason', () => {
    vi.stubGlobal('ServiceWorker', WorkerSource);
    for (const reason of ['capacity', 'verification']) {
      expect(
        installationRefusalMessage(
          {
            source: new WorkerSource(`${origin}/sw.js`),
            data: { ...payload, reason },
          },
          origin,
        ),
      ).toBe(reason);
    }
  });

  it('rejects forged window sources, other origins, other URLs, and malformed payloads', () => {
    vi.stubGlobal('ServiceWorker', WorkerSource);
    for (const source of [
      null,
      { scriptURL: `${origin}/sw.js` },
      new WorkerSource('https://other.example/sw.js'),
      new WorkerSource(`${origin}/other-sw.js`),
      new WorkerSource(`${origin}/sw.js?build=1`),
      new WorkerSource(`${origin}/sw.js#fragment`),
    ]) {
      expect(installationRefusalMessage({ source, data: payload }, origin)).toBeNull();
    }
    for (const data of [
      null,
      [],
      'WAVEDL_UPDATE_REFUSED',
      { ...payload, extra: true },
      { ...payload, [Symbol('extra')]: true },
      { ...payload, reason: 'unknown' },
      { ...payload, type: 'OTHER_MESSAGE' },
      { reason: 'capacity' },
      Object.create(payload),
    ]) {
      expect(
        installationRefusalMessage(
          {
            source: new WorkerSource(`${origin}/sw.js`),
            data,
          },
          origin,
        ),
      ).toBeNull();
    }
  });

  it('ignores messages if the ServiceWorker constructor is unavailable', () => {
    vi.stubGlobal('ServiceWorker', undefined);
    expect(
      installationRefusalMessage(
        { source: { scriptURL: `${origin}/sw.js` }, data: payload },
        origin,
      ),
    ).toBeNull();
  });
});

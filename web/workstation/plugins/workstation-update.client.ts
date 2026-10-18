import { defineNuxtPlugin } from '#app';
import { readonly, shallowRef } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import {
  installationRefusalMessage,
  installationRefusalQueryResult,
  UpdateConsent,
  type UpdateState,
} from '../lib/update-consent';

export default defineNuxtPlugin(() => {
  const state = shallowRef<UpdateState>({
    available: false,
    dismissed: false,
    updating: false,
    failed: false,
    installationRefusal: null,
  });
  const consent = new UpdateConsent({
    activate: () => registration.updateServiceWorker(),
    reload: () => window.location.reload(),
    changed: (value) => {
      state.value = value;
    },
  });
  let verifiedWaiting = false;
  let activeRegistration: ServiceWorkerRegistration | undefined;
  let queriedWorker: ServiceWorker | null = null;
  const registration = useRegisterSW({
    immediate: true,
    onNeedRefresh: () => {
      verifiedWaiting = true;
      consent.available();
    },
    onNeedReload: () => consent.controlled(),
    onRegisterError: () => consent.registrationFailed(),
    onRegisteredSW: (_url, registered) => {
      activeRegistration = registered;
    },
  });
  if ('serviceWorker' in navigator && typeof ServiceWorker !== 'undefined') {
    const onMessage = (event: MessageEvent<unknown>) => {
      const reason = installationRefusalMessage(event, window.location.origin);
      if (reason !== null) consent.installationRefused(reason);
      const queryReason = installationRefusalQueryResult(event, window.location.origin);
      if (
        queryReason !== null &&
        event.source === queriedWorker &&
        !verifiedWaiting &&
        !activeRegistration?.waiting
      )
        consent.installationRefused(queryReason);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    const query = (worker: ServiceWorker | null) => {
      queriedWorker = worker;
      worker?.postMessage({ type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    };
    query(navigator.serviceWorker.controller);
    void navigator.serviceWorker.ready
      .then((ready) => {
        activeRegistration = ready;
        query(ready.active);
      })
      .catch(() => undefined);
    const onControllerChange = () => query(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    import.meta.hot?.dispose(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    });
  }
  return {
    provide: {
      workstationUpdate: {
        state: readonly(state),
        approve: () => consent.approve(),
        defer: () => consent.defer(),
      },
    },
  };
});

import { computed, onMounted, onScopeDispose, shallowReadonly, shallowRef } from 'vue';
import { ConnectionSession, type ConnectionOptions } from '../lib/connection-session';
import { stripBootstrapUrl } from '../lib/daemon-api';
import { clearSessionCredentialArea, loadSessionCredential } from '../lib/session-credential';
import { loadKeepSignedIn, saveKeepSignedIn } from '../lib/preferences';

/** Owns browser storage and mount ordering for the current daemon session. */
export function useDaemonConnection(options: ConnectionOptions) {
  const session = new ConnectionSession(options);
  const state = shallowRef(session.snapshot());
  const api = shallowRef(session.api);
  const keepSignedIn = shallowRef(false);
  const unsubscribe = session.subscribe((next) => {
    state.value = next;
    api.value = session.api;
  });
  const canMutate = computed(() => state.value.status === 'connected');
  function setKeepSignedIn(value: boolean): void {
    const next = value === true;
    if (keepSignedIn.value === next) return;
    keepSignedIn.value = next;
    saveKeepSignedIn(next);
    session.setKeepSignedIn(next);
    if (!next) clearSessionCredentialArea('local');
  }
  const online = () => session.setOnline(navigator.onLine);
  onMounted(() => {
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    try {
      const stripped = stripBootstrapUrl(window.location.href);
      window.history.replaceState(null, '', stripped.url);
      keepSignedIn.value = loadKeepSignedIn();
      if (!keepSignedIn.value) clearSessionCredentialArea('local');
      if (stripped.code !== null || stripped.invalid) {
        void session.bootstrapCode(stripped.code, stripped.invalid, keepSignedIn.value);
      } else {
        const stored = loadSessionCredential({}, options.origin);
        if (stored) {
          void session.resume(stored.credential, keepSignedIn.value);
        }
      }
    } catch {
      session.detach();
    }
  });
  onScopeDispose(() => {
    unsubscribe();
    session.dispose();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    }
  });
  return {
    state: shallowReadonly(state),
    api: shallowReadonly(api),
    canMutate,
    keepSignedIn: shallowReadonly(keepSignedIn),
    setKeepSignedIn,
    session,
    connect: (token: string, persist = keepSignedIn.value) => session.connect(token, persist),
    reconnect: (token: string, persist = keepSignedIn.value) => session.reconnect(token, persist),
    detach: () => session.disconnect(),
    refresh: () => session.refresh(),
  };
}

import { computed, onMounted, onScopeDispose, shallowReadonly, shallowRef } from 'vue';
import { ConnectionSession, type ConnectionOptions } from '../lib/connection-session';

/** Per-mounted-workstation memory; never persists bearer or authority to storage. */
export function useDaemonConnection(options: ConnectionOptions) {
  const session = new ConnectionSession(options);
  const state = shallowRef(session.snapshot());
  const api = shallowRef(session.api);
  const unsubscribe = session.subscribe((next) => {
    state.value = next;
    api.value = session.api;
  });
  const canMutate = computed(() => state.value.status === 'connected');
  const online = () => session.setOnline(navigator.onLine);
  onMounted(() => {
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    void session.bootstrap(window.location.href, (url) =>
      window.history.replaceState(null, '', url),
    );
  });
  onScopeDispose(() => {
    unsubscribe();
    session.detach();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    }
  });
  return {
    state: shallowReadonly(state),
    api: shallowReadonly(api),
    canMutate,
    session,
    connect: (token: string) => session.connect(token),
    reconnect: (token: string) => session.reconnect(token),
    detach: () => session.detach(),
    refresh: () => session.refresh(),
  };
}

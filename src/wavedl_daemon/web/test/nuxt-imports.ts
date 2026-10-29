export function definePageMeta(_meta: unknown): void {}
export { useRoute, useRouter } from 'vue-router';
export { useHead } from '@unhead/vue';
import { shallowRef } from 'vue';
import type { WorkstationAuthState } from '../app/composables/useWorkstationAuth';
import type { NavigationGuard } from 'vue-router';
import { parseQuery } from 'vue-router';
const auth = shallowRef<WorkstationAuthState>({ status: 'disconnected', resumePending: true });
export function useState(_key: string, _init: () => WorkstationAuthState) { return auth; }
export function defineNuxtRouteMiddleware(guard: NavigationGuard) { return guard; }
export function navigateTo(path: string, options: { replace: boolean }) {
  // Match Nuxt's client-middleware string-to-route conversion, including query.
  const url = new URL(path, 'https://wavedl.invalid');
  return { path: url.pathname, query: parseQuery(url.search), hash: url.hash, ...options };
}

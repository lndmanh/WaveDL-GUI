import { useCookie, useRequestURL } from '#app';
import { useLocalStorage } from '@vueuse/core';
import { apiRoutes } from '#shared/apiRoutes';

const PWA_LAST_PAGE_KEY = 'pwa_last_page';
const lastStoredPage = useLocalStorage<string | null>(PWA_LAST_PAGE_KEY, null);

const SKIP_PAGES = ['/auth/', apiRoutes.API_PREFIX, '/pwa', '/proxy/', '/~offline'];

const shouldSkip = (p: string) => SKIP_PAGES.some((x) => p.startsWith(x));

export function storeCurrentPage(path?: string) {
  let fullPath = path;
  if (!fullPath) {
    if (import.meta.server) {
      const url = useRequestURL();
      fullPath = url.pathname + (url.search || '');
    } else {
      fullPath = location.pathname + location.search + location.hash;
    }
  }
  if (!fullPath || shouldSkip(fullPath)) return;

  const cookie = useCookie<string | null>(PWA_LAST_PAGE_KEY, {
    path: '/',
    sameSite: 'lax',
    // maxAge: 60 * 60 * 24 * 30, // optional
  });
  cookie.value = fullPath;
  if (import.meta.client) {
    lastStoredPage.value = fullPath;
  }
}

export function getLastStoredPage() {
  if (import.meta.client && lastStoredPage.value) return lastStoredPage.value;
  const cookie = useCookie<string | null>(PWA_LAST_PAGE_KEY);
  return cookie.value ?? null;
}

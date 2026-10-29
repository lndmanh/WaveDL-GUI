import { computed, watch } from 'vue';
import { useRouter } from '#app';
import { isUuid } from '../lib/daemon-api-schemas';
import { sectionPath } from '../shell/sections';

/** Route params are the only selection authority; corrections never add history. */
export function useRunRoute(section: 'experiments' | 'results') {
  const router = useRouter();
  const root = sectionPath(section);
  // Nuxt freezes useRoute() for cached pages. A retired page must never correct
  // the URL belonging to the page the user is actually looking at.
  const active = computed(() => {
    const path = router.currentRoute.value.path;
    return path === root || path.startsWith(`${root}/`);
  });
  const routeRunId = computed(() => {
    const value = router.currentRoute.value.params.runId;
    return typeof value === 'string' ? value : null;
  });
  const runId = computed(() => active.value && isUuid(routeRunId.value) ? routeRunId.value : null);
  watch(
    () => active.value ? routeRunId.value : undefined,
    (value) => {
      if (value && !isUuid(value)) void router.replace(root);
    },
    { immediate: true },
  );
  function select(id: string | null): void {
    void router.push(sectionPath(section, id ?? undefined));
  }
  function unknown(id: string): void {
    if (runId.value === id) void router.replace(root);
  }
  return { runId, select, unknown };
}

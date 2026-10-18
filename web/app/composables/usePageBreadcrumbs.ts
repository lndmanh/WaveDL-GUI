import { onMounted, useId, type MaybeRefOrGetter } from 'vue';
import type { NavigationItem } from '~~/types';
import type { BreadcrumbItemType } from '~~/types/common';
import { findPageBreadcrumbs } from '@/utils/navigation';

interface PageBreadcrumbOverride {
  path: string;
  ownerId: string;
  items: BreadcrumbItemType[];
}

const pageBreadcrumbStateKey = 'page-breadcrumbs';

function usePageBreadcrumbState() {
  return useState<PageBreadcrumbOverride | null>(pageBreadcrumbStateKey, () => null);
}

export function useCurrentPageBreadcrumbs() {
  return usePageBreadcrumbState();
}

/**
 * Reads the registered override without requiring a Nuxt context.
 *
 * `useBreadcrumb` is called from computeds that may evaluate lazily, outside the
 * setup scope `useState` needs. There is simply no shared state to consult then,
 * which is not an error — the navigation trail below covers it.
 */
function registeredBreadcrumbs(path: string): BreadcrumbItemType[] | null {
  try {
    const registered = usePageBreadcrumbState();
    return registered.value?.path === path ? registered.value.items : null;
  } catch {
    return null;
  }
}

/**
 * The breadcrumb trail for a path.
 *
 * A page that registered its own trail through `usePageBreadcrumbs` wins;
 * otherwise the trail is derived from the navigation tree. Navigation is passed
 * in rather than read here, so this stays usable without the module that
 * produces it — and callers that already hold it avoid a second lookup.
 */
export function useBreadcrumb(
  path: string,
  navigation?: NavigationItem[] | null,
): BreadcrumbItemType[] {
  const registered = registeredBreadcrumbs(path);
  if (registered) return registered;

  const trail = findPageBreadcrumbs(navigation ?? undefined, path);
  return trail?.map((item) => ({ title: item.title, href: item.path })) ?? [];
}

export function usePageBreadcrumbs(items: MaybeRefOrGetter<BreadcrumbItemType[] | undefined>) {
  const route = useRoute();
  const pageBreadcrumbs = usePageBreadcrumbState();
  const ownerId = `page-breadcrumbs-${useId()}`;
  let stopRegistration: (() => void) | null = null;
  let stopRouteClear: (() => void) | null = null;

  function clearOwnedState(path?: string) {
    if (pageBreadcrumbs.value?.ownerId !== ownerId) {
      return;
    }

    if (path && pageBreadcrumbs.value.path !== path) {
      return;
    }

    if (pageBreadcrumbs.value) {
      pageBreadcrumbs.value = null;
    }
  }

  function normalizeBreadcrumbItems(resolvedItems: BreadcrumbItemType[] | undefined) {
    return (
      resolvedItems?.reduce<BreadcrumbItemType[]>((result, item) => {
        const title = item.title.trim();
        const href = item.href.trim();

        if (title.length > 0 && href.length > 0) {
          result.push({ title, href });
        }

        return result;
      }, []) ?? []
    );
  }

  function startRegistration() {
    stopRegistration = watch(
      () => toValue(items),
      (resolvedItems) => {
        const normalizedItems = normalizeBreadcrumbItems(resolvedItems);

        if (
          normalizedItems.length > 0 &&
          normalizedItems[normalizedItems.length - 1]?.href === route.path
        ) {
          pageBreadcrumbs.value = { path: route.path, ownerId, items: normalizedItems };
          return;
        }

        clearOwnedState();
      },
      { immediate: true, deep: true },
    );
  }

  function stopOwnedRegistration() {
    if (stopRegistration) {
      stopRegistration();
      stopRegistration = null;
    }
  }

  function startRouteClear() {
    stopRouteClear = watch(
      () => route.path,
      (_path, previousPath) => {
        clearOwnedState(previousPath);
      },
      { flush: 'post' },
    );
  }

  function stopWatchers() {
    stopOwnedRegistration();

    if (stopRouteClear) {
      stopRouteClear();
      stopRouteClear = null;
    }
  }

  if (import.meta.server) {
    return pageBreadcrumbs;
  }

  onMounted(() => {
    startRegistration();
    startRouteClear();
  });

  onScopeDispose(() => {
    clearOwnedState();
    stopWatchers();
  });

  return pageBreadcrumbs;
}

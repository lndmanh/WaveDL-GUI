import { runIdForPath } from '../shell/sections';
import type { RouteMeta } from 'vue-router';
import type { BreadcrumbItemType } from '~~/types/common';

export function buildRouteBreadcrumbs(input: {
  path: string;
  homeTitle: string;
  titleForPath: (absolutePath: string, isCurrent: boolean) => string | null;
}): BreadcrumbItemType[] {
  const crumbs: BreadcrumbItemType[] = [{ title: input.homeTitle, href: '/' }];

  if (input.path === '/') return crumbs;

  const segments = input.path.split('/').filter(Boolean);
  let currentPath = '';

  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isCurrent = index === segments.length - 1;
    const registeredTitle = input.titleForPath(currentPath, isCurrent);
    const title = registeredTitle ?? segment.charAt(0).toUpperCase() + segment.slice(1);

    crumbs.push({
      title,
      href: currentPath,
    });
  });

  return crumbs;
}

function resolveTitle(title: string, translate: (key: string) => string): string {
  return title.includes('.') ? translate(title) : title;
}

function titleFromMeta(
  meta: RouteMeta | undefined,
  translate: (key: string) => string,
): string | null {
  if (!meta) return null;
  const breadcrumb = meta.breadcrumb;

  if (breadcrumb) {
    return resolveTitle(breadcrumb, translate);
  }

  const title = meta.title;

  if (title) {
    return resolveTitle(title, translate);
  }

  return null;
}

export function useRouteBreadcrumbs() {
  const router = useRouter();
  const route = useRoute();
  const { t } = useI18n({ useScope: 'global' });

  const breadcrumbs = computed<BreadcrumbItemType[]>(() => {
    return buildRouteBreadcrumbs({
      path: route.path,
      homeTitle: t('shell.workstation'),
      titleForPath: (absolutePath, isCurrent) => {
        const runId = runIdForPath(absolutePath);

        if (isCurrent && runId) return t('shell.runBreadcrumb', { id: runId.slice(0, 8) });
        const match = router.resolve(absolutePath);
        const matchedTitle = titleFromMeta(match.meta, t);

        if (!isCurrent) return matchedTitle;

        return titleFromMeta(route.meta, t) ?? matchedTitle;
      },
    });
  });

  const currentBreadcrumb = computed(() => breadcrumbs.value[breadcrumbs.value.length - 1] ?? null);

  const parentBreadcrumb = computed(() => {
    if (breadcrumbs.value.length < 2) return null;

    return breadcrumbs.value[breadcrumbs.value.length - 2] ?? null;
  });

  const mobileOverflowBreadcrumbs = computed(() => {
    if (breadcrumbs.value.length <= 2) return [];

    return breadcrumbs.value.slice(0, -1);
  });

  return {
    breadcrumbs,
    currentBreadcrumb,
    parentBreadcrumb,
    mobileOverflowBreadcrumbs,
  };
}

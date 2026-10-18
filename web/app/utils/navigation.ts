import type { NavigationBadge, NavigationItem } from '~~/types';

const BADGE_VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'success',
  'warning',
  'outline',
] as const;

/** Narrows arbitrary frontmatter to a variant the Badge component accepts. */
export function badgeVariant(value: unknown): NavigationBadge['variant'] {
  return BADGE_VARIANTS.find((variant) => variant === value);
}

function text(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Badges declared on a navigation entry. Navigation nodes carry arbitrary
 * frontmatter under an `unknown` index signature, so the shape is checked here
 * rather than assumed at each template that renders them.
 */
export function navigationBadges(item?: NavigationItem | null): NavigationBadge[] {
  const badges = item?.navBadges;
  if (!Array.isArray(badges)) return [];

  return badges.flatMap((badge) => {
    if (typeof badge !== 'object' || badge === null || Array.isArray(badge)) return [];
    const source: Record<string, unknown> = { ...badge };
    const value = text(source, 'value');
    if (value === undefined) return [];
    return [
      {
        value,
        variant: badgeVariant(source.variant),
        type: text(source, 'type'),
        size: text(source, 'size'),
      },
    ];
  });
}

export const flattenNavigation = (items?: NavigationItem[]): NavigationItem[] =>
  items?.flatMap((item) => (item.children ? flattenNavigation(item.children) : [item])) || [];

/**
 * Transform navigation data by stripping locale and docs levels
 */
export function transformNavigation(
  data: NavigationItem[],
  isI18nEnabled: boolean,
  locale?: string,
): NavigationItem[] {
  if (isI18nEnabled && locale) {
    // i18n: first strip locale level, then check for docs level
    const localeResult = data.find((item) => item.path === `/${locale}`)?.children || data;
    return localeResult.find((item) => item.path === `/${locale}/docs`)?.children || localeResult;
  } else {
    // non-i18n: strip docs level if exists
    return data.find((item) => item.path === '/docs')?.children || data;
  }
}

export interface PageBreadcrumbItem {
  title: string;
  path: string;
}

/**
 * Find breadcrumb path to a page in the navigation tree
 */
export function findPageBreadcrumbs(
  navigation: NavigationItem[] | undefined,
  path: string,
  currentPath: PageBreadcrumbItem[] = [],
): PageBreadcrumbItem[] | undefined {
  if (!navigation) return undefined;

  for (const item of navigation) {
    const itemPath = [...currentPath, { title: item.title, path: item.path }];

    if (item.path === path) {
      return itemPath;
    }

    if (item.children) {
      const found = findPageBreadcrumbs(item.children, path, itemPath);
      if (found) return found;
    }
  }

  return undefined;
}

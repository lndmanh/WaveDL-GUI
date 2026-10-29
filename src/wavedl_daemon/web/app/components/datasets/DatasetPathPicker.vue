<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ConnectionSession } from '../../lib/connection-session';
import { CatalogApi, type BrowsePage, type DataSelection } from '../../lib/catalog-api';

const { t } = useI18n({ useScope: 'global' });
const props = withDefaults(
  defineProps<{
    session: ConnectionSession;
    allowDirectory?: boolean;
    label?: string;
    /** The current choice, marked in the listing when its folder is open. */
    selected?: DataSelection | null;
  }>(),
  { allowDirectory: false, selected: null },
);
const emit = defineEmits<{ select: [selection: DataSelection] }>();

type BrowseMessage = '' | 'datasets.browseUnavailable' | 'datasets.chooseFile';
type SearchOption = {
  id: string;
  label: string;
  detail: string;
  kind: 'root' | 'directory' | 'file';
  root: string;
  path: string;
};

const id = useId();
const roots = shallowRef<readonly string[]>([]);
const page = shallowRef<BrowsePage | null>(null);
const root = shallowRef('');
const path = shallowRef('');
const query = shallowRef('');
const activeIndex = shallowRef(0);
const focused = shallowRef(false);
const busy = shallowRef(false);
const message = shallowRef<BrowseMessage>('');
let revision = 0;
let request: AbortController | null = null;
let unsubscribe: (() => void) | undefined;

const pathParts = computed(() => (path.value ? path.value.split('/') : []));
const suggestions = computed<SearchOption[]>(() => {
  const search = query.value.trim().toLocaleLowerCase();
  const rootOptions = roots.value
    .filter((item) => !search || item.toLocaleLowerCase().includes(search))
    .map((item) => ({
      id: `root:${item}`,
      label: item,
      detail: t('datasets.configuredRoot'),
      kind: 'root' as const,
      root: item,
      path: '',
    }));
  const entryOptions = (page.value?.entries ?? [])
    .filter((entry) => {
      if (!search) return true;
      const entryPath = [path.value, entry.name].filter(Boolean).join('/');
      return `${root.value}/${entryPath}`.toLocaleLowerCase().includes(search);
    })
    .map((entry) => {
      const entryPath = [path.value, entry.name].filter(Boolean).join('/');
      return {
        id: `entry:${root.value}:${entryPath}`,
        label: entry.name,
        detail: entry.kind === 'directory' ? t('datasets.folder') : t('datasets.file'),
        kind: entry.kind,
        root: root.value,
        path: entryPath,
      };
    });
  const ordered = root.value ? [...rootOptions, ...entryOptions] : rootOptions;
  return ordered.slice(0, 24);
});
const label = computed(() => props.label ?? t('datasets.pathPickerTitle'));
const searchId = `${id}-dataset-path-search`;
const optionListId = `${id}-dataset-path-options`;

function cancel() {
  revision++;
  request?.abort();
  request = null;
  busy.value = false;
}

async function work<T>(
  callback: (api: CatalogApi, signal: AbortSignal) => Promise<T>,
  accept: (value: T) => void,
) {
  cancel();
  const current = revision;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  message.value = '';
  try {
    const value = await callback(new CatalogApi(toRaw(props.session)), controller.signal);
    if (current === revision && !controller.signal.aborted) accept(value);
  } catch {
    if (current === revision && !controller.signal.aborted)
      message.value = 'datasets.browseUnavailable';
  } finally {
    if (current === revision) {
      busy.value = false;
      request = null;
    }
  }
}

function browse(nextRoot = root.value, nextPath = path.value, offset = 0) {
  root.value = nextRoot;
  path.value = nextPath;
  query.value = '';
  page.value = null;
  return work(
    (api, signal) => api.browse(nextRoot, nextPath, offset, signal),
    (value) => {
      page.value = value;
    },
  );
}

function loadRoots() {
  roots.value = [];
  page.value = null;
  root.value = '';
  path.value = '';
  query.value = '';
  return work(
    (api, signal) => api.roots(signal),
    (value) => {
      roots.value = value;
    },
  );
}

function child(name: string) {
  return [path.value, name].filter(Boolean).join('/');
}
function up() {
  return browse(root.value, pathParts.value.slice(0, -1).join('/'));
}
function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
}
function isSelected(name: string): boolean {
  return props.selected?.root === root.value && props.selected.relativePath === child(name);
}

function resolvePath(selectedRoot: string, selectedPath: string) {
  return work(
    (api, signal) => api.resolve(selectedRoot, selectedPath, signal),
    (selection) => {
      if (selection.kind === 'directory' && !props.allowDirectory) {
        message.value = 'datasets.chooseFile';
        return;
      }
      emit('select', selection);
      focused.value = false;
    },
  );
}

function choose(option: SearchOption) {
  focused.value = false;
  if (option.kind === 'root') return browse(option.root, '');
  if (option.kind === 'directory') return browse(option.root, option.path);
  return resolvePath(option.root, option.path);
}

function chooseTypedPath() {
  const typed = query.value.trim();
  const matchingRoot = roots.value.find((item) => item === typed);
  if (matchingRoot) return browse(matchingRoot, '');
  if (!root.value || !typed) return;
  const prefix = `${root.value}/`;
  const selectedPath = typed.startsWith(prefix) ? typed.slice(prefix.length) : typed;
  if (!selectedPath) return browse(root.value, '');
  focused.value = false;
  return work(
    (api, signal) => api.resolve(root.value, selectedPath, signal),
    (selection) => {
      if (selection.kind === 'directory' && !props.allowDirectory) {
        void browse(root.value, selectedPath);
      } else emit('select', selection);
    },
  );
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' && suggestions.value.length) {
    event.preventDefault();
    focused.value = true;
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length;
  } else if (event.key === 'ArrowUp' && suggestions.value.length) {
    event.preventDefault();
    focused.value = true;
    activeIndex.value =
      (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const active = focused.value ? suggestions.value[activeIndex.value] : undefined;
    if (active) void choose(active);
    else void chooseTypedPath();
  } else if (event.key === 'Escape') {
    focused.value = false;
  }
}

watch(query, () => {
  activeIndex.value = 0;
});
watch(
  () => toRaw(props.session),
  (session) => {
    unsubscribe?.();
    cancel();
    roots.value = [];
    page.value = null;
    root.value = '';
    path.value = '';
    let scope = -1;
    let connected = false;
    unsubscribe = session.subscribe((state) => {
      if (state.revision === scope && connected && state.status === 'connected') return;
      scope = state.revision;
      connected = state.status === 'connected';
      cancel();
      roots.value = [];
      page.value = null;
      root.value = '';
      path.value = '';
      query.value = '';
      if (state.status === 'connected') void loadRoots();
      else if (state.status !== 'disconnected') message.value = 'datasets.browseUnavailable';
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  unsubscribe?.();
  cancel();
});
</script>

<template>
  <section class="path-browser" :aria-label="label">
    <div class="path-browser-search">
      <div class="relative min-w-0 flex-1">
        <Search class="path-browser-search-icon" aria-hidden="true" />
        <Input
          :id="searchId"
          v-model="query"
          role="combobox"
          class="h-10 rounded-xl bg-surface pl-9"
          :aria-label="t('datasets.searchRootsAndPaths')"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-controls="optionListId"
          :aria-expanded="focused && suggestions.length > 0"
          :aria-activedescendant="
            focused && suggestions[activeIndex]
              ? `${id}-dataset-path-option-${activeIndex}`
              : undefined
          "
          :placeholder="t('datasets.searchRootsPlaceholder')"
          :disabled="busy || !roots.length"
          data-testid="dataset-path-search"
          @focus="focused = true"
          @blur="focused = false"
          @keydown="keydown"
        />
        <ul
          v-if="focused && suggestions.length"
          :id="optionListId"
          role="listbox"
          class="path-browser-suggestions"
          :aria-label="t('datasets.searchResults')"
        >
          <li v-for="(option, index) in suggestions" :key="option.id" role="presentation">
            <button
              :id="`${id}-dataset-path-option-${index}`"
              type="button"
              role="option"
              :aria-selected="index === activeIndex"
              :data-value="option.kind === 'root' ? option.root : `${option.root}/${option.path}`"
              class="path-browser-suggestion"
              @mousedown.prevent
              @mouseenter="activeIndex = index"
              @click="choose(option)"
            >
              <HardDrive v-if="option.kind === 'root'" class="path-browser-kind" aria-hidden="true" />
              <Folder v-else-if="option.kind === 'directory'" class="path-browser-kind" data-kind="directory" aria-hidden="true" />
              <File v-else class="path-browser-kind" data-kind="file" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ option.detail }}</span>
            </button>
          </li>
        </ul>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="rounded-xl"
        :disabled="busy"
        :aria-label="t('datasets.reloadRoots')"
        :title="t('datasets.reloadRoots')"
        @click="loadRoots"
      >
        <RefreshCw aria-hidden="true" />
      </Button>
    </div>

    <div v-if="root && roots.length > 1" class="path-browser-roots" role="group" :aria-label="t('datasets.locations')">
      <button
        v-for="item in roots"
        :key="item"
        type="button"
        class="path-browser-root"
        :data-active="item === root"
        :aria-pressed="item === root"
        :disabled="busy"
        @click="browse(item, '')"
      >
        <HardDrive aria-hidden="true" />{{ item }}
      </button>
    </div>

    <div class="path-browser-pane">
      <div v-if="root" class="path-browser-bar">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="busy || !pathParts.length"
          :aria-label="t('datasets.upOneFolder')"
          :title="t('datasets.upOneFolder')"
          @click="up"
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Breadcrumb class="min-w-0 flex-1" :aria-label="t('datasets.pathBreadcrumb')">
          <BreadcrumbList class="flex-nowrap gap-0.5 overflow-x-auto sm:gap-0.5">
            <BreadcrumbItem>
              <button
                v-if="pathParts.length"
                type="button"
                class="path-browser-crumb"
                :disabled="busy"
                @click="browse(root, '')"
              >
                <HardDrive aria-hidden="true" />{{ root }}
              </button>
              <BreadcrumbPage v-else class="path-browser-crumb" data-current>
                <HardDrive aria-hidden="true" />{{ root }}
              </BreadcrumbPage>
            </BreadcrumbItem>
            <template v-for="(part, index) in pathParts" :key="`${index}-${part}`">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <button
                  v-if="index < pathParts.length - 1"
                  type="button"
                  class="path-browser-crumb"
                  :disabled="busy"
                  @click="browse(root, pathParts.slice(0, index + 1).join('/'))"
                >
                  {{ part }}
                </button>
                <BreadcrumbPage v-else class="path-browser-crumb" data-current>{{ part }}</BreadcrumbPage>
              </BreadcrumbItem>
            </template>
          </BreadcrumbList>
        </Breadcrumb>
        <LoaderCircle v-if="busy" class="size-4 flex-none animate-spin text-muted-foreground" aria-hidden="true" />
      </div>

      <p v-if="busy" role="status" class="sr-only">{{ t('datasets.browseLoading') }}</p>
      <Alert v-if="message" role="alert" variant="warning" class="m-3 w-auto text-sm">
        <AlertDescription>{{ t(message) }}</AlertDescription>
      </Alert>

      <div v-if="busy && !page && !roots.length" class="flex flex-col gap-1.5 p-3" aria-hidden="true">
        <Skeleton v-for="index in 4" :key="index" class="h-9 w-full rounded-lg" />
      </div>
      <div v-else-if="!roots.length && !busy && !message" role="status" class="path-browser-empty">
        <HardDrive aria-hidden="true" />
        <p>{{ t('datasets.noRoots') }}</p>
      </div>
      <!-- No location open yet: the locations themselves are the first listing. -->
      <ul v-else-if="!root && roots.length" class="path-browser-list" :aria-label="t('datasets.locations')">
        <li v-for="item in roots" :key="item">
          <button type="button" class="path-browser-row" :disabled="busy" @click="browse(item, '')">
            <span class="path-browser-icon" data-kind="root"><HardDrive aria-hidden="true" /></span>
            <span class="path-browser-name">{{ item }}</span>
            <ChevronRight class="path-browser-chevron" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <div v-else-if="busy && !page" class="flex flex-col gap-1.5 p-3" aria-hidden="true">
        <Skeleton v-for="index in 5" :key="index" class="h-9 w-full rounded-lg" />
      </div>
      <div v-else-if="page && !page.entries.length && !busy" role="status" class="path-browser-empty">
        <FolderOpen aria-hidden="true" />
        <p>{{ t('datasets.emptyDirectory') }}</p>
      </div>
      <ul v-if="root && page?.entries.length" class="path-browser-list" :aria-label="t('datasets.entries')">
        <li v-for="entry in page.entries" :key="entry.name" class="flex items-center gap-1">
          <button
            v-if="entry.kind === 'directory'"
            type="button"
            class="path-browser-row"
            :disabled="busy"
            @click="browse(root, child(entry.name))"
          >
            <span class="path-browser-icon" data-kind="directory"><Folder aria-hidden="true" /></span>
            <span class="path-browser-name">{{ entry.name }}</span>
            <ChevronRight class="path-browser-chevron" aria-hidden="true" />
          </button>
          <button
            v-else
            type="button"
            class="path-browser-row"
            :data-selected="isSelected(entry.name) || undefined"
            :disabled="busy"
            :aria-label="
              t('datasets.selectEntry', { kind: t('datasets.file'), name: entry.name })
            "
            @click="resolvePath(root, child(entry.name))"
          >
            <span class="path-browser-icon" data-kind="file"><File aria-hidden="true" /></span>
            <span class="path-browser-name">{{ entry.name }}</span>
            <span v-if="extension(entry.name)" class="path-browser-ext">{{ extension(entry.name) }}</span>
            <Check v-if="isSelected(entry.name)" class="path-browser-check" aria-hidden="true" />
            <span v-else class="path-browser-use">{{ t('datasets.use') }}</span>
          </button>
          <Button
            v-if="entry.kind === 'directory' && allowDirectory"
            type="button"
            variant="ghost"
            size="sm"
            :disabled="busy"
            :aria-label="t('datasets.selectEntry', { kind: t('datasets.folder'), name: entry.name })"
            @click="resolvePath(root, child(entry.name))"
          >
            {{ t('datasets.selectKind', { kind: t('datasets.folder') }) }}
          </Button>
        </li>
      </ul>
      <div v-if="page && page.total > page.limit" class="path-browser-pages">
        <span class="text-xs text-muted-foreground tabular-nums">
          {{
            t('datasets.entryCount', {
              start: page.offset + 1,
              end: page.offset + page.entries.length,
              total: page.total,
            })
          }}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="busy || page.offset === 0"
          :aria-label="t('datasets.previousEntries')"
          @click="browse(root, path, Math.max(0, page.offset - page.limit))"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="busy || page.offset + page.limit >= page.total"
          :aria-label="t('datasets.nextEntries')"
          @click="browse(root, path, page.offset + page.limit)"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <p class="path-browser-safety">
        <ShieldCheck aria-hidden="true" />{{ t('datasets.browseSafety') }}
      </p>
      <Button
        v-if="allowDirectory && page"
        type="button"
        variant="outline"
        size="sm"
        :disabled="busy"
        data-testid="dataset-select-directory"
        @click="resolvePath(root, path)"
      >
        {{ t('datasets.selectDirectory') }}
      </Button>
      <Button v-if="busy" type="button" variant="ghost" size="sm" @click="cancel">
        {{ t('datasets.stopBrowsing') }}
      </Button>
    </div>
  </section>
</template>
<style>
.path-browser {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.75rem;
}
.path-browser-search {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.path-browser-search-icon {
  position: absolute;
  top: 50%;
  left: 0.75rem;
  width: 1rem;
  height: 1rem;
  color: var(--muted-foreground);
  pointer-events: none;
  transform: translateY(-50%);
}
.path-browser-suggestions {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  left: 0;
  z-index: 30;
  max-height: 18rem;
  overflow-y: auto;
  padding: 0.35rem;
  border-radius: 0.9rem;
  background: var(--popover);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 14%, transparent),
    0 18px 40px -16px rgb(0 0 0 / 0.35);
}
.path-browser-suggestion {
  display: flex;
  width: 100%;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.55rem;
  font-size: 0.85rem;
  text-align: left;
}
.path-browser-suggestion[aria-selected='true'] {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
.path-browser-kind {
  width: 1rem;
  height: 1rem;
  flex: none;
  color: var(--muted-foreground);
}
.path-browser-kind[data-kind='directory'] {
  color: #3b82f6;
}
.path-browser-roots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.path-browser-root {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
.path-browser-root svg {
  width: 0.85rem;
  height: 0.85rem;
}
.path-browser-root:hover {
  background: color-mix(in srgb, var(--foreground) 9%, transparent);
}
.path-browser-root[data-active='true'] {
  color: var(--primary-foreground);
  background: var(--primary);
}
.path-browser-pane {
  overflow: hidden;
  border-radius: 0.9rem;
  background: var(--surface);
  box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--foreground) 13%, transparent);
}
.path-browser-bar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem 0.35rem 0.35rem;
  border-bottom: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
  background: color-mix(in srgb, var(--foreground) 2.5%, transparent);
}
.path-browser-crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.45rem;
  border-radius: 0.45rem;
  font-size: 0.8rem;
  white-space: nowrap;
}
.path-browser-crumb svg {
  width: 0.8rem;
  height: 0.8rem;
}
button.path-browser-crumb:hover {
  background: color-mix(in srgb, var(--foreground) 7%, transparent);
}
.path-browser-crumb[data-current] {
  font-weight: 600;
}
.path-browser-list {
  display: flex;
  max-height: 22rem;
  flex-direction: column;
  overflow-y: auto;
  padding: 0.35rem;
}
.path-browser-row {
  display: flex;
  width: 100%;
  min-height: 2.6rem;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.7rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.6rem;
  font-size: 0.875rem;
  text-align: left;
  transition: background-color 120ms ease;
}
.path-browser-row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.path-browser-row:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.path-browser-row[data-selected] {
  background: color-mix(in srgb, var(--primary) 11%, transparent);
}
.path-browser-icon {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  place-items: center;
  border-radius: 0.5rem;
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.path-browser-icon svg {
  width: 0.95rem;
  height: 0.95rem;
}
.path-browser-icon[data-kind='directory'] {
  color: #3b82f6;
  background: color-mix(in srgb, #3b82f6 13%, transparent);
}
.path-browser-icon[data-kind='file'] {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 13%, transparent);
}
.path-browser-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-browser-ext {
  flex: none;
  padding: 0.05rem 0.4rem;
  border-radius: 0.35rem;
  color: var(--muted-foreground);
  font-size: 0.65rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
}
.path-browser-chevron {
  width: 0.95rem;
  height: 0.95rem;
  flex: none;
  color: var(--muted-foreground);
}
.path-browser-use {
  flex: none;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 600;
  opacity: 0;
  transition: opacity 120ms ease;
}
.path-browser-row:hover .path-browser-use,
.path-browser-row:focus-visible .path-browser-use {
  opacity: 1;
}
@media (hover: none) {
  .path-browser-use {
    opacity: 1;
  }
}
.path-browser-check {
  width: 1rem;
  height: 1rem;
  flex: none;
  color: var(--primary);
  stroke-width: 2.5;
}
.path-browser-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.25rem 1rem;
  color: var(--muted-foreground);
  font-size: 0.85rem;
  text-align: center;
}
.path-browser-empty svg {
  width: 1.6rem;
  height: 1.6rem;
  opacity: 0.6;
}
.path-browser-pages {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  padding: 0.3rem 0.5rem;
  border-top: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
}
.path-browser-safety {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: 0.35rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}
.path-browser-safety svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
}
</style>

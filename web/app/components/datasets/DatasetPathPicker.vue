<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ConnectionSession } from '../../lib/connection-session';
import { CatalogApi, type BrowsePage, type DataSelection } from '../../lib/catalog-api';

const { t } = useI18n({ useScope: 'global' });
const props = withDefaults(
  defineProps<{ session: ConnectionSession; allowDirectory?: boolean; label?: string }>(),
  { allowDirectory: false },
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
  <section class="flex min-w-0 flex-col gap-4" :aria-label="label">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2>{{ label }}</h2>
      <Button variant="outline" size="sm" :disabled="busy" @click="loadRoots">
        {{ t('datasets.reloadRoots') }}
      </Button>
    </div>
    <Field>
      <FieldLabel :for="searchId">{{ t('datasets.searchRootsAndPaths') }}</FieldLabel>
      <Input
        :id="searchId"
        v-model="query"
        role="combobox"
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
        class="max-h-60 overflow-auto rounded-lg border bg-popover p-1"
        :aria-label="t('datasets.searchResults')"
      >
        <li v-for="(option, index) in suggestions" :key="option.id" role="presentation">
          <button
            :id="`${id}-dataset-path-option-${index}`"
            type="button"
            role="option"
            :aria-selected="index === activeIndex"
            :data-value="option.kind === 'root' ? option.root : `${option.root}/${option.path}`"
            class="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @mousedown.prevent
            @click="choose(option)"
          >
            <span class="min-w-0 truncate">{{ option.label }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ option.detail }}</span>
          </button>
        </li>
      </ul>
      <p class="text-sm text-muted-foreground">{{ t('datasets.browseSafety') }}</p>
    </Field>
    <Breadcrumb v-if="root" :aria-label="t('datasets.pathBreadcrumb')">
      <BreadcrumbList>
        <BreadcrumbItem>
          <Button
            v-if="pathParts.length"
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="browse(root, '')"
            >{{ root }}</Button
          >
          <BreadcrumbPage v-else>{{ root }}</BreadcrumbPage>
        </BreadcrumbItem>
        <template v-for="(part, index) in pathParts" :key="`${index}-${part}`">
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Button
              v-if="index < pathParts.length - 1"
              variant="ghost"
              size="sm"
              :disabled="busy"
              @click="browse(root, pathParts.slice(0, index + 1).join('/'))"
              >{{ part }}</Button
            >
            <BreadcrumbPage v-else>{{ part }}</BreadcrumbPage>
          </BreadcrumbItem>
        </template>
      </BreadcrumbList>
    </Breadcrumb>
    <p v-if="busy" role="status" class="sr-only">{{ t('datasets.browseLoading') }}</p>
    <Alert v-if="message" role="alert" class="text-sm">
      <AlertDescription>{{ t(message) }}</AlertDescription>
    </Alert>
    <Skeleton v-if="busy && !page" class="h-24 w-full" />
    <Empty v-else-if="!roots.length && !busy && !message">
      <EmptyDescription>{{ t('datasets.noRoots') }}</EmptyDescription>
    </Empty>
    <Empty v-else-if="page && !page.entries.length && !busy">
      <EmptyDescription>{{ t('datasets.emptyDirectory') }}</EmptyDescription>
    </Empty>
    <ul v-if="page?.entries.length" class="flex flex-col gap-2" :aria-label="t('datasets.entries')">
      <li
        v-for="entry in page.entries"
        :key="entry.name"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
      >
        <Button
          v-if="entry.kind === 'directory'"
          variant="ghost"
          :disabled="busy"
          @click="browse(root, child(entry.name))"
        >
          {{ entry.name }}
        </Button>
        <span v-else class="min-w-0 break-all text-sm">{{ entry.name }}</span>
        <Button
          v-if="entry.kind === 'file' || allowDirectory"
          variant="outline"
          size="sm"
          :disabled="busy"
          :aria-label="
            t('datasets.selectEntry', {
              kind: t(entry.kind === 'file' ? 'datasets.file' : 'datasets.folder'),
              name: entry.name,
            })
          "
          @click="resolvePath(root, child(entry.name))"
        >
          {{
            t('datasets.selectKind', {
              kind: t(entry.kind === 'file' ? 'datasets.file' : 'datasets.folder'),
            })
          }}
        </Button>
      </li>
    </ul>
    <div v-if="page && page.total > page.limit" class="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        :disabled="busy || page.offset === 0"
        @click="browse(root, path, Math.max(0, page.offset - page.limit))"
      >
        {{ t('datasets.previousEntries') }}
      </Button>
      <span class="text-sm text-muted-foreground">
        {{
          t('datasets.entryCount', {
            start: page.offset + 1,
            end: page.offset + page.entries.length,
            total: page.total,
          })
        }}
      </span>
      <Button
        variant="outline"
        size="sm"
        :disabled="busy || page.offset + page.limit >= page.total"
        @click="browse(root, path, page.offset + page.limit)"
      >
        {{ t('datasets.nextEntries') }}
      </Button>
    </div>
    <Button
      v-if="allowDirectory && page"
      variant="outline"
      class="self-start"
      :disabled="busy"
      data-testid="dataset-select-directory"
      @click="resolvePath(root, path)"
    >
      {{ t('datasets.selectDirectory') }}
    </Button>
    <Button v-if="busy" variant="outline" class="self-start" @click="cancel">
      {{ t('datasets.stopBrowsing') }}
    </Button>
  </section>
</template>

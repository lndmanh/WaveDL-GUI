<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field, FieldLabel } from '@/components/ui/field';
import type { ConnectionSession } from '../../lib/connection-session';
import { CatalogApi, type BrowsePage, type DataSelection } from '../../lib/catalog-api';
import BrowseEntries from './BrowseEntries.vue';
import { catalogMessages } from '../../i18n/catalog';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
const props = withDefaults(
  defineProps<{ session: ConnectionSession; allowDirectory?: boolean; label?: string }>(),
  { allowDirectory: false, label: 'Daemon files' },
);
const emit = defineEmits<{ select: [selection: DataSelection] }>();
const { t, translateKnownMessage } = useWorkstationI18n(catalogMessages);
const displayLabel = computed(() => translateKnownMessage(props.label));
const rootControlId = useId();
const roots = shallowRef<readonly string[]>([]);
const page = shallowRef<BrowsePage | null>(null);
const root = shallowRef('');
const path = shallowRef('');
const busy = shallowRef(false);
const message = shallowRef('');
let revision = 0;
let request: AbortController | null = null;
let unsubscribe: (() => void) | undefined;
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
  request = new AbortController();
  busy.value = true;
  message.value = '';
  try {
    const value = await callback(new CatalogApi(toRaw(props.session)), request.signal);
    if (current === revision) accept(value);
  } catch {
    if (current === revision)
      message.value =
        'Catalogue unavailable. Verify your connection or choose another allowed location.';
  } finally {
    if (current === revision) {
      busy.value = false;
      request = null;
    }
  }
}
function browse(nextRoot = root.value, nextPath = path.value, offset = 0) {
  page.value = null;
  root.value = nextRoot;
  path.value = nextPath;
  return work(
    (api, signal) => api.browse(nextRoot, nextPath, offset, signal),
    (value) => {
      page.value = value;
    },
  );
}
function child(name: string) {
  return path.value ? `${path.value}/${name}` : name;
}
function loadRoots() {
  page.value = null;
  root.value = '';
  path.value = '';
  return work(
    (api, signal) => api.roots(signal),
    (value) => {
      roots.value = value;
    },
  );
}
function select(name?: string) {
  const selectedPath = name === undefined ? path.value : child(name);
  return work(
    (api, signal) => api.resolve(root.value, selectedPath, signal),
    (value) => {
      if (value.kind === 'directory' && !props.allowDirectory) {
        message.value = 'Choose a file, not a directory.';
        return;
      }
      emit('select', value);
    },
  );
}
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
      if (state.status === 'connected') {
        message.value = '';
        void work(
          (api, signal) => api.roots(signal),
          (value) => {
            roots.value = value;
          },
        );
      } else if (state.status !== 'disconnected')
        message.value =
          'Catalogue unavailable. Verify your connection or choose another allowed location.';
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
  <section class="flex flex-col gap-4" :aria-label="displayLabel">
    <h2>{{ displayLabel }}</h2>
    <p>{{ t('browseSafety') }}</p>
    <p v-if="!busy && !roots.length && !message" role="status">
      {{ t('noRoots') }}
    </p>
    <Field>
      <FieldLabel :for="rootControlId">{{ t('root') }}</FieldLabel>
      <Select
        :model-value="root"
        :disabled="busy || !roots.length"
        @update:model-value="(value) => browse(String(value), '')"
      >
        <SelectTrigger :id="rootControlId" :aria-label="t('root')"
          ><SelectValue :placeholder="t('chooseRoot')"
        /></SelectTrigger>
        <SelectContent
          ><SelectGroup
            ><SelectItem v-for="id in roots" :key="id" :value="id">{{
              id
            }}</SelectItem></SelectGroup
          ></SelectContent
        >
      </Select>
    </Field>
    <Alert v-if="message" role="alert"
      ><AlertTitle>{{ t('browseStatus') }}</AlertTitle
      ><AlertDescription>{{ translateKnownMessage(message) }}</AlertDescription></Alert
    >
    <p v-if="busy" role="status">{{ t('readingCatalog') }}</p>
    <div v-if="root" class="flex flex-wrap items-center gap-3">
      <p>{{ root }} / {{ path }}</p>
      <Button
        variant="outline"
        :disabled="busy || !path"
        @click="browse(root, path.split('/').slice(0, -1).join('/'))"
        >{{ t('parent') }}</Button
      >
      <Button v-if="allowDirectory" variant="outline" :disabled="busy || !page" @click="select()">{{
        t('selectDirectory')
      }}</Button>
      <Button variant="outline" :disabled="busy" @click="browse()">{{
        t('refreshDirectory')
      }}</Button>
    </div>
    <BrowseEntries
      v-if="page"
      :page="page"
      :busy="busy"
      :allow-directory="allowDirectory"
      @open="(name) => browse(root, child(name))"
      @select="select"
      @page="(offset) => browse(root, path, offset)"
    />
    <Button v-if="busy" variant="outline" @click="cancel">{{ t('stopBrowsing') }}</Button>
    <Button v-else variant="outline" class="self-start" @click="loadRoots">{{
      t('reloadRoots')
    }}</Button>
  </section>
</template>

<script setup lang="ts">
import { Database, Info, Palette, SlidersHorizontal } from '@lucide/vue';
import type { AppearancePreferences } from '../../lib/preferences';
import { settingsSectionMessageKeys } from '../../i18n/dynamic-keys';

const props = defineProps<{ daemonId: string | null; appearance?: AppearancePreferences }>();
const emit = defineEmits<{ appearanceChanged: [value: AppearancePreferences] }>();
const { t } = useI18n({ useScope: 'global' });
const route = useRoute();
const router = useRouter();
const sections = [
  { id: 'general', label: settingsSectionMessageKeys.general, icon: Palette },
  { id: 'training', label: settingsSectionMessageKeys.training, icon: SlidersHorizontal },
  { id: 'storage', label: settingsSectionMessageKeys.storage, icon: Database },
  { id: 'about', label: settingsSectionMessageKeys.about, icon: Info },
];
const activeSection = computed(() => sections.find((section) => section.id === route.query.section)?.id ?? 'general');
const selectId = useId();

function selectSection(value: unknown): void {
  if (typeof value !== 'string' || !sections.some((section) => section.id === value)) return;
  void router.replace({ query: { ...route.query, section: value } });
}
</script>

<template>
  <div class="mx-auto grid w-full max-w-6xl min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
    <aside>
      <div class="lg:hidden">
        <FieldLabel :for="selectId" class="mb-2">{{ t('shell.settingsSection') }}</FieldLabel>
        <Select :model-value="activeSection" @update:model-value="selectSection">
          <SelectTrigger :id="selectId" class="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="section in sections" :key="section.id" :value="section.id" class="min-h-11">{{ t(section.label) }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <nav :aria-label="t('shell.settingsSection')" class="sticky top-0 hidden flex-col gap-1 lg:flex">
        <Button
          v-for="section in sections"
          :key="section.id"
          as-child
          :variant="activeSection === section.id ? 'secondary' : 'ghost'"
          class="min-h-11 w-full justify-start gap-3"
        >
          <NuxtLink :to="{ query: { ...route.query, section: section.id } }" replace :aria-current="activeSection === section.id ? 'page' : undefined">
            <component :is="section.icon" class="size-4 shrink-0" aria-hidden="true" />
            {{ t(section.label) }}
          </NuxtLink>
        </Button>
        <p class="px-3 pt-5 text-xs leading-relaxed text-muted-foreground">{{ t('shell.settingsAutosaveHelp') }}</p>
      </nav>
    </aside>
    <div class="min-w-0 pb-6">
      <AppearanceSettings v-if="activeSection === 'general'" :appearance="props.appearance" @changed="emit('appearanceChanged', $event)" />
      <TrainingDefaultsSettings v-else-if="activeSection === 'training'" :key="daemonId ?? 'disconnected'" :daemon-id="daemonId" />
      <DataStorageSettings v-else-if="activeSection === 'storage'" :key="daemonId ?? 'disconnected'" :daemon-id="daemonId" @cleared="emit('appearanceChanged', $event)" />
      <AboutSettings v-else />
    </div>
  </div>
</template>

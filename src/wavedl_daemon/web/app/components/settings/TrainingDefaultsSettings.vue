<script setup lang="ts">
import { useForm } from 'vee-validate';
import { Search, Unplug } from '@lucide/vue';
import {
  loadTrainingPreferences,
  saveTrainingPreferences,
  resetTrainingPreferences,
  defaultTrainingPreferences,
  trainingPreferenceFields,
} from '../../lib/preferences';
import { trainingDefaultsFormSchema } from '../../../shared/schemas/settings';
import { essentialTrainingFields, trainingSections } from '../../lib/training-layout';
import { trainingFieldMessageKeys, trainingSectionMessageKeys } from '../../i18n/dynamic-keys';

const props = defineProps<{ daemonId: string | null }>();
const { t } = useI18n({ useScope: 'global' });
const search = shallowRef('');
const searchId = useId();
const { values, resetForm } = useForm({
  validationSchema: trainingDefaultsFormSchema,
  initialValues: {
    config: props.daemonId ? loadTrainingPreferences(props.daemonId) : defaultTrainingPreferences(),
  },
  keepValuesOnUnmount: true,
});

const autosave = useAutosaveForm({
  schema: trainingDefaultsFormSchema,
  values: () => values,
  save: (value) => !!props.daemonId && saveTrainingPreferences(props.daemonId, value.config),
});
const { status } = autosave;

watch(
  () => props.daemonId,
  (daemonId) => {
    autosave.cancel();
    resetForm({
      values: {
        config: daemonId ? loadTrainingPreferences(daemonId) : defaultTrainingPreferences(),
      },
    });
  },
);

const groups = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  const matches = (name: string) => {
    const keys = trainingFieldMessageKeys[name];

    return (
      !needle ||
      name.includes(needle) ||
      (keys && t(keys.label).toLocaleLowerCase().includes(needle))
    );
  };
  const sections = [
    {
      id: 'essentials',
      title: t('shell.settingsTrainingEssentials'),
      fields: trainingPreferenceFields.filter(
        (name) => name === 'pretrained' || essentialTrainingFields.some((field) => field === name),
      ),
    },
    ...trainingSections.map((section) => ({
      id: section.id,
      title: t(trainingSectionMessageKeys[section.id]),
      fields: trainingPreferenceFields.filter((name) =>
        section.fields.some((field) => field === name),
      ),
    })),
  ];

  return sections
    .map((section) => ({ ...section, fields: section.fields.filter(matches) }))
    .filter((section) => section.fields.length);
});

function resetDefaults(): void {
  if (!props.daemonId) return;
  autosave.cancel();
  const saved = resetTrainingPreferences(props.daemonId);

  if (saved) resetForm({ values: { config: defaultTrainingPreferences() } });
  autosave.report(saved);
}
</script>

<template>
  <section aria-labelledby="defaults-heading" class="flex flex-col gap-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1.5">
        <h2 id="defaults-heading" class="text-xl font-semibold tracking-tight">
          {{ t('shell.settingsTraining') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('shell.trainingDefaultsSummary') }}</p>
      </div>
      <SettingsSaveStatus :status="status" />
    </header>
    <Empty v-if="!daemonId" class="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Unplug aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{{ t('shell.notConnected') }}</EmptyTitle>
        <EmptyDescription>{{ t('shell.trainingDefaultsDisconnected') }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button as-child class="min-h-11"
          ><NuxtLink to="/login">{{ t('shell.connection') }}</NuxtLink></Button
        >
      </EmptyContent>
    </Empty>
    <template v-else>
      <div class="relative">
        <FieldLabel :for="searchId" class="sr-only">{{
          t('shell.settingsSearchFields')
        }}</FieldLabel>
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          :id="searchId"
          v-model="search"
          type="search"
          :placeholder="t('shell.settingsSearchFields')"
          class="min-h-11 pl-9"
        />
      </div>
      <form class="flex flex-col gap-5" @submit.prevent @focusout="autosave.flush">
        <Card v-for="group in groups" :key="group.id" class="gap-4">
          <CardHeader>
            <CardTitle :id="`defaults-group-${group.id}`" class="text-base">{{
              group.title
            }}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup
              class="grid gap-x-8 gap-y-6 sm:grid-cols-2"
              role="group"
              :aria-labelledby="`defaults-group-${group.id}`"
            >
              <TrainingOptionField
                v-for="name in group.fields"
                :key="name"
                :name="name"
                :disabled="false"
                settings-controls
                @changed="autosave.queue"
              />
            </FieldGroup>
          </CardContent>
        </Card>
        <Empty v-if="!groups.length" class="border">
          <EmptyHeader>
            <EmptyTitle>{{ t('shell.settingsNoFields') }}</EmptyTitle>
            <EmptyDescription>{{ t('shell.settingsNoFieldsHelp') }}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </form>
      <div>
        <SettingsResetDialog
          :label="t('shell.settingsResetDefaults')"
          :description="t('shell.settingsResetTrainingHelp')"
          @confirm="resetDefaults"
        />
      </div>
    </template>
  </section>
</template>

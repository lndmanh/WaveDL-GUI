<script setup lang="ts">
import { Field as VeeField, useForm } from 'vee-validate';
import { CLIENT_BUILD_ID } from '../../lib/build-identity';
import {
  clearDataPreferences,
  clearLocalPreferences,
  loadAppearance,
  loadKeepSignedIn,
} from '../../lib/preferences';
import { dataPreferencesSchema } from '../../../shared/schemas/settings';
import type { AppearancePreferences } from '~~/types/preferences';

const props = defineProps<{ daemonId: string | null }>();
const emit = defineEmits<{ cleared: [appearance: AppearancePreferences] }>();
const { connection } = useWorkstation();
const shellPreferences = useShellPreferencesStore();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { values, resetForm } = useForm({
  validationSchema: dataPreferencesSchema,
  initialValues: { keepSignedIn: loadKeepSignedIn() },
});
const autosave = useAutosaveForm({
  schema: dataPreferencesSchema,
  values: () => values,
  save: (value) => connection.setKeepSignedIn(value.keepSignedIn),
});
const { status } = autosave;

watch(connection.keepSignedIn, (value) => resetForm({ values: { keepSignedIn: value } }));

function change(value: boolean, update: (value: boolean) => void): void {
  update(value);
  autosave.queue(true);
}

function resetPreferences(all: boolean): void {
  const sessionSaved = connection.setKeepSignedIn(false);
  const cleared = all ? clearLocalPreferences(props.daemonId) : clearDataPreferences();

  if (cleared) {
    resetForm({ values: { keepSignedIn: false } });
    shellPreferences.reload();

    if (all) emit('cleared', loadAppearance());
  }

  autosave.report(sessionSaved && cleared);
}
</script>

<template>
  <section aria-labelledby="data-settings-heading" class="flex flex-col gap-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1.5">
        <h2 id="data-settings-heading" class="text-xl font-semibold tracking-tight">
          {{ t('shell.settingsDataStorage') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('shell.preferencesSubtitle') }}</p>
      </div>
      <SettingsSaveStatus :status="status" />
    </header>
    <Card>
      <CardHeader
        ><CardTitle class="text-base">{{
          t('shell.settingsBrowserStorage')
        }}</CardTitle></CardHeader
      >
      <CardContent class="space-y-6">
        <form @submit.prevent>
          <VeeField v-slot="{ field, errors }" name="keepSignedIn">
            <Field orientation="horizontal" :data-invalid="!!errors.length" class="items-center">
              <FieldContent>
                <FieldLabel for="settings-keep-signed-in" class="min-h-11 items-center">{{
                  t('shell.keepMeSignedInOnThisBrowser')
                }}</FieldLabel>
                <FieldDescription id="settings-sign-in-help">{{
                  t('shell.sessionStorageHelp')
                }}</FieldDescription>
                <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
              </FieldContent>
              <Switch
                id="settings-keep-signed-in"
                :model-value="field.value === true"
                aria-describedby="settings-sign-in-help"
                @update:model-value="change($event, field.onChange)"
              />
            </Field>
          </VeeField>
        </form>
        <Separator />
        <dl class="grid gap-5 text-sm sm:grid-cols-2">
          <div class="min-w-0 space-y-1.5">
            <dt class="text-muted-foreground">{{ t('shell.settingsDaemonId') }}</dt>
            <dd class="break-all font-mono text-xs">{{ daemonId ?? t('shell.notConnected') }}</dd>
          </div>
          <div class="min-w-0 space-y-1.5">
            <dt class="text-muted-foreground">{{ t('shell.settingsClientBuild') }}</dt>
            <dd class="break-all font-mono text-xs">{{ CLIENT_BUILD_ID }}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle class="text-base">{{ t('shell.settingsManagePreferences') }}</CardTitle>
        <CardDescription>{{ t('shell.settingsLocalScope') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap gap-3">
        <SettingsResetDialog
          :label="t('shell.settingsResetDefaults')"
          :description="t('shell.settingsResetDataHelp')"
          @confirm="resetPreferences(false)"
        />
        <SettingsResetDialog
          :label="t('shell.settingsResetAll')"
          :description="t('shell.settingsResetAllHelp')"
          @confirm="resetPreferences(true)"
        />
        <SettingsResetDialog
          :label="t('shell.settingsClearLocal')"
          :description="t('shell.settingsClearLocalHelp')"
          @confirm="resetPreferences(true)"
        />
      </CardContent>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppearanceSettings from './AppearanceSettings.vue';
import TrainingDefaultsSettings from './TrainingDefaultsSettings.vue';
import ShellInfo from '../shell/ShellInfo.vue';
import { CLIENT_BUILD_ID } from '../../lib/build-identity';
import type { AppearancePreferences } from '../../lib/preferences';
defineProps<{ daemonId: string | null; appearance?: AppearancePreferences }>();
const emit = defineEmits<{ appearanceChanged: [value: AppearancePreferences] }>();
const { t } = useI18n({ useScope: 'global' });
</script>
<template>
  <div class="flex flex-col gap-8">
    <header>
      <p class="text-muted-foreground">
        {{ t('shell.preferencesSubtitle') }}
      </p>
    </header>
    <AppearanceSettings :appearance="appearance" @changed="emit('appearanceChanged', $event)" />
    <TrainingDefaultsSettings :daemon-id="daemonId" />
    <section aria-labelledby="downloads-heading" class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <h2 id="downloads-heading" class="font-medium">{{ t('shell.downloads') }}</h2>
        <ShellInfo :label="t('shell.downloads')" :text="t('shell.downloadsHelp')" />
      </div>
      <p class="text-sm text-muted-foreground">{{ t('shell.downloadsSummary') }}</p>
    </section>
    <section aria-labelledby="about-heading" class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <h2 id="about-heading" class="font-medium">{{ t('shell.aboutWavedl') }}</h2>
        <ShellInfo :label="t('shell.projectAndFeedback')" :text="t('shell.feedbackPrivacyHelp')" />
      </div>
      <p>{{ t('shell.clientBuildBuildid', { buildId: CLIENT_BUILD_ID }) }}</p>
      <p class="text-sm text-muted-foreground">
        {{ t('shell.aboutDescription') }}
      </p>
      <a
        href="https://github.com/ductho-le/WaveDL"
        target="_blank"
        rel="noopener noreferrer"
        referrerpolicy="no-referrer"
        class="underline"
        >{{ t('shell.projectAndFeedback') }}</a
      >
    </section>
  </div>
</template>

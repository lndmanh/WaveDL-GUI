<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { shellSettingsMessages } from '../../i18n/shell-settings';
import AppearanceSettings from './AppearanceSettings.vue';
import TrainingDefaultsSettings from './TrainingDefaultsSettings.vue';
import { CLIENT_BUILD_ID } from '../../lib/build-identity';
import type { AppearancePreferences } from '../../lib/preferences';
defineProps<{ daemonId: string | null; appearance?: AppearancePreferences }>();
const emit = defineEmits<{ appearanceChanged: [value: AppearancePreferences] }>();
const { t, translateKnownMessage } = useWorkstationI18n(shellSettingsMessages);
</script>
<template>
  <div class="flex flex-col gap-8">
    <header>
      <h1 class="text-2xl font-semibold">{{ translateKnownMessage('Settings') }}</h1>
      <p class="text-muted-foreground">
        {{ translateKnownMessage('Browser preferences, not daemon administration.') }}
      </p>
    </header>
    <AppearanceSettings :appearance="appearance" @changed="emit('appearanceChanged', $event)" />
    <TrainingDefaultsSettings :daemon-id="daemonId" />
    <section aria-labelledby="downloads-heading" class="flex flex-col gap-3">
      <h2 id="downloads-heading" class="font-medium">{{ translateKnownMessage('Downloads') }}</h2>
      <p class="text-sm text-muted-foreground">
        {{
          translateKnownMessage(
            'Your browser chooses where exported files and downloaded artifacts are saved. Use its download settings to change the default folder or ask where to save each file. The workstation cannot set a local filesystem folder.',
          )
        }}
      </p>
    </section>
    <section aria-labelledby="about-heading" class="flex flex-col gap-3">
      <h2 id="about-heading" class="font-medium">{{ translateKnownMessage('About WaveDL') }}</h2>
      <p>{{ t('Client build {buildId}', { buildId: CLIENT_BUILD_ID }) }}</p>
      <p class="text-sm text-muted-foreground">
        {{
          translateKnownMessage(
            'Wave-based deep-learning experiments, planned and executed by your daemon.',
          )
        }}
      </p>
      <a
        href="https://github.com/ductho-le/WaveDL"
        target="_blank"
        rel="noopener noreferrer"
        referrerpolicy="no-referrer"
        class="underline"
        >{{ translateKnownMessage('Project and feedback') }}</a
      >
      <p class="text-sm text-muted-foreground">
        {{
          translateKnownMessage(
            'Do not include access tokens, private paths or training data in public feedback. Application updates require explicit confirmation in the update prompt.',
          )
        }}
      </p>
    </section>
  </div>
</template>

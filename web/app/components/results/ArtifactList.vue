<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import type { Artifact } from '../../lib/artifact-client';
const { t, locale } = useI18n({ useScope: 'global' });
defineProps<{ artifacts: readonly Artifact[]; busy: boolean }>();
defineEmits<{ download: [artifact: Artifact]; preview: [artifact: Artifact] }>();
</script>
<template>
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm">
      <caption class="pb-4 text-left text-muted-foreground">
        {{
          t('results.publications')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('results.generationAttempt') }}</th>
          <th scope="col">{{ t('results.artifact') }}</th>
          <th scope="col">{{ t('results.bytes') }}</th>
          <th scope="col">{{ t('results.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="artifact in artifacts" :key="`${artifact.generation}/${artifact.path}`">
          <td>{{ artifact.generation }} / {{ artifact.attempt }}</td>
          <td class="break-all">{{ artifact.path }}</td>
          <td>{{ artifact.size.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') }}</td>
          <td>
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="busy"
                @click="$emit('download', artifact)"
                >{{ t('results.download') }}</Button
              ><Button
                v-if="artifact.path.endsWith('.png')"
                variant="outline"
                size="sm"
                :disabled="busy"
                @click="$emit('preview', artifact)"
                >{{ t('results.viewPng') }}</Button
              >
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!artifacts.length" class="text-muted-foreground">{{ t('results.noArtifacts') }}</p>
  </div>
</template>

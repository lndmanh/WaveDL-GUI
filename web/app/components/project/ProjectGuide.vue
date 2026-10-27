<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { Button } from '@/components/ui/button';

const { translateKnownMessage } = useWorkstationI18n(projectMessages);
defineProps<{ enabled: boolean; step: number; busy: boolean }>();
defineEmits<{ toggle: []; previous: []; next: [] }>();
const steps = [
  'Dataset',
  'Model',
  'Preset',
  'Training & runtime',
  'Review & approval',
  'Acknowledged',
];
</script>
<template>
  <nav :aria-label="translateKnownMessage('Guided training authoring')" class="flex flex-col gap-4">
    <Button
      type="button"
      variant="outline"
      class="self-start"
      :disabled="busy"
      @click="$emit('toggle')"
      >{{ translateKnownMessage(enabled ? 'Show full editor' : 'Use guided steps') }}</Button
    ><template v-if="enabled"
      ><ol class="flex flex-wrap gap-3">
        <li
          v-for="(label, index) in steps"
          :key="label"
          :aria-current="index === step ? 'step' : undefined"
          :class="index === step ? 'font-medium' : 'text-muted-foreground'"
        >
          {{ index + 1 }}. {{ translateKnownMessage(label) }}
        </li>
      </ol>
      <p>
        {{
          translateKnownMessage(
            "Guided steps share the ordinary editor's draft and validation. Advancing never plans or starts a run.",
          )
        }}
      </p>
      <div class="flex gap-3">
        <Button
          type="button"
          variant="outline"
          :disabled="busy || step === 0"
          @click="$emit('previous')"
          >{{ translateKnownMessage('Previous step') }}</Button
        ><Button
          type="button"
          variant="outline"
          :disabled="busy || step >= 4"
          @click="$emit('next')"
          >{{ translateKnownMessage('Next step') }}</Button
        >
      </div></template
    >
  </nav>
</template>

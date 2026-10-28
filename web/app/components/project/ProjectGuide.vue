<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import { projectGuideMessageKeys } from '../../i18n/dynamic-keys';
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@/components/ui/stepper';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ enabled: boolean; step: number; busy: boolean }>();
const emit = defineEmits<{ toggle: []; previous: []; next: [] }>();
function selectStep(value: number | undefined) {
  if (props.busy || value === undefined) return;
  if (value === props.step + 2 && props.step < 4) emit('next');
  else if (value === props.step && props.step > 0) emit('previous');
}
const steps = projectGuideMessageKeys;
</script>
<template>
  <nav :aria-label="t('project.guidedTrainingAuthoring')" class="flex flex-col gap-4">
    <Button
      type="button"
      variant="outline"
      class="self-start"
      :disabled="busy"
      @click="$emit('toggle')"
      >{{ t(enabled ? 'project.showFullEditor' : 'project.useGuidedSteps') }}</Button
    ><template v-if="enabled"
      ><Stepper
        :model-value="step + 1"
        class="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        data-testid="project-stepper"
        @update:model-value="selectStep"
      >
        <StepperItem
          v-for="(label, index) in steps"
          :key="label"
          :step="index + 1"
          :data-testid="`guide-step-${index}`"
          :aria-current="index === step ? 'step' : undefined"
          :disabled="busy || (index !== step && (Math.abs(index - step) > 1 || index > 4))"
          class="relative flex min-w-0 flex-col items-center"
        >
          <StepperTrigger type="button">
            <StepperIndicator>{{ index + 1 }}.</StepperIndicator>
            <StepperTitle class="whitespace-normal text-center text-xs">{{
              t(label)
            }}</StepperTitle>
          </StepperTrigger>
          <StepperSeparator
            v-if="index < steps.length - 1"
            class="absolute left-1/2 top-4 hidden w-full xl:block"
          />
          <StepperDescription class="sr-only">{{ t(label) }}</StepperDescription>
        </StepperItem>
      </Stepper>
      <p>
        {{ t('project.guideHelp') }}
      </p>
      <div class="flex gap-3">
        <Button
          type="button"
          variant="outline"
          :disabled="busy || step === 0"
          @click="$emit('previous')"
          >{{ t('project.previousStep') }}</Button
        ><Button
          type="button"
          variant="outline"
          :disabled="busy || step >= 4"
          @click="$emit('next')"
          >{{ t('project.nextStep') }}</Button
        >
      </div></template
    >
  </nav>
</template>

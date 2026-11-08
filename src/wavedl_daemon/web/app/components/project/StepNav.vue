<script setup lang="ts">
import { ArrowLeft, ArrowRight, LoaderCircle, Play } from '@lucide/vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  showBack: boolean;
  backDisabled: boolean;
  nextDisabled: boolean;
  nextHint: string;
  final: boolean;
  submitted: boolean;
  startDisabled: boolean;
  busy: boolean;
  connected: boolean;
}>();

const emit = defineEmits<{ back: []; next: []; start: []; open: [] }>();
const { t } = useI18n({ useScope: 'global' });
const hintId = useId();

const primaryDisabled = computed(() =>
  props.final
    ? props.submitted
      ? !props.connected || props.busy
      : props.startDisabled
    : props.nextDisabled,
);

const projectStyles = {
  stepNav: cn(
    'sticky bottom-3 z-10 mt-auto flex items-center justify-end gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4',
    'shadow-[0_-8px_20px_-16px_rgb(0_0_0_/_0.3)]',
  ),
  stepButton: cn('h-10 rounded-lg px-3'),
};
</script>
<template>
  <nav :class="projectStyles.stepNav" :aria-label="t('project.stepNavigation')">
    <Button
      v-if="showBack"
      type="button"
      variant="outline"
      :class="cn(projectStyles.stepButton, 'mr-auto size-10 p-0 sm:w-auto sm:px-3')"
      :disabled="backDisabled"
      :aria-label="t('project.stepBack')"
      @click="emit('back')"
    >
      <ArrowLeft aria-hidden="true" />
      <span class="hidden sm:inline">{{ t('project.stepBack') }}</span>
    </Button>
    <span v-if="final">
      <Button
        type="button"
        :class="projectStyles.stepButton"
        :disabled="primaryDisabled"
        @click="submitted ? emit('open') : emit('start')"
      >
        <LoaderCircle
          v-if="busy"
          class="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <ArrowRight v-else-if="submitted" aria-hidden="true" />
        <Play v-else aria-hidden="true" />
        {{ t(submitted ? 'project.viewRun' : 'project.startTraining') }}
      </Button>
    </span>
    <span v-else :title="nextHint || undefined">
      <Button
        type="button"
        :class="projectStyles.stepButton"
        :disabled="primaryDisabled"
        :aria-describedby="nextHint ? hintId : undefined"
        @click="emit('next')"
      >
        {{ t('project.stepNext') }}
        <ArrowRight aria-hidden="true" />
      </Button>
    </span>
    <p v-if="nextHint" :id="hintId" class="sr-only">{{ nextHint }}</p>
  </nav>
</template>

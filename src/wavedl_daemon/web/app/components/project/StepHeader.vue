<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@lucide/vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  title: string;
  description: string;
  backDisabled: boolean;
  nextDisabled: boolean;
  nextHint: string;
}>();

const emit = defineEmits<{ back: []; next: [] }>();
const { t } = useI18n({ useScope: 'global' });
const heading = useTemplateRef<HTMLHeadingElement>('heading');
const headingId = useId();
const descriptionId = useId();
const hintId = useId();

const describedBy = computed(() =>
  [descriptionId, props.nextHint ? hintId : ''].filter(Boolean).join(' '),
);

function focusHeading() {
  heading.value?.focus({ preventScroll: true });
}

defineExpose({ focusHeading });

const projectStyles = {
  stepHeader: cn(
    'sticky z-10 flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3 sm:gap-6 sm:p-4',
    '[top:calc(var(--run-pipeline-bottom,_0px)_+_0.75rem)]',
    'shadow-[0_8px_20px_-16px_rgb(0_0_0_/_0.3)]',
  ),
  stepTitle: cn(
    'text-lg font-semibold tracking-[-0.02em] outline-none sm:text-[1.45rem]',
    'focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring',
  ),
  stepButton: cn('size-10 rounded-lg sm:w-auto sm:px-3'),
};
</script>
<template>
  <header :class="projectStyles.stepHeader">
    <div class="min-w-0 flex-1">
      <h2
        :id="headingId"
        ref="heading"
        :class="projectStyles.stepTitle"
        :aria-describedby="describedBy"
        tabindex="-1"
      >
        {{ title }}
      </h2>
      <p :id="descriptionId" class="mt-1 max-w-[60ch] text-sm text-muted-foreground">
        {{ description }}
      </p>
      <p v-if="nextHint" :id="hintId" class="sr-only">{{ nextHint }}</p>
    </div>
    <div class="flex flex-none items-center gap-2">
      <Button
        type="button"
        variant="outline"
        :class="projectStyles.stepButton"
        :disabled="backDisabled"
        :aria-label="t('project.stepBack')"
        @click="emit('back')"
      >
        <ArrowLeft aria-hidden="true" />
        <span class="hidden sm:inline">{{ t('project.stepBack') }}</span>
      </Button>
      <span :title="nextHint || undefined">
        <Button
          type="button"
          :class="projectStyles.stepButton"
          :disabled="nextDisabled"
          :aria-label="t('project.stepNext')"
          :aria-describedby="nextHint ? hintId : undefined"
          @click="emit('next')"
        >
          <span class="hidden sm:inline">{{ t('project.stepNext') }}</span>
          <ArrowRight aria-hidden="true" />
        </Button>
      </span>
    </div>
  </header>
</template>

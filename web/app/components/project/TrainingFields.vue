<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { trainingFieldMetadata } from '../../../shared/schemas/training-request';
import { projectTrainingGroupMessageKeys } from '../../i18n/dynamic-keys';
import TrainingOptionField from './TrainingOptionField.vue';

const { t } = useI18n({ useScope: 'global' });
defineProps<{ disabled: boolean }>();
const main = [
  'batch_size',
  'lr',
  'epochs',
  'patience',
  'loss',
  'optimizer',
  'scheduler',
  'precision',
  'compile',
  'deterministic',
  'seed',
  'cv',
  'cv_stratify',
];
const basics = trainingFieldMetadata.filter((option) => main.includes(option.name));
const groups = [
  {
    title: projectTrainingGroupMessageKeys[0],
    names: [
      'weight_decay',
      'grad_clip',
      'grad_accum_steps',
      'huber_delta',
      'loss_weights',
      'momentum',
      'nesterov',
      'betas',
      'scheduler_patience',
      'min_lr',
      'scheduler_factor',
      'warmup_epochs',
      'step_size',
      'milestones',
    ],
  },
  {
    title: projectTrainingGroupMessageKeys[1],
    names: [
      'workers',
      'cache_validate',
      'single_channel',
      'cv_bins',
      'resume',
      'save_every',
      'fresh',
    ],
  },
  {
    title: projectTrainingGroupMessageKeys[2],
    names: [
      'import_modules',
      'pretrained',
      'constraint',
      'constraint_file',
      'constraint_weight',
      'constraint_reduction',
    ],
  },
  {
    title: projectTrainingGroupMessageKeys[3],
    names: ['wandb', 'wandb_watch', 'project_name', 'run_name'],
  },
];
</script>
<template>
  <fieldset class="flex flex-col gap-5">
    <legend class="mb-4 font-medium">{{ t('project.training') }}</legend>
    <div class="grid gap-5 sm:grid-cols-2">
      <TrainingOptionField
        v-for="option in basics"
        :key="option.name"
        :name="option.name"
        :disabled="disabled"
      />
    </div>
    <details v-for="group in groups" :key="group.title" class="border-t pt-4">
      <summary class="cursor-pointer font-medium">{{ t(group.title) }}</summary>
      <div class="mt-5 grid gap-5 sm:grid-cols-2">
        <TrainingOptionField
          v-for="name in group.names"
          :key="name"
          :name="name"
          :disabled="disabled"
        />
      </div>
    </details>
    <p class="text-sm text-muted-foreground">
      {{ t('project.hostPathsHelp') }}
    </p>
  </fieldset>
</template>

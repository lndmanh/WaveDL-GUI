<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { trainingFieldMetadata } from '../../../shared/schemas/training-request';
import TrainingOptionField from './TrainingOptionField.vue';

const { translateKnownMessage } = useWorkstationI18n(projectMessages);
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
    title: 'Optimizer, loss and scheduling',
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
    title: 'Data, checkpoints and cross-validation',
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
    title: 'Custom models and physical constraints',
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
    title: 'Optional experiment logging',
    names: ['wandb', 'wandb_watch', 'project_name', 'run_name'],
  },
];
</script>
<template>
  <fieldset class="flex flex-col gap-5">
    <legend class="mb-4 font-medium">{{ translateKnownMessage('Training') }}</legend>
    <div class="grid gap-5 sm:grid-cols-2">
      <TrainingOptionField
        v-for="option in basics"
        :key="option.name"
        :name="option.name"
        :disabled="disabled"
      />
    </div>
    <details v-for="group in groups" :key="group.title" class="border-t pt-4">
      <summary class="cursor-pointer font-medium">{{ translateKnownMessage(group.title) }}</summary>
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
      {{
        translateKnownMessage(
          'Resume and constraint-file paths belong to the daemon host. Import modules and constraint code run in your selected Python environment. W&B credentials are configured on that host, never stored in this form. Each run uses an isolated cache; this page never deletes previous run data.',
        )
      }}
    </p>
  </fieldset>
</template>

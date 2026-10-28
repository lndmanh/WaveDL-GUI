<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { trainingFieldMetadata } from '../../../shared/schemas/training-request';
import { projectTrainingGroupMessageKeys, trainingFieldMessageKeys } from '../../i18n/dynamic-keys';
import { computed, shallowRef } from 'vue';
import { useFormContext } from 'vee-validate';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InfoChip from '../common/InfoChip.vue';
import TrainingOptionField from './TrainingOptionField.vue';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ disabled: boolean }>();
const { values } = useFormContext<{ config: Record<string, unknown> }>();
const advancedQuery = shallowRef('');
const main = [
  'batch_size',
  'lr',
  'epochs',
  'patience',
  'loss',
  'optimizer',
  'scheduler',
  'precision',
];
const basics = trainingFieldMetadata.filter((option) => main.includes(option.name));
const advancedFields = trainingFieldMetadata.filter((option) => !main.includes(option.name));
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
      'seed',
      'deterministic',
      'cv',
      'cv_stratify',
      'compile',
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
const advancedOptions = computed(() => {
  const query = advancedQuery.value.trim().toLocaleLowerCase();
  return advancedFields.filter((option) => {
    if (!query) return true;
    const keys = trainingFieldMessageKeys[option.name];
    const searchable = `${option.name} ${keys ? t(keys.label) : ''} ${
      keys ? t(keys.description) : ''
    }`.toLocaleLowerCase();
    return searchable.includes(query);
  });
});
const advancedGroups = computed(() =>
  groups
    .map((group) => ({
      ...group,
      options: group.names.flatMap((name) => {
        const option = trainingFieldMetadata.find((item) => item.name === name);
        return option && !main.includes(option.name) ? [option] : [];
      }),
    }))
    .filter((group) => group.options.length),
);
const nonDefaultCount = computed(
  () =>
    advancedFields.filter((option) => {
      const current = values.config?.[option.name];
      return current !== undefined && JSON.stringify(current) !== JSON.stringify(option.default);
    }).length,
);
function matchesAdvanced(name: string): boolean {
  return advancedOptions.value.some((option) => option.name === name);
}
function updateQuery(value: string | number) {
  advancedQuery.value = String(value);
}
</script>
<template>
  <fieldset class="flex flex-col gap-5">
    <legend class="mb-4 font-medium">{{ t('project.training') }}</legend>
    <Tabs default-value="essentials" class="w-full">
      <TabsList class="w-full sm:w-fit">
        <TabsTrigger value="essentials" data-testid="training-tab-essentials">
          {{ t('project.essentials') }}
        </TabsTrigger>
        <TabsTrigger value="advanced" data-testid="training-tab-advanced">
          {{ t('project.advanced') }}
          <Badge v-if="nonDefaultCount > 0" variant="secondary">
            {{ t('project.nonDefaultFields', { count: nonDefaultCount }) }}
          </Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="essentials" :force-mount="true">
        <div class="grid gap-5 pt-4 sm:grid-cols-2">
          <TrainingOptionField
            v-for="option in basics"
            :key="option.name"
            :name="option.name"
            :disabled="props.disabled"
          />
        </div>
      </TabsContent>
      <TabsContent value="advanced" :force-mount="true" class="flex flex-col gap-5 pt-4">
        <Input
          :aria-label="t('project.searchAdvancedLabel')"
          data-testid="training-advanced-search"
          :model-value="advancedQuery"
          :placeholder="t('project.searchAdvanced')"
          @update:model-value="updateQuery"
        />
        <p v-if="!advancedOptions.length" role="status" class="text-sm text-muted-foreground">
          {{ t('project.noAdvancedMatches') }}
        </p>
        <div
          v-for="group in advancedGroups"
          :key="group.title"
          class="border-t pt-4"
          v-show="group.options.some((option) => matchesAdvanced(option.name))"
        >
          <Collapsible :default-open="true">
            <CollapsibleTrigger
              class="flex w-full items-center justify-between text-left font-medium"
            >
              {{ t(group.title) }}
            </CollapsibleTrigger>
            <CollapsibleContent
              :force-mount="true"
              class="data-[state=closed]:hidden grid gap-5 pt-5 sm:grid-cols-2"
            >
              <div
                v-for="option in group.options"
                :key="option.name"
                v-show="matchesAdvanced(option.name)"
                class="contents"
              >
                <TrainingOptionField :name="option.name" :disabled="props.disabled" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </TabsContent>
    </Tabs>
    <p class="text-sm text-muted-foreground">{{ t('project.hostPathsHelp') }}</p>
    <div class="flex flex-wrap gap-2">
      <Badge variant="outline">{{ t('project.hostPathsModules') }}</Badge>
      <Badge variant="outline">{{ t('project.hostPathsCredentials') }}</Badge>
      <Badge variant="outline">{{ t('project.hostPathsCache') }}</Badge>
      <Badge variant="outline">{{ t('project.hostPathsPreserved') }}</Badge>
      <InfoChip :label="t('project.hostPathsSummary')" :text="t('project.hostPathsDetails')" />
    </div>
  </fieldset>
</template>

<style scoped>
:deep([data-slot='tabs-content'][data-state='inactive']) {
  display: none;
}
</style>

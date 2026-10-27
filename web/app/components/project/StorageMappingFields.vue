<script setup lang="ts">
import { computed, useId } from 'vue';
import { Field as VeeField } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from '@/components/ui/field';
import { storageMapSchema, type StorageMapping } from '../../../shared/schemas/storage-mapping';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { storageMappingMessages } from '../../i18n/storage-mapping';

const props = defineProps<{
  mappings?: readonly StorageMapping[];
  backend: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ update: [mappings: StorageMapping[]] }>();
const { t } = useWorkstationI18n(storageMappingMessages);
const id = useId();
const mappings = computed(() => props.mappings ?? []);
const validation = computed(() => storageMapSchema.safeParse(mappings.value));
const issues = computed(() => (validation.value.success ? [] : validation.value.error.issues));
const mapErrors = computed(() =>
  issues.value.some((issue) => issue.path.length === 0) ? [t('mapError')] : [],
);
function rootErrors(index: number, key: keyof StorageMapping): string[] {
  return issues.value.some((issue) => issue.path[0] === index && issue.path[1] === key)
    ? [t('rootError')]
    : [];
}
function rowErrors(index: number): string[] {
  return issues.value.some((issue) => issue.path[0] === index && issue.path.length === 1)
    ? [t('rowError')]
    : [];
}
function add() {
  if (props.disabled || mappings.value.length >= 32) return;
  emit('update', [...mappings.value, { host_root: '', execution_root: '' }]);
}
function update(index: number, key: keyof StorageMapping, value: string | number) {
  if (props.disabled) return;
  emit(
    'update',
    mappings.value.map((mapping, position) =>
      position === index ? { ...mapping, [key]: String(value) } : { ...mapping },
    ),
  );
}
function remove(index: number) {
  if (props.disabled) return;
  emit(
    'update',
    mappings.value
      .filter((_mapping, position) => position !== index)
      .map((mapping) => ({ ...mapping })),
  );
}
</script>

<template>
  <details :open="mappings.length > 0">
    <summary class="cursor-pointer font-medium">{{ t('title') }}</summary>
    <FieldGroup class="mt-4">
      <FieldDescription :id="`${id}-storage-help`">{{ t('guidance') }}</FieldDescription>
      <FieldDescription>{{ t('interpreter') }}</FieldDescription>
      <Alert v-if="backend === 'local' && mappings.length">
        <AlertTitle>{{ t('title') }}</AlertTitle>
        <AlertDescription>{{ t('local') }}</AlertDescription>
      </Alert>
      <FieldDescription v-if="!mappings.length">{{ t('empty') }}</FieldDescription>
      <FieldSet v-for="(mapping, index) in mappings" :key="index">
        <FieldLegend variant="label">{{ t('row', { number: index + 1 }) }}</FieldLegend>
        <FieldGroup>
          <VeeField v-slot="{ field }" :name="`storage_map[${index}].host_root`" :keep-value="true">
            <Field
              :data-invalid="!!rootErrors(index, 'host_root').length"
              :data-disabled="disabled"
            >
              <FieldLabel :for="`${id}-storage-${index}-host`">{{ t('host') }}</FieldLabel>
              <Input
                :id="`${id}-storage-${index}-host`"
                :name="`storage_map[${index}].host_root`"
                :model-value="mapping.host_root"
                :disabled="disabled"
                autocomplete="off"
                :aria-describedby="`${id}-storage-help ${id}-storage-${index}-host-error`"
                :aria-invalid="!!rootErrors(index, 'host_root').length"
                @update:model-value="
                  (value) => {
                    field.onChange(value);
                    update(index, 'host_root', value);
                  }
                "
                @blur="field.onBlur"
              />
              <FieldError
                :id="`${id}-storage-${index}-host-error`"
                :errors="rootErrors(index, 'host_root')"
              />
            </Field>
          </VeeField>
          <VeeField
            v-slot="{ field }"
            :name="`storage_map[${index}].execution_root`"
            :keep-value="true"
          >
            <Field
              :data-invalid="!!rootErrors(index, 'execution_root').length"
              :data-disabled="disabled"
            >
              <FieldLabel :for="`${id}-storage-${index}-execution`">{{
                t('execution')
              }}</FieldLabel>
              <Input
                :id="`${id}-storage-${index}-execution`"
                :name="`storage_map[${index}].execution_root`"
                :model-value="mapping.execution_root"
                :disabled="disabled"
                autocomplete="off"
                :aria-describedby="`${id}-storage-help ${id}-storage-${index}-execution-error`"
                :aria-invalid="!!rootErrors(index, 'execution_root').length"
                @update:model-value="
                  (value) => {
                    field.onChange(value);
                    update(index, 'execution_root', value);
                  }
                "
                @blur="field.onBlur"
              />
              <FieldError
                :id="`${id}-storage-${index}-execution-error`"
                :errors="rootErrors(index, 'execution_root')"
              />
            </Field>
          </VeeField>
          <FieldError :errors="rowErrors(index)" />
          <Button type="button" variant="outline" :disabled="disabled" @click="remove(index)">{{
            t('remove', { number: index + 1 })
          }}</Button>
        </FieldGroup>
      </FieldSet>
      <FieldError :errors="mapErrors" />
      <FieldDescription>{{ t('limit') }}</FieldDescription>
      <Button
        type="button"
        variant="outline"
        :disabled="disabled || mappings.length >= 32"
        @click="add"
        >{{ t('add') }}</Button
      >
    </FieldGroup>
  </details>
</template>

<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { Field as VeeField } from 'vee-validate';
import { shallowRef } from 'vue';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldError } from '@/components/ui/field';
import { reservedRuntimeVariable } from '../../../shared/schemas/training-request';

const { clientMessage } = useClientMessages();
const { t, translateKnownMessage } = useWorkstationI18n(projectMessages);
const props = defineProps<{ environment: Record<string, string>; disabled: boolean }>();
const emit = defineEmits<{ update: [value: Record<string, string>] }>();
const name = shallowRef('');
const error = shallowRef('');
function add() {
  if (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.value) ||
    reservedRuntimeVariable(name.value) ||
    name.value in props.environment
  ) {
    error.value =
      'Use a unique environment name; scheduler and launcher identity are daemon-owned.';
    return;
  }
  emit('update', { ...props.environment, [name.value]: '' });
  name.value = '';
  error.value = '';
}
function remove(key: string) {
  emit(
    'update',
    Object.fromEntries(Object.entries(props.environment).filter(([name]) => name !== key)),
  );
}
</script>
<template>
  <details>
    <summary class="cursor-pointer font-medium">
      {{ translateKnownMessage('Explicit runtime environment') }}
    </summary>
    <div class="mt-4 flex flex-col gap-4">
      <p>
        {{
          translateKnownMessage(
            'These values are in the persisted execution plan. Do not enter credentials here; configure secrets on the daemon host.',
          )
        }}
      </p>
      <VeeField
        v-for="(_, key) in environment"
        :key="key"
        v-slot="{ field, errors }"
        :name="`runtime.environment.${key}`"
        ><Field :data-invalid="!!errors.length"
          ><FieldLabel :for="`env-${key}`">{{ key }}</FieldLabel
          ><Input
            :id="`env-${key}`"
            v-bind="field"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
          /><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /><Button
            type="button"
            variant="outline"
            :disabled="disabled"
            @click="remove(key)"
            >{{ t('Remove {name}', { name: key }) }}</Button
          ></Field
        ></VeeField
      >
      <Field
        ><FieldLabel for="new-env-name">{{
          translateKnownMessage('New environment variable')
        }}</FieldLabel
        ><Input id="new-env-name" v-model="name" :disabled="disabled" :aria-invalid="!!error" />
        <p v-if="error" role="alert">{{ translateKnownMessage(error) }}</p>
        <Button type="button" variant="outline" :disabled="disabled" @click="add">{{
          translateKnownMessage('Add variable')
        }}</Button></Field
      >
    </div>
  </details>
</template>

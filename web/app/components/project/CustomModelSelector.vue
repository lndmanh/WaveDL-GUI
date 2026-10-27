<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useI18n } from 'vue-i18n';
import { onBeforeUnmount, shallowRef, toRaw } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';
import { customModelSchema } from '../../../shared/schemas/training-request';
import { CatalogApi, type ModelSelection } from '../../lib/catalog-api';
import type { ConnectionSession } from '../../lib/connection-session';

const { clientMessage } = useClientMessages();
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ session: ConnectionSession; disabled: boolean }>();
const emit = defineEmits<{ select: [selection: ModelSelection] }>();
const { handleSubmit } = useForm({
  initialValues: { modelId: '' },
  validationSchema: customModelSchema,
});
const busy = shallowRef(false);
const message = shallowRef('');
let pending: AbortController | null = null;
const select = handleSubmit(async (value) => {
  pending?.abort();
  pending = new AbortController();
  busy.value = true;
  message.value = '';
  try {
    const selection = await new CatalogApi(toRaw(props.session)).selectCustomModel(
      value.modelId,
      pending.signal,
    );
    emit('select', selection);
  } catch {
    message.value = 'project.customModelFailed';
  } finally {
    busy.value = false;
    pending = null;
  }
});
onBeforeUnmount(() => pending?.abort());
</script>
<template>
  <details>
    <summary class="cursor-pointer font-medium">
      {{ t('project.useACustomRegisteredModel') }}
    </summary>
    <form class="mt-4 flex flex-col gap-4" @submit="select">
      <VeeField v-slot="{ field, errors }" name="modelId"
        ><Field :data-invalid="!!errors.length"
          ><FieldLabel for="custom-model-id">{{ t('project.customModelRegistryId') }}</FieldLabel
          ><Input
            id="custom-model-id"
            v-bind="field"
            :disabled="disabled || busy"
            :aria-invalid="!!errors.length" /><FieldDescription>{{
            t('project.customModelHelp')
          }}</FieldDescription
          ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field></VeeField
      ><Button type="submit" variant="outline" class="self-start" :disabled="disabled || busy">{{
        t('project.useCustomModelIdentifier')
      }}</Button>
      <p v-if="message" role="status">{{ t(message) }}</p>
    </form>
  </details>
</template>

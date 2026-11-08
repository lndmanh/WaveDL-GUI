<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Field as VeeField, useFormContext } from 'vee-validate';
import { Apple, ChevronRight, Cpu, Gauge, Sparkles, TriangleAlert, Wand } from '@lucide/vue';
import type { TrainingRequest } from '../../../shared/schemas/training-request';
import type { StorageMapping } from '../../../shared/schemas/storage-mapping';
import type { HostProfile, RuntimeSetup } from '../../../shared/schemas/host-profile';
import { visibleDevices } from '../../lib/host-runtime';
import {
  runtimeBackendField,
  runtimeDeviceField,
  runtimeFieldValueLabel,
  runtimeModeField,
  runtimePythonField,
  runtimeTopologyFields,
} from '../../lib/runtime-fields';
import { nullableNumberValue } from '../../lib/field-adaptation';
import type { AcceptableValue } from 'reka-ui';
import { runtimeDeviceSchema } from '../../../shared/schemas/workstation-controls';

const props = defineProps<{
  disabled: boolean;
  setup: RuntimeSetup;
  profile: HostProfile | null;
  detecting: boolean;
}>();

const emit = defineEmits<{
  environment: [value: Record<string, string>];
  storage: [value: StorageMapping[]];
  'update:setup': [value: RuntimeSetup];
  detect: [];
  detected: [];
}>();

const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { values, errors } = useFormContext<TrainingRequest>();
const prefix = useId();
const pythonId = `${prefix}-runtime-runtime-python`;
const modeId = `${prefix}-runtime-runtime-mode`;

type Device = TrainingRequest['runtime']['device'];

const devicePresentation: Readonly<
  Record<Device, { icon: Component; title: string; caption: string }>
> = {
  cpu: { icon: Cpu, title: 'builder.deviceCpu', caption: 'builder.deviceCpuHelp' },
  cuda: { icon: Gauge, title: 'builder.deviceCuda', caption: 'builder.deviceCudaHelp' },
  mps: { icon: Apple, title: 'builder.deviceMps', caption: 'builder.deviceMpsHelp' },
  auto: { icon: Sparkles, title: 'builder.deviceAuto', caption: 'builder.deviceAutoHelp' },
};

const devices = runtimeDeviceField.cardValues.map((value) => ({
  value,
  ...devicePresentation[value],
}));

// A daemon that reports its backends disables the ones it cannot plan for.
const backends = computed<
  { value: TrainingRequest['backend']; label: string; disabled: boolean }[]
>(() =>
  runtimeBackendField.values.map((value) => ({
    value,
    label: t(value === 'local' ? 'builder.backendLocal' : 'builder.backendSlurm'),
    disabled: !!props.profile && !props.profile.backends.includes(value),
  })),
);

const setups = computed<{ value: RuntimeSetup; label: string }[]>(() => [
  { value: 'automatic', label: t('builder.setupAutomatic') },
  { value: 'manual', label: t('builder.setupManual') },
]);

/** Without a profile there is nothing to automate: the manual editor is the way forward. */
const manual = computed(() => props.setup === 'manual' || (!props.profile && !props.detecting));

const deviceDetected = computed<Partial<Record<Device, boolean>>>(() => ({
  cpu: true,
  cuda: !!props.profile?.accelerators?.cuda.length,
  mps: !!props.profile?.accelerators?.mps,
}));

const pythonDiffers = computed(
  () => !!props.profile && values.runtime.python.trim() !== props.profile.python,
);

/** Local CUDA needs named devices; choosing CUDA names one per process for the user. */
function chooseDevice(value: AcceptableValue, change: (value: Device) => void) {
  const parsed = runtimeDeviceSchema.safeParse(value);

  if (!parsed.success) return;
  change(parsed.data);

  if (
    parsed.data === 'cuda' &&
    values.backend === 'local' &&
    !values.runtime.environment.CUDA_VISIBLE_DEVICES
  )
    emit('environment', {
      ...values.runtime.environment,
      CUDA_VISIBLE_DEVICES: visibleDevices(values.topology.processes_per_machine),
    });
}

const topologySummary = computed(() =>
  t('builder.topologySummary', {
    machines: values.topology.num_machines,
    processes: values.topology.processes_per_machine,
  }),
);

const topologyInvalid = computed(() =>
  Object.keys(errors.value).some((path) => path.startsWith('topology')),
);

function chooseSetup(value: RuntimeSetup) {
  emit('update:setup', value);
}

const projectStyles = {
  manualBanner: cn(
    'flex flex-wrap items-center gap-2 p-[0.6rem_0.75rem_0.6rem_1rem] rounded-[0.9rem]',
    '[background:color-mix(in_srgb,_var(--primary)_7%,_transparent)]',
  ),
  deviceCardBadge: cn(
    'py-[0.05rem] px-[0.4rem] rounded-full text-success text-[0.62rem] font-[650]',
    '[background:color-mix(in_srgb,_var(--success)_14%,_transparent)]',
  ),
  runtimeShared: cn(
    "py-[0.8rem] px-4 [&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']]:justify-start",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']]:gap-3",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']]:text-[0.92rem]",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']::before]:[content:'']",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']::before]:size-4",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']::before]:flex-none",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']::before]:bg-muted-foreground",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']::before]:[mask:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m9%2018%206-6-6-6%27/%3E%3C/svg%3E')_center_/_contain_no-repeat]",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger']::before]:[transition:transform_260ms_cubic-bezier(0.22,_1,_0.36,_1)]",
    "[&_>_[data-slot='collapsible']_>_[data-slot='collapsible-trigger'][data-state='open']::before]:[transform:rotate(90deg)]",
  ),
  deviceCard: cn(
    'relative block p-[0.95rem_1rem_1rem] rounded-[1rem] cursor-pointer bg-surface',
    'shadow-[0_0_0_0.5px_color-mix(in_srgb,_var(--foreground)_13%,_transparent),_0_1px_2px_rgb(0_0_0_/_0.04)]',
    '[transition:box-shadow_200ms_ease,_transform_200ms_cubic-bezier(0.34,_1.56,_0.64,_1)]',
    '[&:hover]:[transform:translateY(-1px)] [&:active]:[transform:scale(0.985)]',
    "[&[data-checked='true']]:shadow-[0_0_0_2px_var(--primary),_0_10px_24px_-14px_color-mix(in_srgb,_var(--primary)_70%,_transparent)]",
    '[&:has(:focus-visible)]:[outline:3px_solid_var(--primary)] [&:has(:focus-visible)]:[outline-offset:2px]',
    "[&[data-checked='true']_.device-card-icon]:text-primary-foreground",
    "[&[data-checked='true']_.device-card-icon]:bg-primary",
  ),
  deviceCardIcon: cn(
    'grid size-[2.1rem] place-items-center rounded-[0.65rem] text-foreground',
    '[background:color-mix(in_srgb,_var(--foreground)_6%,_transparent)] [&_svg]:size-[1.05rem]',
  ),
  runtimeRow: cn(
    '[&_+_.runtime-row]:[border-top:0.5px_solid_color-mix(in_srgb,_var(--foreground)_12%,_transparent)]',
    '[.surface-group>&:not(:first-child)]:[border-top:0.5px_solid_color-mix(in_srgb,_var(--foreground)_12%,_transparent)]',
  ),
  runtimeSectionTrigger: cn(
    'flex w-full items-center gap-3 py-[0.8rem] px-4',
    '[&:hover]:[background:color-mix(in_srgb,_var(--foreground)_3%,_transparent)]',
    "[&[data-state='open']_.runtime-section-chevron]:[transform:rotate(90deg)]",
  ),
  runtimeSectionChevron: cn(
    'size-4 flex-none text-muted-foreground [transition:transform_260ms_cubic-bezier(0.22,_1,_0.36,_1)]',
  ),
};
</script>
<template>
  <InspectorPanel :title="t('builder.runtimeTitle')" :description="t('builder.runtimeDescription')">
    <template #actions>
      <SegmentedControl
        :model-value="setup"
        :options="setups"
        :label="t('builder.runtimeSetup')"
        :disabled="disabled"
        size="md"
        test-id="runtime-setup"
        @update:model-value="chooseSetup"
      />
    </template>

    <RuntimeHostSummary
      :profile="profile"
      :detecting="detecting"
      :automatic="!manual"
      @detect="emit('detect')"
    />

    <!-- Manual: every runtime control, starting from the detected values. -->
    <div
      v-show="manual"
      class="flex flex-col gap-6"
      data-testid="runtime-manual"
      data-reveal-target='[data-testid="runtime-setup"] [data-value="manual"]'
    >
      <div v-if="profile" :class="projectStyles.manualBanner">
        <p class="min-w-0 flex-1 text-sm text-muted-foreground">{{ t('builder.manualHelp') }}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-primary"
          :disabled="disabled"
          @click="emit('detected')"
        >
          <Wand aria-hidden="true" />{{ t('builder.useDetected') }}
        </Button>
      </div>
      <p
        v-else-if="!detecting"
        :class="cn('text-sm text-muted-foreground', projectStyles.manualBanner)"
      >
        {{ t('builder.manualWithoutProfile') }}
      </p>
      <VeeField v-slot="{ field, errors: deviceErrors }" :name="runtimeDeviceField.name">
        <fieldset class="flex flex-col gap-2">
          <legend
            class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {{ t(runtimeDeviceField.label) }}
          </legend>
          <RadioGroup
            :model-value="values.runtime.device"
            :disabled="disabled"
            class="grid grid-cols-2 gap-2.5 lg:grid-cols-4"
            :aria-label="t(runtimeDeviceField.label)"
            @update:model-value="chooseDevice($event, field.onChange)"
          >
            <label
              v-for="device in devices"
              :key="device.value"
              :class="projectStyles.deviceCard"
              :data-checked="field.value === device.value"
            >
              <span class="flex items-center gap-2">
                <span :class="cn('device-card-icon', projectStyles.deviceCardIcon)"
                  ><component :is="device.icon" aria-hidden="true"
                /></span>
                <span
                  v-if="profile && device.value !== 'auto' && deviceDetected[device.value]"
                  :class="projectStyles.deviceCardBadge"
                >
                  {{ t('builder.detected') }}
                </span>
                <RadioGroupItem
                  class="ml-auto"
                  :value="device.value"
                  :data-testid="`device-${device.value}`"
                />
              </span>
              <span class="mt-3 block text-[0.92rem] font-semibold">{{ t(device.title) }}</span>
              <span class="block text-xs text-muted-foreground">{{ t(device.caption) }}</span>
            </label>
          </RadioGroup>
          <p
            v-if="field.value === 'cuda' && values.backend === 'local'"
            class="px-1 text-xs text-muted-foreground"
          >
            {{ t('builder.cudaLocalHelp') }}
          </p>
          <p
            v-else-if="field.value === 'mps' && values.backend === 'local'"
            class="flex items-center gap-1.5 px-1 text-xs text-warning"
          >
            <TriangleAlert class="size-3.5" aria-hidden="true" />{{ t('builder.mpsLocalHelp') }}
          </p>
          <FieldError v-if="deviceErrors.length" :errors="deviceErrors.map(clientMessage)" />
        </fieldset>
      </VeeField>

      <div class="surface-group overflow-hidden">
        <VeeField v-slot="{ field }" :name="runtimeBackendField.name">
          <div :class="cn('surface-row runtime-row', projectStyles.runtimeRow)">
            <div class="min-w-0 flex-1">
              <p class="text-[0.9rem] font-medium">{{ t('builder.backend') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('builder.backendHelp') }}</p>
            </div>
            <SegmentedControl
              :model-value="values.backend"
              :options="backends"
              :label="t(runtimeBackendField.label)"
              :disabled="disabled"
              test-id="runtime-backend"
              @update:model-value="field.onChange"
            />
          </div>
        </VeeField>
        <VeeField v-slot="{ field, errors: pythonErrors }" :name="runtimePythonField.name">
          <div :class="cn('runtime-row', projectStyles.runtimeRow)">
            <div class="surface-row flex-wrap">
              <div class="min-w-0 flex-1">
                <label :for="pythonId" class="text-[0.9rem] font-medium">
                  {{ t(runtimePythonField.label) }}
                </label>
                <p :id="`${pythonId}-description`" class="text-xs text-muted-foreground">
                  {{ t(runtimePythonField.description) }}
                </p>
              </div>
              <Input
                :id="pythonId"
                :name="field.name"
                class="w-full font-mono text-xs sm:w-96"
                :model-value="field.value"
                :disabled="disabled"
                :aria-invalid="!!pythonErrors.length"
                :aria-describedby="`${pythonId}-description`"
                autocomplete="off"
                spellcheck="false"
                :placeholder="profile?.python ?? t('builder.pythonPlaceholder')"
                @update:model-value="field.onChange"
                @blur="field.onBlur"
              />
              <Button
                v-if="pythonDiffers && profile"
                type="button"
                variant="ghost"
                size="sm"
                class="text-primary"
                :disabled="disabled"
                @click="field.onChange(profile.python)"
              >
                {{ t('builder.useThisPython') }}
              </Button>
            </div>
            <FieldError
              v-if="pythonErrors.length"
              class="px-4 pb-3"
              :errors="pythonErrors.map(clientMessage)"
            />
          </div>
        </VeeField>
        <VeeField v-slot="{ field, errors: modeErrors }" :name="runtimeModeField.name">
          <div :class="cn('runtime-row', projectStyles.runtimeRow)">
            <div class="surface-row">
              <div class="min-w-0 flex-1">
                <label :for="modeId" class="text-[0.9rem] font-medium">
                  {{ t(runtimeModeField.label) }}
                </label>
                <p class="text-xs text-muted-foreground">
                  {{ t('project.runtimeUnavailableModes') }}
                </p>
              </div>
              <Select
                :model-value="String(field.value)"
                :name="field.name"
                :disabled="disabled"
                @update:model-value="field.onChange"
              >
                <SelectTrigger :id="modeId" class="min-w-44" :data-value="String(field.value)">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="mode in runtimeModeField.values" :key="mode" :value="mode">
                      {{ runtimeFieldValueLabel(mode, t) }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <FieldError
              v-if="modeErrors.length"
              class="px-4 pb-3"
              :errors="modeErrors.map(clientMessage)"
            />
          </div>
        </VeeField>
      </div>

      <Collapsible
        class="surface-group overflow-hidden"
        :default-open="topologyInvalid || values.topology.num_machines > 1"
        :open="topologyInvalid ? true : undefined"
        :unmount-on-hide="false"
      >
        <CollapsibleTrigger :class="projectStyles.runtimeSectionTrigger">
          <ChevronRight
            :class="cn('runtime-section-chevron', projectStyles.runtimeSectionChevron)"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 text-left">
            <span class="block text-[0.92rem] font-medium">{{ t('builder.distributed') }}</span>
            <span class="block text-xs text-muted-foreground">{{ topologySummary }}</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent class="collapsible-motion">
          <div class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]">
            <VeeField
              v-for="item in runtimeTopologyFields"
              :key="item.name"
              v-slot="{ field, errors: countErrors }"
              :name="item.name"
            >
              <div :class="cn('runtime-row', projectStyles.runtimeRow)">
                <div class="surface-row">
                  <label
                    :for="`${prefix}-runtime-${item.name.replace('.', '-')}`"
                    class="min-w-0 flex-1 text-[0.9rem] font-medium"
                    >{{ t(item.label) }}</label
                  >
                  <NumberField
                    :id="`${prefix}-runtime-${item.name.replace('.', '-')}`"
                    :label="t(item.label)"
                    :model-value="nullableNumberValue(field.value)"
                    integer
                    :min="item.min"
                    :disabled="disabled"
                    :invalid="!!countErrors.length"
                    @update:model-value="field.onChange"
                    @blur="field.onBlur"
                  />
                </div>
                <FieldError
                  v-if="countErrors.length"
                  class="px-4 pb-3"
                  :errors="countErrors.map(clientMessage)"
                />
              </div>
            </VeeField>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div :class="cn('surface-group', projectStyles.runtimeShared)">
        <EnvironmentFields
          :environment="values.runtime.environment"
          :disabled="disabled"
          @update="emit('environment', $event)"
        />
      </div>
      <div :class="cn('surface-group', projectStyles.runtimeShared)">
        <StorageMappingFields
          :mappings="values.storage_map"
          :backend="values.backend"
          :disabled="disabled"
          @update="emit('storage', $event)"
        />
      </div>
    </div>
  </InspectorPanel>
</template>

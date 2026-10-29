<script setup lang="ts">
import { computed, useId, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { Field as VeeField, useFormContext } from 'vee-validate';
import {
  Apple,
  Check,
  ChevronRight,
  Cpu,
  Gauge,
  MemoryStick,
  Monitor,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Wand,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TrainingRequest } from '../../../shared/schemas/training-request';
import type { StorageMapping } from '../../../shared/schemas/storage-mapping';
import type { HostProfile, RuntimeSetup } from '../../../shared/schemas/host-profile';
import { gigabytes, hostAccelerator, visibleDevices } from '../../lib/host-runtime';
import { useClientMessages } from '../../composables/useClientMessages';
import { runtimeValueMessageKeys } from '../../i18n/dynamic-keys';
import EnvironmentFields from './EnvironmentFields.vue';
import InspectorPanel from './InspectorPanel.vue';
import NumberField from './NumberField.vue';
import SegmentedControl from './SegmentedControl.vue';
import StorageMappingFields from './StorageMappingFields.vue';

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
const devices: readonly { value: Device; icon: Component; title: string; caption: string }[] = [
  { value: 'cpu', icon: Cpu, title: 'builder.deviceCpu', caption: 'builder.deviceCpuHelp' },
  { value: 'cuda', icon: Gauge, title: 'builder.deviceCuda', caption: 'builder.deviceCudaHelp' },
  { value: 'mps', icon: Apple, title: 'builder.deviceMps', caption: 'builder.deviceMpsHelp' },
  { value: 'auto', icon: Sparkles, title: 'builder.deviceAuto', caption: 'builder.deviceAutoHelp' },
];
const modes: readonly TrainingRequest['runtime']['mode'][] = [
  'existing',
  'selected',
  'bundled',
  'container',
];
// A daemon that reports its backends disables the ones it cannot plan for.
const backends = computed<{ value: TrainingRequest['backend']; label: string; disabled: boolean }[]>(
  () =>
    (['local', 'slurm'] as const).map((value) => ({
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
const accelerator = computed(() => (props.profile ? hostAccelerator(props.profile) : 'unknown'));
const acceleratorName = computed(() => {
  const found = props.profile?.accelerators;
  if (accelerator.value === 'cuda' && found?.cuda[0])
    return found.cuda.length > 1
      ? t('builder.gpuCount', { name: found.cuda[0].name, count: found.cuda.length })
      : found.cuda[0].name;
  if (accelerator.value === 'mps') return t('builder.appleGpu');
  if (accelerator.value === 'cpu') return t('builder.cpuOnly');
  return t('builder.acceleratorUnknown');
});
const machineFacts = computed(() => {
  const profile = props.profile;
  if (!profile) return [];
  const gpu = profile.accelerators?.cuda[0];
  return [
    {
      icon: Cpu,
      label: t('builder.processor'),
      value: profile.cpu_count ? t('builder.cores', { count: profile.cpu_count }) : '—',
      detail: profile.arch,
    },
    {
      icon: MemoryStick,
      label: t('builder.memory'),
      value: profile.memory_bytes ? gigabytes(profile.memory_bytes) : '—',
      detail: '',
    },
    {
      icon: accelerator.value === 'mps' ? Apple : Gauge,
      label: t('builder.accelerator'),
      value: acceleratorName.value,
      detail: gpu ? gigabytes(gpu.memory_bytes) : '',
    },
    {
      icon: Sparkles,
      label: t('builder.pythonShort'),
      value: profile.python_version,
      detail: profile.accelerators?.torch
        ? t('builder.torchVersion', { version: profile.accelerators.torch })
        : '',
    },
  ];
});
const osName = computed(() => {
  const os = props.profile?.os;
  return os === 'Darwin' ? 'macOS' : os;
});
const torchMissing = computed(() => !!props.profile?.accelerators && !props.profile.accelerators.torch);
const deviceDetected = computed<Partial<Record<Device, boolean>>>(() => ({
  cpu: true,
  cuda: !!props.profile?.accelerators?.cuda.length,
  mps: !!props.profile?.accelerators?.mps,
}));
const pythonDiffers = computed(
  () => !!props.profile && values.runtime.python.trim() !== props.profile.python,
);
/** Local CUDA needs named devices; choosing CUDA names one per process for the user. */
function chooseDevice(value: unknown, change: (value: unknown) => void) {
  change(value);
  if (
    value === 'cuda' &&
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
const topologyFields = [
  { name: 'topology.num_machines', label: 'project.machines', min: 1 },
  { name: 'topology.processes_per_machine', label: 'project.processesPerMachine', min: 1 },
  { name: 'topology.machine_rank', label: 'project.machineRank', min: 0 },
] as const;
const topologyInvalid = computed(() =>
  Object.keys(errors.value).some((path) => path.startsWith('topology')),
);
function modeLabel(mode: TrainingRequest['runtime']['mode']): string {
  const key = runtimeValueMessageKeys[mode];
  return key ? t(key) : mode;
}
function deviceValue(value: unknown): Device | undefined {
  return devices.find((device) => device.value === value)?.value;
}
function backendValue(value: unknown): TrainingRequest['backend'] | undefined {
  return backends.value.find((backend) => backend.value === value)?.value;
}
function chooseSetup(value: RuntimeSetup) {
  emit('update:setup', value);
}
function count(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
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

    <!-- This machine, as the daemon sees it. -->
    <section class="surface-group machine-card" :aria-label="t('builder.thisMachine')" data-testid="host-profile">
      <header class="flex items-center gap-3">
        <span class="machine-card-icon"><Monitor aria-hidden="true" /></span>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-muted-foreground">{{ t('builder.thisMachine') }}</p>
          <p v-if="profile" class="truncate text-[1.05rem] font-semibold">{{ profile.hostname || osName }}</p>
          <p v-else-if="detecting" class="text-[1.05rem] font-semibold">{{ t('builder.detecting') }}</p>
          <p v-else class="text-[1.05rem] font-semibold">{{ t('builder.detectFailed') }}</p>
        </div>
        <span v-if="profile" class="hidden text-xs text-muted-foreground sm:inline">
          {{ osName }} {{ profile.os_release }}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="detecting"
          :aria-label="t('builder.detectAgain')"
          :title="t('builder.detectAgain')"
          @click="emit('detect')"
        >
          <RefreshCw :class="detecting ? 'animate-spin' : ''" aria-hidden="true" />
        </Button>
      </header>
      <dl v-if="profile" class="machine-facts">
        <div v-for="fact in machineFacts" :key="fact.label" class="machine-fact">
          <dt><component :is="fact.icon" aria-hidden="true" />{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
          <dd v-if="fact.detail" class="machine-fact-detail">{{ fact.detail }}</dd>
        </div>
      </dl>
      <div v-else-if="detecting" class="machine-facts" aria-hidden="true">
        <Skeleton v-for="index in 4" :key="index" class="h-16 rounded-xl" />
      </div>
      <p v-else class="text-sm text-muted-foreground">{{ t('builder.detectFailedHelp') }}</p>
      <p v-if="profile" class="truncate font-mono text-[0.7rem] text-muted-foreground" :title="profile.python">
        {{ profile.python }}
      </p>
    </section>

    <!-- Automatic: what the run will do, in plain words. -->
    <section
      v-if="!manual && profile"
      class="surface-group overflow-hidden"
      :aria-label="t('builder.automaticPlan')"
      data-testid="runtime-automatic"
    >
      <p class="flex items-center gap-2 px-4 pt-4 text-[0.92rem] font-semibold">
        <Wand class="size-4 text-primary" aria-hidden="true" />{{ t('builder.automaticPlan') }}
      </p>
      <ul class="flex flex-col py-2">
        <li class="automatic-step">
          <Check aria-hidden="true" />{{ t('builder.automaticLocal') }}
        </li>
        <li class="automatic-step">
          <Check aria-hidden="true" />{{ t('builder.automaticDevice', { device: acceleratorName }) }}
        </li>
        <li class="automatic-step">
          <Check aria-hidden="true" />{{ t('builder.automaticPython', { version: profile.python_version }) }}
        </li>
        <li v-if="(profile.accelerators?.cuda.length ?? 0) > 1" class="automatic-step" data-tone="info">
          <Check aria-hidden="true" />{{ t('builder.automaticOneGpu', { count: profile.accelerators?.cuda.length ?? 0 }) }}
        </li>
        <li v-if="torchMissing" class="automatic-step" data-tone="warning">
          <TriangleAlert aria-hidden="true" />{{ t('builder.torchMissing') }}
        </li>
      </ul>
      <p class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] px-4 py-3 text-xs text-muted-foreground">
        {{ t('builder.automaticHelp') }}
      </p>
    </section>

    <!-- Manual: every runtime control, starting from the detected values. -->
    <div
      v-show="manual"
      class="flex flex-col gap-6"
      data-testid="runtime-manual"
      data-reveal-target='[data-testid="runtime-setup"] [data-value="manual"]'
    >
      <div v-if="profile" class="manual-banner">
        <p class="min-w-0 flex-1 text-sm text-muted-foreground">{{ t('builder.manualHelp') }}</p>
        <Button type="button" variant="ghost" size="sm" class="text-primary" :disabled="disabled" @click="emit('detected')">
          <Wand aria-hidden="true" />{{ t('builder.useDetected') }}
        </Button>
      </div>
      <p v-else-if="!detecting" class="manual-banner text-sm text-muted-foreground">
        {{ t('builder.manualWithoutProfile') }}
      </p>
      <VeeField v-slot="{ field, errors: deviceErrors }" name="runtime.device">
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {{ t('project.device') }}
          </legend>
          <RadioGroup
            :model-value="deviceValue(field.value)"
            :disabled="disabled"
            class="grid grid-cols-2 gap-2.5 lg:grid-cols-4"
            :aria-label="t('project.device')"
            @update:model-value="chooseDevice($event, field.onChange)"
          >
            <label
              v-for="device in devices"
              :key="device.value"
              class="device-card"
              :data-checked="field.value === device.value"
            >
              <span class="flex items-center gap-2">
                <span class="device-card-icon"><component :is="device.icon" aria-hidden="true" /></span>
                <span v-if="profile && device.value !== 'auto' && deviceDetected[device.value]" class="device-card-badge">
                  {{ t('builder.detected') }}
                </span>
                <RadioGroupItem class="ml-auto" :value="device.value" :data-testid="`device-${device.value}`" />
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
        <VeeField v-slot="{ field }" name="backend">
          <div class="surface-row runtime-row">
            <div class="min-w-0 flex-1">
              <p class="text-[0.9rem] font-medium">{{ t('builder.backend') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('builder.backendHelp') }}</p>
            </div>
            <SegmentedControl
              :model-value="backendValue(field.value)"
              :options="backends"
              :label="t('project.configuredBackend')"
              :disabled="disabled"
              test-id="runtime-backend"
              @update:model-value="field.onChange"
            />
          </div>
        </VeeField>
        <VeeField v-slot="{ field, errors: pythonErrors }" name="runtime.python">
          <div class="runtime-row">
            <div class="surface-row flex-wrap">
              <div class="min-w-0 flex-1">
                <label :for="pythonId" class="text-[0.9rem] font-medium">
                  {{ t('project.pythonInterpreter') }}
                </label>
                <p :id="`${pythonId}-description`" class="text-xs text-muted-foreground">
                  {{ t('project.interpreterHelp') }}
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
        <VeeField v-slot="{ field, errors: modeErrors }" name="runtime.mode">
          <div class="runtime-row">
            <div class="surface-row">
              <div class="min-w-0 flex-1">
                <label :for="modeId" class="text-[0.9rem] font-medium">
                  {{ t('project.runtimeMode') }}
                </label>
                <p class="text-xs text-muted-foreground">{{ t('project.runtimeUnavailableModes') }}</p>
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
                    <SelectItem v-for="mode in modes" :key="mode" :value="mode">
                      {{ modeLabel(mode) }}
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
        <CollapsibleTrigger class="runtime-section-trigger">
          <ChevronRight class="runtime-section-chevron" aria-hidden="true" />
          <span class="min-w-0 flex-1 text-left">
            <span class="block text-[0.92rem] font-medium">{{ t('builder.distributed') }}</span>
            <span class="block text-xs text-muted-foreground">{{ topologySummary }}</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent class="collapsible-motion">
          <div class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]">
            <VeeField
              v-for="item in topologyFields"
              :key="item.name"
              v-slot="{ field, errors: countErrors }"
              :name="item.name"
            >
              <div class="runtime-row">
                <div class="surface-row">
                  <label
                    :for="`${prefix}-runtime-${item.name.replace('.', '-')}`"
                    class="min-w-0 flex-1 text-[0.9rem] font-medium"
                    >{{ t(item.label) }}</label
                  >
                  <NumberField
                    :id="`${prefix}-runtime-${item.name.replace('.', '-')}`"
                    :label="t(item.label)"
                    :model-value="count(field.value)"
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

      <div class="surface-group runtime-shared">
        <EnvironmentFields
          :environment="values.runtime.environment"
          :disabled="disabled"
          @update="emit('environment', $event)"
        />
      </div>
      <div class="surface-group runtime-shared">
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
<style>
.machine-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.1rem 1.1rem;
}
.machine-card-icon {
  display: grid;
  width: 2.4rem;
  height: 2.4rem;
  flex: none;
  place-items: center;
  border-radius: 0.75rem;
  color: #fff;
  background: linear-gradient(160deg, #5e8bff, #3a5ccc);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25);
}
.machine-card-icon svg {
  width: 1.2rem;
  height: 1.2rem;
}
.machine-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}
@media (max-width: 40rem) {
  .machine-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.machine-fact {
  min-width: 0;
  padding: 0.65rem 0.75rem;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--foreground) 4.5%, transparent);
}
.machine-fact dt {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--muted-foreground);
  font-size: 0.7rem;
}
.machine-fact dt svg {
  width: 0.75rem;
  height: 0.75rem;
}
.machine-fact dd {
  margin: 0.2rem 0 0;
  overflow: hidden;
  font-size: 0.92rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.machine-fact .machine-fact-detail {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 0.7rem;
  font-weight: 400;
}
.automatic-step {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.45rem 1rem;
  font-size: 0.875rem;
}
.automatic-step svg {
  width: 1rem;
  height: 1rem;
  flex: none;
  margin-top: 0.15rem;
  color: var(--success);
  stroke-width: 2.5;
}
.automatic-step[data-tone='warning'] svg {
  color: var(--warning);
  stroke-width: 2;
}
.automatic-step[data-tone='info'] svg {
  color: var(--primary);
}
.manual-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem 0.6rem 1rem;
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--primary) 7%, transparent);
}
.device-card-badge {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  color: var(--success);
  font-size: 0.62rem;
  font-weight: 650;
  background: color-mix(in srgb, var(--success) 14%, transparent);
}
/* Shared disclosure components, restyled to match the sections above. */
.runtime-shared {
  padding: 0.8rem 1rem;
}
.runtime-shared > [data-slot='collapsible'] > [data-slot='collapsible-trigger'] {
  justify-content: flex-start;
  gap: 0.75rem;
  font-size: 0.92rem;
}
.runtime-shared > [data-slot='collapsible'] > [data-slot='collapsible-trigger']::before {
  content: '';
  width: 1rem;
  height: 1rem;
  flex: none;
  background: var(--muted-foreground);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E")
    center / contain no-repeat;
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.runtime-shared
  > [data-slot='collapsible']
  > [data-slot='collapsible-trigger'][data-state='open']::before {
  transform: rotate(90deg);
}
.device-card {
  position: relative;
  display: block;
  padding: 0.95rem 1rem 1rem;
  border-radius: 1rem;
  cursor: pointer;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 13%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
  transition:
    box-shadow 200ms ease,
    transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.device-card:hover {
  transform: translateY(-1px);
}
.device-card:active {
  transform: scale(0.985);
}
.device-card[data-checked='true'] {
  box-shadow:
    0 0 0 2px var(--primary),
    0 10px 24px -14px color-mix(in srgb, var(--primary) 70%, transparent);
}
.device-card:has(:focus-visible) {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}
.device-card-icon {
  display: grid;
  width: 2.1rem;
  height: 2.1rem;
  place-items: center;
  border-radius: 0.65rem;
  color: var(--foreground);
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
}
.device-card[data-checked='true'] .device-card-icon {
  color: var(--primary-foreground);
  background: var(--primary);
}
.device-card-icon svg {
  width: 1.05rem;
  height: 1.05rem;
}
.runtime-row + .runtime-row,
.surface-group > .runtime-row:not(:first-child) {
  border-top: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
}
.runtime-section-trigger {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
}
.runtime-section-trigger:hover {
  background: color-mix(in srgb, var(--foreground) 3%, transparent);
}
.runtime-section-chevron {
  width: 1rem;
  height: 1rem;
  flex: none;
  color: var(--muted-foreground);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.runtime-section-trigger[data-state='open'] .runtime-section-chevron {
  transform: rotate(90deg);
}
</style>

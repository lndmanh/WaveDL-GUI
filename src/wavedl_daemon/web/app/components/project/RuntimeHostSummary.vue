<script setup lang="ts">
import { cn } from '@/lib/utils';
import {
  Apple,
  Check,
  Cpu,
  Gauge,
  MemoryStick,
  Monitor,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Wand,
} from '@lucide/vue';
import type { HostProfile } from '../../../shared/schemas/host-profile';
import { gigabytes, hostAccelerator } from '../../lib/host-runtime';

const props = defineProps<{
  profile: HostProfile | null;
  detecting: boolean;
  automatic: boolean;
}>();

const emit = defineEmits<{ detect: [] }>();
const { t } = useI18n({ useScope: 'global' });

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

const torchMissing = computed(
  () => !!props.profile?.accelerators && !props.profile.accelerators.torch,
);

const projectStyles = {
  machineCard: cn('flex flex-col gap-4 p-[1rem_1.1rem_1.1rem]'),
  machineCardIcon: cn(
    'grid size-[2.4rem] flex-none place-items-center rounded-lg text-white',
    '[background:linear-gradient(160deg,_#5e8bff,_#3a5ccc)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25)]',
    '[&_svg]:size-[1.2rem]',
  ),
  machineFacts: cn('grid grid-cols-4 gap-2 [@media(max-width:_40rem)]:grid-cols-2'),
  machineFact: cn(
    'min-w-0 py-[0.65rem] px-3 rounded-lg [background:color-mix(in_srgb,_var(--foreground)_4.5%,_transparent)]',
    '[&_dt]:flex [&_dt]:items-center [&_dt]:gap-[0.3rem] [&_dt]:text-muted-foreground [&_dt]:text-[0.7rem]',
    '[&_dt_svg]:size-3 [&_dd]:m-[0.2rem_0_0] [&_dd]:overflow-hidden [&_dd]:text-[0.92rem] [&_dd]:font-semibold',
    '[&_dd]:text-ellipsis [&_dd]:whitespace-nowrap [&_.machine-fact-detail]:m-0',
    '[&_.machine-fact-detail]:text-muted-foreground [&_.machine-fact-detail]:text-[0.7rem]',
    '[&_.machine-fact-detail]:font-normal',
  ),
  automaticStep: cn(
    'flex items-start gap-[0.6rem] py-[0.45rem] px-4 text-sm/[inherit] [&_svg]:size-4 [&_svg]:flex-none [&_svg]:mt-[0.15rem]',
    "[&_svg]:text-success [&_svg]:stroke-[2.5] [&[data-tone='warning']_svg]:text-warning",
    "[&[data-tone='warning']_svg]:stroke-[2] [&[data-tone='info']_svg]:text-primary",
  ),
};
</script>
<template>
  <!-- This machine, as the daemon sees it. -->
  <section
    :class="cn('surface-group', projectStyles.machineCard)"
    :aria-label="t('builder.thisMachine')"
    data-testid="host-profile"
  >
    <header class="flex items-center gap-3">
      <span :class="projectStyles.machineCardIcon"><Monitor aria-hidden="true" /></span>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-muted-foreground">{{ t('builder.thisMachine') }}</p>
        <p v-if="profile" class="truncate text-[1.05rem] font-semibold">
          {{ profile.hostname || osName }}
        </p>
        <p v-else-if="detecting" class="text-[1.05rem] font-semibold">
          {{ t('builder.detecting') }}
        </p>
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
    <dl v-if="profile" :class="projectStyles.machineFacts">
      <div v-for="fact in machineFacts" :key="fact.label" :class="projectStyles.machineFact">
        <dt><component :is="fact.icon" aria-hidden="true" />{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
        <dd v-if="fact.detail" class="machine-fact-detail">{{ fact.detail }}</dd>
      </div>
    </dl>
    <div v-else-if="detecting" :class="projectStyles.machineFacts" aria-hidden="true">
      <Skeleton v-for="index in 4" :key="index" class="h-16 rounded-xl" />
    </div>
    <p v-else class="text-sm text-muted-foreground">{{ t('builder.detectFailedHelp') }}</p>
    <p
      v-if="profile"
      class="truncate font-mono text-[0.7rem] text-muted-foreground"
      :title="profile.python"
    >
      {{ profile.python }}
    </p>
  </section>

  <!-- Automatic: what the run will do, in plain words. -->
  <section
    v-if="automatic && profile"
    class="surface-group overflow-hidden"
    :aria-label="t('builder.automaticPlan')"
    data-testid="runtime-automatic"
  >
    <p class="flex items-center gap-2 px-4 pt-4 text-[0.92rem] font-semibold">
      <Wand class="size-4 text-primary" aria-hidden="true" />{{ t('builder.automaticPlan') }}
    </p>
    <ul class="flex flex-col py-2">
      <li :class="projectStyles.automaticStep">
        <Check aria-hidden="true" />{{ t('builder.automaticLocal') }}
      </li>
      <li :class="projectStyles.automaticStep">
        <Check aria-hidden="true" />{{
          t('builder.automaticDevice', { device: acceleratorName })
        }}
      </li>
      <li :class="projectStyles.automaticStep">
        <Check aria-hidden="true" />{{
          t('builder.automaticPython', { version: profile.python_version })
        }}
      </li>
      <li
        v-if="(profile.accelerators?.cuda.length ?? 0) > 1"
        :class="projectStyles.automaticStep"
        data-tone="info"
      >
        <Check aria-hidden="true" />{{
          t('builder.automaticOneGpu', { count: profile.accelerators?.cuda.length ?? 0 })
        }}
      </li>
      <li v-if="torchMissing" :class="projectStyles.automaticStep" data-tone="warning">
        <TriangleAlert aria-hidden="true" />{{ t('builder.torchMissing') }}
      </li>
    </ul>
    <p
      class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] px-4 py-3 text-xs text-muted-foreground"
    >
      {{ t('builder.automaticHelp') }}
    </p>
  </section>
</template>

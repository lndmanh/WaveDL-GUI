<script setup lang="ts">
import { cn } from '@/lib/utils';
import { ArrowRight, Check, ChevronRight, Copy, TriangleAlert } from '@lucide/vue';
import type { PlanView } from '~~/types/daemon-api';
import type { PlanCommand } from '~~/types/plan-summary';

const props = withDefaults(defineProps<{
  plan: PlanView;
  command: PlanCommand | null;
  fullSettings?: boolean;
}>(), { fullSettings: false });

const { t } = useI18n({ useScope: 'global' });
const titleId = useId();
const settingsId = useId();
const terminalId = useId();
const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1600 });
const { differences, context, sections, warnings } = usePlanSummary(() => props.plan, () => props.fullSettings);

const styles = {
  planFact: cn(
    'min-w-0 py-2',
    '[&_dt]:text-muted-foreground [&_dt]:text-[0.7rem] [&_dd]:m-[0.15rem_0_0] [&_dd]:text-[0.92rem] [&_dd]:font-semibold',
    '[&_dd]:[overflow-wrap:anywhere]',
  ),
  planDifferences: cn(
    'flex flex-col p-[0_0.5rem_0.75rem] [&_li]:grid [&_li]:items-center [&_li]:gap-[0.6rem] [&_li]:py-[0.45rem]',
    '[&_li]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:[&_li]:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto_minmax(0,0.8fr)]',
    '[&_li]:px-3 [&_li]:rounded-[0.6rem] [&_li]:text-[0.85rem]',
    '[&_li:nth-child(odd)]:[background:color-mix(in_srgb,_var(--foreground)_3%,_transparent)]',
  ),
  planDefault: cn(
    "min-w-0 overflow-hidden text-muted-foreground [font-family:ui-monospace,_'SF_Mono',_monospace] text-xs/[inherit]",
    'line-through text-ellipsis whitespace-nowrap',
  ),
  planValue: cn(
    "min-w-0 overflow-hidden [font-family:ui-monospace,_'SF_Mono',_monospace] text-[0.78rem] font-semibold",
    'text-ellipsis whitespace-nowrap',
  ),
  planSettingsTrigger: cn(
    'flex w-full items-center gap-[0.6rem] py-[0.8rem] px-5 text-[0.85rem] font-medium',
    "[&[data-state='open']_.plan-settings-chevron]:[transform:rotate(90deg)]",
  ),
  planSettingsChevron: cn(
    'size-4 text-muted-foreground [transition:transform_260ms_cubic-bezier(0.22,_1,_0.36,_1)]',
  ),
  planDivider: cn('border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]'),
};
</script>
<template>
      <section class="surface-group @container overflow-hidden" :aria-labelledby="titleId">
        <header class="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
          <div class="min-w-0">
            <p v-if="!fullSettings" class="flex items-center gap-1.5 text-xs font-semibold text-success">
              <Check class="size-3.5" aria-hidden="true" />{{ t('builder.planReady') }}
            </p>
            <h3 :id="titleId" class="mt-1 text-[1.15rem] font-semibold">
              {{ fullSettings ? t('project.storedConfiguration') : t('project.persistedPlanForApproval') }}
            </h3>
          </div>
        </header>
        <dl
          :class="fullSettings
            ? 'grid grid-cols-1 gap-x-5 px-5 pt-3 @min-[28rem]:grid-cols-2'
            : 'grid grid-cols-1 gap-x-5 px-5 pt-3 min-[400px]:grid-cols-2 lg:grid-cols-3'"
          :aria-label="t('project.planContext')"
        >
          <div v-for="item in context" :key="item.label" :class="styles.planFact">
            <dt>{{ item.label }}</dt>
            <dd :title="item.fullValue">
              <span :aria-hidden="item.fullValue ? true : undefined">{{ item.value }}</span>
              <span v-if="item.fullValue" class="sr-only">{{ item.fullValue }}</span>
            </dd>
          </div>
        </dl>
        <Alert v-if="warnings.length" variant="warning" class="mx-5 mt-4 w-auto min-w-0">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{{ t('project.beforeYouStart') }}</AlertTitle>
          <AlertDescription>
            <ul class="list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
              <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
            </ul>
          </AlertDescription>
        </Alert>
        <template v-if="!fullSettings">
        <div class="px-5 pt-5 pb-2">
          <h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {{ t('builder.changesFromDefaults') }}
          </h4>
        </div>
        <ul v-if="differences.length" :class="styles.planDifferences">
          <li v-for="item in differences" :key="item.name">
            <span class="col-span-3 min-w-0 [overflow-wrap:anywhere] sm:col-span-1">{{
              item.label
            }}</span>
            <span :class="styles.planDefault" :title="item.defaultValue">{{
              item.defaultValue
            }}</span>
            <ArrowRight class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
            <span :class="styles.planValue" :title="item.value">{{ item.value }}</span>
          </li>
        </ul>
        <p v-else class="px-5 pb-4 text-sm text-muted-foreground">
          {{ t('project.noPlanDifferences') }}
        </p>
        </template>
        <section
          v-if="command"
          class="mx-5 mb-5 min-w-0 rounded-xl border p-3"
          :aria-labelledby="terminalId"
        >
          <h4 :id="terminalId" class="text-sm font-medium">
            {{ t('project.runItFromATerminal') }}
          </h4>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('project.sameTrainingWithWavedlCommandLine') }}
          </p>
          <div v-if="command.ok" class="mt-3 flex min-w-0 items-center gap-2">
            <code class="min-w-0 flex-1 truncate text-xs" :title="command.text">{{
              command.text
            }}</code>
            <Button
              v-if="canCopy"
              type="button"
              variant="ghost"
              size="icon"
              class="size-8 shrink-0"
              :aria-label="t('project.copyStandaloneCliCommand')"
              @click="copy(command.text)"
            >
              <Check v-if="copied" aria-hidden="true" /><Copy v-else aria-hidden="true" />
            </Button>
          </div>
          <p v-else class="mt-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {{ command.reason }}
          </p>
          <span class="sr-only" aria-live="polite" role="status">{{
            copied ? t('project.copied') : ''
          }}</span>
        </section>
        <Collapsible v-if="sections.length" :default-open="fullSettings" :class="styles.planDivider">
          <CollapsibleTrigger :id="settingsId" :class="styles.planSettingsTrigger">
            <ChevronRight
              :class="cn('plan-settings-chevron', styles.planSettingsChevron)"
              aria-hidden="true"
            />
            {{ t('project.allSettings') }}
          </CollapsibleTrigger>
          <CollapsibleContent class="collapsible-motion" :aria-labelledby="settingsId">
            <div class="flex min-w-0 flex-col gap-5 px-5 pb-5">
              <section
                v-for="section in sections"
                :key="section.id"
                :aria-labelledby="`${settingsId}-${section.id}`"
              >
                <h4 :id="`${settingsId}-${section.id}`" class="mb-2 text-sm font-semibold">
                  {{ section.title }}
                </h4>
                <dl class="min-w-0 divide-y divide-border">
                  <div
                    v-for="row in section.rows"
                    :key="row.name"
                    :class="fullSettings
                      ? 'grid min-w-0 gap-1 py-2 text-sm @min-[24rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @min-[24rem]:gap-4'
                      : 'grid min-w-0 gap-1 py-2 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4'"
                  >
                    <dt class="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                      {{ row.label }}
                    </dt>
                    <dd class="min-w-0 [overflow-wrap:anywhere]">
                      {{ row.value }}
                      <span
                        v-if="!fullSettings && row.changed"
                        class="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />{{
                          t('project.changed')
                        }}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
</template>

<script setup lang="ts">
import { ChevronLeft, ChevronRight, Plus, Search } from '@lucide/vue';
import type { DaemonApi } from '../../../lib/daemon-api';
import { isCompareEligible, parentTitle } from '../../../lib/test-runs';
import { headlineMetrics } from '../../../lib/test-compare';
import type { HeadlineMetric } from '../../../lib/test-compare';
import { pathName } from '../../../lib/run-overview';
import { cn } from '../../../lib/utils';
const props = defineProps<{ api: DaemonApi; ids: string[]; referenceName: string; sort: HeadlineMetric }>();
const emit = defineEmits<{ sort: [metric: HeadlineMetric]; add: [id: string] }>();
const { t } = useI18n({ useScope: 'global' });
const { reportFailure } = useWorkstation();
const { runs, loading, page, refresh, message } = useTestRuns(props.api, (error) => reportFailure.value(error));
const { clientMessage } = useClientMessages();
const picker = ref(false);
const search = ref('');
const eligible = computed(() => runs.value.filter((run) => isCompareEligible(run) && !props.ids.includes(run.run_id) && `${parentTitle(run)} ${pathName(run.summary?.data_path)} ${run.run_id}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())));
const styles = { pickerRow: cn('flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring') };
function updateSort(value: unknown) { const option = headlineMetrics.find((item) => item.metric === value); if (option) emit('sort', option.metric); }
function add(id: string) { emit('add', id); picker.value = false; search.value = ''; }
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="text-xl font-semibold tracking-tight">{{ t('results.compare.title', { count: ids.length }) }} <span class="text-xs font-normal text-muted-foreground">· {{ t('results.compare.limit') }}</span></h1><p v-if="referenceName" class="mt-1 text-sm text-muted-foreground">{{ t('results.compare.against', { name: referenceName }) }}</p></div>
    <div class="flex max-w-full flex-wrap items-center gap-2">
      <Select :model-value="sort" @update:model-value="updateSort"><SelectTrigger class="w-36" :aria-label="t('results.compare.sort')"><span class="text-muted-foreground">{{ t('results.compare.sort') }}:</span><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="option in headlineMetrics" :key="option.metric" :value="option.metric">{{ option.label }}</SelectItem></SelectContent></Select>
      <Button variant="outline" :disabled="ids.length >= 8" @click="picker = true"><Plus class="size-4" aria-hidden="true" />{{ t('results.compare.add') }}</Button>
      <TabsList :aria-label="t('results.compare.view')"><TabsTrigger value="cards">{{ t('results.compare.cardsAndPlots') }}</TabsTrigger><TabsTrigger value="table">{{ t('results.compare.table') }}</TabsTrigger></TabsList>
    </div>
    <Dialog v-model:open="picker">
      <DialogContent class="sm:max-w-lg"><DialogHeader><DialogTitle>{{ t('results.compare.add') }}</DialogTitle><DialogDescription>{{ t('results.compare.pickerDescription') }}</DialogDescription></DialogHeader>
        <div class="relative"><Search class="absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input v-model="search" class="pl-9" :placeholder="t('results.compare.search')" :aria-label="t('results.compare.search')" /></div>
        <p v-if="message" role="status" class="text-sm text-destructive">{{ clientMessage(message) }}</p>
        <div class="max-h-80 overflow-y-auto overscroll-contain" :aria-busy="loading"><button v-for="run in eligible" :key="run.run_id" type="button" :class="styles.pickerRow" @click="add(run.run_id)"><span class="min-w-0"><span class="block truncate text-sm font-semibold">{{ parentTitle(run) ?? run.run_id }}</span><span class="block truncate text-xs text-muted-foreground">{{ pathName(run.summary?.data_path) || t('results.unknownDataset') }}</span><span class="block font-mono text-[10px] text-muted-foreground">{{ run.run_id.slice(0, 8) }}</span></span><Plus class="size-4 shrink-0" aria-hidden="true" /></button><p v-if="!eligible.length" class="py-6 text-center text-sm text-muted-foreground">{{ loading ? t('results.compare.loading') : t('results.compare.noMatches') }}</p></div>
        <div class="flex items-center justify-between"><Button variant="ghost" size="icon" :disabled="loading || page === 0" :aria-label="t('runs.previous')" @click="refresh(Math.max(0, page - 50))"><ChevronLeft aria-hidden="true" /></Button><span class="text-xs text-muted-foreground">{{ t('runs.page', { page: Math.floor(page / 50) + 1 }) }}</span><Button variant="ghost" size="icon" :disabled="loading || runs.length < 50" :aria-label="t('runs.next')" @click="refresh(page + 50)"><ChevronRight aria-hidden="true" /></Button></div>
      </DialogContent>
    </Dialog>
  </header>
</template>

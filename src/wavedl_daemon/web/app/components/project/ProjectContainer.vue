<script setup lang="ts">
import { cn } from '@/lib/utils';
import { useForm } from 'vee-validate';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Info,
  OctagonAlert,
  TriangleAlert,
  Undo2,
  X,
} from '@lucide/vue';
import { automaticRuntime, hostAccelerator, matchesAutomatic } from '../../lib/host-runtime';
import type { RuntimeSetup } from '../../../shared/schemas/host-profile';
import {
  projectBlockMessageKeys,
  runActivityMessageKeysFor,
  runStateMessageKeys,
  trainingChoiceLabel,
  trainingFieldMessageKeys,
  trainingPresetMessageKeysFor,
} from '../../i18n/dynamic-keys';
import {
  trainingDefaults,
  trainingRequestSchema,
  type TrainingRequest,
} from '../../../shared/schemas/training-request';
import { projectBlocks, type ProjectBlock } from '../../../shared/schemas/project-draft';
import { ConnectionSessionError, type ConnectionSession } from '../../lib/connection-session';
import { applyTrainingPreferences, loadTrainingPreferences } from '../../lib/preferences';
import { CatalogApi } from '../../lib/catalog-api';
import { ProjectPlan } from '../../lib/project-plan';
import { modelShapeGuidance } from '../../lib/model-shape-guidance';
import { applyTrainingPreset } from '../../lib/training-presets';
import {
  changedFromDefault,
  compactNumber,
  essentialTrainingFields,
  matchingPreset,
  trainingRecipes,
  trainingSections,
} from '../../lib/training-layout';
import { draftSetup, draftRequest } from '../../lib/project-draft';
import { draftConfigFields } from '../../../shared/schemas/project-draft';
import { trainingCommand } from '../../lib/training-export';
import type { PlanView, RunView } from '~~/types/daemon-api';
import type { DataSelection, ModelDescription, ModelSelection } from '~~/types/catalog-api';
import type { DatasetInspection } from '~~/types/dataset-inspection';
import type { TrainingFieldName } from '~~/types/training-layout';
import type { PlanCommand, ReadinessItem } from '~~/types/plan-summary';
import type { PipelineBlock, DraftSummary } from '~~/types/project-draft';
import type { PendingRunClone } from '~~/types/run-clone';

const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();

function stateLabel(run: RunView): string {
  const activity = runActivityMessageKeysFor(run);
  const state = t(runStateMessageKeys[run.state]);

  return activity ? `${state} · ${t(activity.label)}` : state;
}

const props = defineProps<{ session: ConnectionSession }>();

const emit = defineEmits<{
  submitted: [run: RunView];
}>();

const panelId = useId();
const importInput = useTemplateRef<HTMLInputElement>('importInput');
const stepTop = useTemplateRef<HTMLElement>('stepTop');
const stepHeader = useTemplateRef('stepHeader');
const pipelineBottom = shallowRef(0);
const reduceMotion = useReducedMotion();

function daemonId(): string | null {
  return toRaw(props.session).snapshot().health?.daemon_id ?? null;
}

function defaults(): TrainingRequest {
  const id = daemonId();

  return {
    backend: 'local',
    operation: 'train',
    config: id
      ? applyTrainingPreferences(structuredClone(trainingDefaults), loadTrainingPreferences(id))
      : structuredClone(trainingDefaults),
    runtime: { python: '', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  };
}

const { handleSubmit, values, setFieldValue, resetForm, validate } = useForm<TrainingRequest>({
  initialValues: defaults(),
  validationSchema: trainingRequestSchema,
  keepValuesOnUnmount: true,
});

const catalogue = useModelCatalogue(() => props.session);
const host = useHostProfile(() => props.session);

/** Automatic plans the detected Local setup; Manual leaves every runtime value to the user. */
const setup = shallowRef<RuntimeSetup>('automatic');

const data = shallowRef<DataSelection | null>(null);
const datasetInspection = shallowRef<DatasetInspection | null>(null);
const model = shallowRef<ModelSelection | null>(null);
const plan = shallowRef<PlanView | null>(null);
const acknowledged = shallowRef<RunView | null>(null);
const busy = shallowRef(false);
const message = shallowRef('');
const reportedRun = shallowRef<RunView | null>(null);
const connected = shallowRef(false);
const active = shallowRef<ProjectBlock>('dataset');

/** Bumped whenever a connection scope retires; inspectors drop transient UI state. */
const scope = shallowRef(0);

const { isActive: isClonePageActive } = usePageActive();

const projectDraftState = useProjectDraft({
  session: () => props.session,
  daemonId,
  defaults,
  form: { values, resetForm, setFieldValue },
  data,
  model,
  datasetInspection,
  active,
  setup,
  scope,
  connected,
  pageActive: isClonePageActive,
  models: catalogue.models,
  catalogueSelection: catalogue.select,
  selectData,
  selectModel,
  retireScope,
  fieldLabel,
  t,
  clientMessage,
});

const {
  offered,
  pendingModel,
  dragging,
  savedAt,
  notice,
  announce,
  clearNotice,
  continueDraft,
  startFresh,
  pickedFile,
  dragEnter,
  dragLeave,
  drop,
  exportNotice,
} = projectDraftState;

const displayMessage = computed(() =>
  message.value === 'reported' && reportedRun.value
    ? t('project.reportedStatus', {
        state: stateLabel(reportedRun.value),
        submission: t(
          reportedRun.value.submission_requested
            ? 'project.submissionRequested'
            : 'project.notSubmittedYet',
        ),
      })
    : message.value === 'project.submissionAckUnknown'
      ? t('project.submissionOutcomeUnknown')
      : message.value.startsWith('project.')
        ? t(message.value)
        : clientMessage(message.value),
);

/** Messages that block planning read as errors; an unknown outcome is a caution. */
const blockingMessages = [
  'project.planValidationRequired',
  'project.selectionRequired',
  'project.selectionStale',
  'project.planRefused',
];

const messageTone = computed(() =>
  blockingMessages.includes(message.value)
    ? 'destructive'
    : message.value === 'project.submissionAckUnknown'
      ? 'warning'
      : 'default',
);

/** The blocks a blocked plan points at, each one click from its fix. */
const blockedBlocks = computed<ProjectBlock[]>(() => {
  if (messageTone.value !== 'destructive') return [];
  const pending = new Set<ProjectBlock>(issues.value);

  if (!data.value) pending.add('dataset');

  if (!model.value) pending.add('model');

  return projectBlocks.filter((block) => pending.has(block));
});

let workflow = new ProjectPlan(props.session);
let pending: AbortController | null = null;
let epoch = 0;
let autoPreviewAttempted = false;
const draftRevision = shallowRef(0);
let unsubscribe: (() => void) | undefined;

function invalidate() {
  autoPreviewAttempted = false;
  draftRevision.value++;
  epoch++;
  pending?.abort();
  pending = null;
  busy.value = false;
  plan.value = null;
  workflow.invalidate();
}

watch(
  projectDraftState.binding.retired,
  (retired) => {
    if (retired?.daemonId === daemonId() && retired?.runId === plan.value?.run_id) invalidate();
  },
  { flush: 'sync' },
);

function retireScope() {
  projectDraftState.retire();
  const id = daemonId();

  if (id) projectDraftState.binding.bind(id, null);
  scope.value++;
  invalidate();
  data.value = null;
  datasetInspection.value = null;
  model.value = null;
  acknowledged.value = null;
  reportedRun.value = null;
  message.value = '';
}

watch(
  values,
  () => {
    invalidate();
    projectDraftState.edited();
  },
  { deep: true, flush: 'sync' },
);

watch(
  () => props.session,
  (session) => {
    unsubscribe?.();
    retireScope();
    workflow = new ProjectPlan(session);
    let revision = -1;
    unsubscribe = toRaw(session).subscribe((state) => {
      if (toRaw(props.session) !== toRaw(session)) return;
      const wasConnected = connected.value;
      connected.value = state.status === 'connected';
      const fresh = state.revision !== revision;

      if (fresh || !connected.value) {
        revision = state.revision;
        retireScope();
      }

      // The revision bumps while still connecting, so offer on the transition to connected:
      // a verified connection offers the saved draft rather than silently replacing it.
      if (connected.value && (fresh || !wasConnected)) {
        projectDraftState.offerSaved();
      } else if (!connected.value) offered.value = null;
    });
  },
  { immediate: true, flush: 'sync' },
);

// ---- Selections -------------------------------------------------------------------------

function selectData(selection: DataSelection, restoring = false) {
  try {
    new CatalogApi(toRaw(props.session)).assertSelection(selection);
  } catch {
    return;
  }

  if (!restoring) projectDraftState.cancelRestore();
  data.value = selection;
  datasetInspection.value = null;
  setFieldValue('config.data_path', selection.path);

  if (active.value === 'dataset' && !model.value) active.value = 'model';
}

function inspectData(inspection: DatasetInspection | null, selection: DataSelection | null) {
  if (!selection || selection !== toRaw(data.value)) return;

  try {
    new CatalogApi(toRaw(props.session)).assertSelection(selection);
  } catch {
    return;
  }

  datasetInspection.value = inspection;
}

function selectModel(selection: ModelSelection, restoring = false) {
  try {
    new CatalogApi(toRaw(props.session)).assertSelection(selection);
  } catch {
    return;
  }

  if (!restoring) projectDraftState.cancelRestore();
  model.value = selection;
  pendingModel.value = null;
  setFieldValue('config.model', selection.model);
}

function chooseModel(description: ModelDescription, pretrained: boolean) {
  const selection = catalogue.select(description);

  if (!selection) return;
  selectModel(selection);
  setFieldValue('config.pretrained', pretrained);
}

function applyPreset(id: string) {
  const recipe = trainingRecipes.find((item) => item.id === id);

  if (recipe) {
    projectDraftState.cancelRestore();
    setFieldValue('config', applyTrainingPreset(values.config, recipe.config));
  }
}

function resetTraining() {
  projectDraftState.cancelRestore();
  const config = structuredClone(trainingDefaults);
  config.data_path = data.value?.path ?? config.data_path;
  config.model = model.value?.model ?? config.model;
  config.pretrained = values.config.pretrained;
  resetForm({ values: { ...values, config } });
}

// ---- Runtime setup ----------------------------------------------------------------------

/** Writes only what differs, so an unchanged setup never revokes an approved plan. */
function applyDetected() {
  const profile = host.profile.value;

  if (!profile || matchesAutomatic(values, profile)) return;
  const expected = automaticRuntime(profile);

  if (values.backend !== expected.backend) setFieldValue('backend', expected.backend);

  if (JSON.stringify(values.runtime) !== JSON.stringify(expected.runtime))
    setFieldValue('runtime', expected.runtime);

  if (JSON.stringify(values.topology) !== JSON.stringify(expected.topology))
    setFieldValue('topology', expected.topology);

  if (values.storage_map?.length) setFieldValue('storage_map', []);
}

// Automatic follows the profile and repairs any reset, restore or import that moved it.
watch(
  () =>
    setup.value === 'automatic' &&
    !!host.profile.value &&
    !matchesAutomatic(values, host.profile.value),
  (drifted) => {
    if (drifted) applyDetected();
  },
  { immediate: true },
);

// ---- Import -----------------------------------------------------------------------------

function openImport() {
  importInput.value?.click();
}

const planCommand = computed<PlanCommand | null>(() => {
  if (!plan.value) return null;

  try {
    return { ok: true, text: trainingCommand(values) };
  } catch (error) {
    return { ok: false, reason: clientMessage(error instanceof Error ? error : String(error)) };
  }
});

// ---- Planning workflow (unchanged semantics) ---------------------------------------------

type WorkOperation = 'preview' | 'submit' | 'status';

async function work(
  operation: WorkOperation,
  action: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>,
) {
  const current = ++epoch;
  pending?.abort();
  pending = new AbortController();
  busy.value = true;
  message.value = '';

  try {
    await action(pending.signal, () => current === epoch);
  } catch (error) {
    if (current === epoch) {
      message.value =
        operation === 'preview' &&
        error instanceof ConnectionSessionError &&
        error.code === 'request' &&
        error.status === 400
          ? 'project.planRefused'
          : 'project.submissionAckUnknown';
    }
  } finally {
    if (current === epoch) {
      busy.value = false;
      pending = null;
    }
  }
}

function preview(event?: Event) {
  const current = epoch;

  return handleSubmit(
    async (draft) => {
      if (current !== epoch) return;

      if (!data.value || !model.value) {
        message.value = 'project.selectionRequired';

        return;
      }

      try {
        workflow.prepare(draft, data.value, model.value);
      } catch {
        message.value = 'project.selectionStale';

        return;
      }

      await work('preview', async (signal, isCurrent) => {
        const previewScope = scope.value;
        const id = daemonId();

        const result = await workflow.preview(signal, {
          runId: projectDraftState.plannedRunId.value,
          bind: (runId) => {
            if (id && previewScope === scope.value) projectDraftState.bindPlan(runId);
          },
        });

        if (!isCurrent()) return;
        plan.value = result;
      });
    },
    ({ errors }) => {
      if (current !== epoch) return;
      message.value = 'project.planValidationRequired';
      const first = Object.keys(errors)[0];

      if (first) active.value = blockFor(first.split('.'));
    },
  )(event);
}

function submit() {
  if (!plan.value || !connected.value || busy.value || planSubmitted.value) return;

  return work('submit', async (signal, isCurrent) => {
    const run = await workflow.submit(signal);

    if (!isCurrent()) return;
    acknowledged.value = run;
    projectDraftState.submitted();
    emit('submitted', run);
  });
}

function status() {
  return work('status', async (signal, isCurrent) => {
    const run = await workflow.status(signal);

    if (!isCurrent()) return;
    reportedRun.value = run;
    message.value = 'reported';

    if (run.submission_requested) {
      acknowledged.value = run;
      projectDraftState.submitted();
      emit('submitted', run);
    }
  });
}

function openAcknowledged() {
  if (connected.value && acknowledged.value) emit('submitted', acknowledged.value);
}

function selectBlock(block: ProjectBlock) {
  // The start panel asks one question first; the strip only previews the draft.
  if (!offered.value) active.value = block;
}

/** The plan on screen is the one the daemon acknowledged; an edit starts a new plan. */
const planSubmitted = computed(
  () => !!plan.value && acknowledged.value?.request_id === plan.value.request_id,
);

function stopWaiting() {
  invalidate();
  // Stopping is deliberate: only an edit or an explicit retry prepares another plan.
  autoPreviewAttempted = true;
}

// ---- Derived presentation ---------------------------------------------------------------

function blockFor(path: readonly PropertyKey[]): ProjectBlock {
  const [root, field] = path;

  if (root === 'config')
    return field === 'data_path'
      ? 'dataset'
      : field === 'model' || field === 'pretrained'
        ? 'model'
        : 'training';

  return 'runtime';
}

const issues = computed(() => {
  const parsed = trainingRequestSchema.safeParse(values);

  return parsed.success ? [] : parsed.error.issues.map((issue) => blockFor(issue.path));
});

function issueCount(block: ProjectBlock): number {
  return issues.value.filter((item) => item === block).length;
}

const canPreview = computed(
  () => connected.value && !!data.value && !!model.value && !issues.value.length && !busy.value,
);

watch(
  [active, canPreview, draftRevision, offered, isClonePageActive],
  () => {
    if (
      !isClonePageActive.value ||
      active.value !== 'plan' ||
      offered.value ||
      plan.value ||
      planSubmitted.value ||
      busy.value
    )
      return;

    if (canPreview.value) {
      // Busy becoming false after a failed request must not trigger another request.
      if (autoPreviewAttempted) return;
      autoPreviewAttempted = true;
      void preview();

      return;
    }

    const current = epoch;
    void validate().then((result) => {
      if (current !== epoch || !isClonePageActive.value || active.value !== 'plan' || offered.value)
        return;

      if (!result.valid) message.value = 'project.planValidationRequired';
      else if (!data.value || !model.value) message.value = 'project.selectionRequired';
    });
  },
  { immediate: true },
);

const catalogueModel = computed(() =>
  catalogue.models.value.find((item) => item.id === model.value?.model),
);

const shapeStatus = computed(() =>
  catalogueModel.value
    ? modelShapeGuidance(
        datasetInspection.value,
        catalogueModel.value,
        values.config.single_channel,
      ).status
    : 'unknown',
);

function fieldLabel(name: TrainingFieldName): string {
  const keys = trainingFieldMessageKeys[name];

  return keys ? t(keys.label) : name;
}

const presetLabel = computed(() => {
  const id = matchingPreset(values.config);

  if (id === 'defaults') return t('builder.defaultsShort');
  const keys = id ? trainingPresetMessageKeysFor(id) : null;

  return keys ? t(keys.label) : t('builder.customRecipe');
});

// `pretrained` belongs to the Model block, so it is not a Training change.
const trainingFields = [
  ...essentialTrainingFields,
  ...trainingSections.flatMap((section) => section.fields),
];

const changedCount = computed(
  () => trainingFields.filter((name) => changedFromDefault(name, values.config)).length,
);

const deviceLabels: Record<TrainingRequest['runtime']['device'], string> = {
  cpu: 'builder.deviceCpu',
  cuda: 'builder.deviceCuda',
  mps: 'builder.deviceMps',
  auto: 'builder.deviceAuto',
};

const datasetName = computed(
  () => data.value?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? t('builder.nothingSelected'),
);

const modelName = computed(
  () =>
    catalogueModel.value?.displayName.replace(/ \(Pretrained\)$/, '') ??
    model.value?.model ??
    (pendingModel.value ? pendingModel.value : t('builder.nothingSelected')),
);

const pythonName = computed(() => {
  const python = values.runtime.python.trim();

  return python
    ? python.split(/[\\/]/).filter(Boolean).slice(-3).join('/')
    : t('builder.pythonNeeded');
});

const automaticShown = computed(() => setup.value === 'automatic' && !!host.profile.value);

const acceleratorLabel = computed(() => {
  const profile = host.profile.value;

  if (!profile) return '';
  const kind = hostAccelerator(profile);

  if (kind === 'cuda') return profile.accelerators?.cuda[0]?.name ?? t('builder.deviceCuda');

  if (kind === 'mps') return t('builder.appleGpu');

  return kind === 'cpu' ? t('builder.deviceCpu') : t('builder.deviceAuto');
});

const blocks = computed<PipelineBlock[]>(() => [
  {
    id: 'dataset',
    label: t(projectBlockMessageKeys.dataset),
    value: datasetName.value,
    detail: datasetInspection.value
      ? t('builder.datasetDetail', {
          samples: datasetInspection.value.numSamples.toLocaleString(),
          shape:
            datasetInspection.value.inputShape === null
              ? t('datasets.pickledInputShape')
              : datasetInspection.value.inputShape.join(' × '),
        })
      : data.value
        ? data.value.root
        : t('builder.chooseDataset'),
    state: data.value ? 'complete' : 'pending',
  },
  {
    id: 'model',
    label: t(projectBlockMessageKeys.model),
    value: modelName.value,
    detail: model.value
      ? model.value.source === 'custom'
        ? t('builder.customModelDetail')
        : t(values.config.pretrained ? 'builder.withWeights' : 'builder.fromScratch', {
            params: catalogueModel.value?.paramsM ?? '—',
          })
      : t('builder.chooseModel'),
    state: !model.value
      ? 'pending'
      : model.value.source === 'custom' || shapeStatus.value === 'mismatch' || issueCount('model')
        ? 'attention'
        : 'complete',
  },
  {
    id: 'training',
    label: t(projectBlockMessageKeys.training),
    value: presetLabel.value,
    detail: [
      t('builder.epochsShort', { epochs: values.config.epochs }),
      trainingChoiceLabel('optimizer', values.config.optimizer, t),
      changedCount.value ? t('project.nonDefaultFields', { count: changedCount.value }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    state: issueCount('training') ? 'attention' : 'complete',
  },
  {
    id: 'runtime',
    label: t(projectBlockMessageKeys.runtime),
    value: automaticShown.value
      ? acceleratorLabel.value
      : setup.value === 'automatic' && host.busy.value
        ? t('builder.detecting')
        : t(deviceLabels[values.runtime.device]),
    detail: automaticShown.value
      ? `${t('builder.setupAutomatic')} · ${host.profile.value?.hostname || t('builder.thisMachine')}`
      : `${t(
          values.backend === 'slurm' ? 'builder.backendSlurm' : 'builder.backendLocal',
        )} · ${pythonName.value}`,
    state: issueCount('runtime') ? 'pending' : 'complete',
  },
  {
    id: 'plan',
    label: t(projectBlockMessageKeys.plan),
    value: planSubmitted.value
      ? t('builder.submitted')
      : plan.value
        ? t('builder.planReady')
        : busy.value
          ? t('builder.preparingPlan')
          : t('builder.planPending'),
    detail:
      planSubmitted.value && acknowledged.value
        ? stateLabel(acknowledged.value)
        : plan.value
          ? t('builder.awaitingApproval')
          : t('builder.nothingStarts'),
    state: plan.value ? 'complete' : 'pending',
  },
]);

const activeIndex = computed(() => blocks.value.findIndex((block) => block.id === active.value));
const activeBlock = computed(() => blocks.value[activeIndex.value]);
const previousBlock = computed(() => blocks.value[activeIndex.value - 1]);
const nextBlock = computed(() => blocks.value[activeIndex.value + 1]);
const backDisabled = computed(() => busy.value || !previousBlock.value);

// Attention flags (custom model, shape warnings) inform but don't block; pending steps and
// validation issues do.
const stepBlocked = computed(() => {
  const block = activeBlock.value;

  return !block || block.state === 'pending' || issueCount(block.id) > 0;
});

const nextDisabled = computed(() => busy.value || !nextBlock.value || stepBlocked.value);

const stepMessages: Record<ProjectBlock, string> = {
  dataset: 'builder.datasetTitle',
  model: 'builder.modelTitle',
  training: 'builder.trainingTitle',
  runtime: 'builder.runtimeTitle',
  plan: 'builder.planTitle',
};

const nextHint = computed(() => {
  const block = activeBlock.value;

  if (!block || !nextBlock.value || !stepBlocked.value || busy.value) return '';

  return t(issueCount(block.id) ? 'project.stepNeedsReview' : 'project.stepIncomplete', {
    detail: issueCount(block.id)
      ? t('builder.issueCount', { count: issueCount(block.id) })
      : block.detail,
  });
});

async function navigateStep(direction: 'back' | 'next') {
  if (direction === 'back' ? backDisabled.value : nextDisabled.value) return;
  const target = direction === 'back' ? previousBlock.value : nextBlock.value;

  if (!target || offered.value) return;
  selectBlock(target.id);
  await nextTick();
  stepHeader.value?.focusHeading();
  stepTop.value?.scrollIntoView({
    block: 'start',
    behavior: reduceMotion.value ? 'instant' : 'smooth',
  });
}

const readiness = computed<ReadinessItem[]>(() =>
  blocks.value.flatMap((block) =>
    block.id !== 'plan'
      ? [
          {
            block: block.id,
            label: block.label,
            detail: issueCount(block.id)
              ? t('builder.issueCount', { count: issueCount(block.id) })
              : `${block.value} · ${block.detail}`,
            done: block.state !== 'pending' && !issueCount(block.id),
          },
        ]
      : [],
  ),
);

const draftSummary = computed<DraftSummary | null>(() => {
  const draft = offered.value;

  if (!draft) return null;
  const restored = draftRequest(draft, defaults());
  const presetId = matchingPreset(restored.config);
  const presetKeys = presetId ? trainingPresetMessageKeysFor(presetId) : null;
  const preset = presetId ? trainingRecipes.find((item) => item.id === presetId) : null;

  return {
    savedAt: draft.savedAt,
    steps: [
      {
        label: t(projectBlockMessageKeys.dataset),
        value: draft.dataset?.relativePath.split('/').at(-1) ?? '—',
        done: !!draft.dataset,
      },
      {
        label: t(projectBlockMessageKeys.model),
        value: draft.model?.id ?? '—',
        done: !!draft.model,
      },
      {
        label: t(projectBlockMessageKeys.training),
        value: presetKeys ? t(presetKeys.label) : t('builder.customRecipe'),
        done: true,
      },
      {
        label: t(projectBlockMessageKeys.runtime),
        value:
          draftSetup(draft) === 'automatic'
            ? t('builder.setupAutomatic')
            : t(deviceLabels[draft.runtime.device]),
        done: draftSetup(draft) === 'automatic' || !!draft.runtime.python.trim(),
      },
    ],
    changes: preset
      ? []
      : draftConfigFields
          .filter((name) => changedFromDefault(name, restored.config))
          .slice(0, 4)
          .map((name) => {
            const value = restored.config[name];

            return `${fieldLabel(name)} ${
              value === true || value === false
                ? t(value ? 'builder.on' : 'builder.off')
                : value === null || value === undefined || Array.isArray(value)
                  ? '…'
                  : Number.isFinite(value)
                    ? compactNumber(Number(value))
                    : trainingChoiceLabel(name, String(value), t)
            }`;
          }),
  };
});

const savedRecently = computed(() => savedAt.value !== null);

onBeforeUnmount(() => {
  unsubscribe?.();
  retireScope();
});

const projectStyles = {
  draftSaved: cn('[animation:draft-saved-in_420ms_cubic-bezier(0.22,_1,_0.36,_1)]'),
  runBuilderMuted: cn(
    'opacity-55 [filter:saturate(0.4)] [transition:opacity_400ms_ease,_filter_400ms_ease]',
  ),
  runBuilderPanel: cn(
    'flex min-h-96 flex-col gap-6 rounded-[1.5rem] [transition:box-shadow_200ms_ease]',
    '[scroll-margin-top:calc(var(--run-pipeline-bottom,_0px)_+_0.75rem)]',
    "[&[data-dragging='true']]:shadow-[0_0_0_2px_var(--primary)]",
  ),
  runMessage: cn(
    'rounded-[1rem] [animation:run-message-in_360ms_cubic-bezier(0.34,_1.56,_0.64,_1)]',
    "[&[data-tone='destructive']]:shadow-[0_14px_30px_-22px_rgb(220_38_38_/_0.55)]",
  ),
  runMessageFix: cn(
    'inline-flex items-center gap-[0.35rem] py-[0.3rem] px-[0.7rem] rounded-full text-[0.78rem] font-semibold',
    '[background:color-mix(in_srgb,_currentColor_10%,_transparent)] [transition:background-color_150ms_ease]',
    '[&:hover]:[background:color-mix(in_srgb,_currentColor_18%,_transparent)] [&_svg]:size-[0.8rem]',
  ),
  runNotice: cn(
    'flex items-start gap-3 p-[0.75rem_0.75rem_0.75rem_1rem] rounded-[1rem] bg-surface',
    'shadow-[0_0_0_0.5px_color-mix(in_srgb,_var(--foreground)_12%,_transparent),_0_16px_36px_-20px_rgb(0_0_0_/_0.35)]',
    "[&[data-tone='success']_.run-notice-icon]:text-success [&[data-tone='warning']_.run-notice-icon]:text-warning",
  ),
  runNoticeEnterActive: cn(
    '[transition:opacity_260ms_ease,_transform_360ms_cubic-bezier(0.34,_1.56,_0.64,_1)]',
  ),
  runNoticeLeaveActive: cn('[transition:opacity_160ms_ease,_transform_160ms_ease]'),
  runNoticeEnterFrom: cn('opacity-0 [transform:translateY(-6px)_scale(0.98)]'),
  runNoticeLeaveTo: cn('opacity-0 [transform:translateY(-6px)_scale(0.98)]'),
  runNoticeIcon: cn('size-[1.1rem] flex-none mt-[0.1rem] text-primary'),
};

// A run clone is a one-shot import, never an old approval or old catalogue selection.
const runCloneImport = useRunClone();

async function consumeRunClone(value: PendingRunClone) {
  offered.value = null;
  retireScope();
  projectDraftState.binding.bind(value.draft.daemonId, value.draft.plannedRunId ?? null);
  setup.value = 'manual';
  const fresh = draftRequest(value.draft, defaults());
  resetForm({
    values: {
      ...fresh,
      config: {
        ...fresh.config,
        data_path: value.imported.dataPath ?? '',
        model: value.imported.model ?? '',
      },
    },
  });
  active.value = 'plan';
  const api = new CatalogApi(toRaw(props.session));
  const missing: string[] = [];
  const controller = new AbortController();
  const cloneScope = scope.value;
  const cancel = watch([scope, isClonePageActive], () => controller.abort(), { flush: 'sync' });

  try {
    if (value.imported.dataPath) {
      const current = epoch;

      try {
        const selection = await api.locate(value.imported.dataPath, controller.signal);

        if (controller.signal.aborted || current !== epoch || cloneScope !== scope.value) return;

        if (selection?.kind === 'file') selectData(selection);
        else missing.push(value.imported.dataPath);
      } catch {
        if (controller.signal.aborted || current !== epoch || cloneScope !== scope.value) return;
        missing.push(value.imported.dataPath);
      }
    }

    if (value.imported.model) {
      const current = epoch;
      const known = catalogue.models.value.find((item) => item.id === value.imported.model);

      try {
        const selection = known
          ? catalogue.select(known)
          : await api.selectCustomModel(value.imported.model, controller.signal);

        if (controller.signal.aborted || current !== epoch || cloneScope !== scope.value) return;

        if (selection) selectModel(selection);
        else missing.push(value.imported.model);
      } catch {
        if (controller.signal.aborted || current !== epoch || cloneScope !== scope.value) return;
        missing.push(value.imported.model);
      }
    }

    if (controller.signal.aborted || cloneScope !== scope.value) return;
    announce({
      tone: missing.length || value.imported.skipped.length ? 'warning' : 'success',
      title: () => t('project.clonedConfiguration'),
      detail: () =>
        [
          t('project.cloneReviewHelp'),
          missing.length ? t('builder.importMissing', { items: missing.join(', ') }) : '',
          value.imported.skipped.length
            ? t('builder.importSkipped', { keys: value.imported.skipped.join(', ') })
            : '',
        ]
          .filter(Boolean)
          .join(' '),
    });
  } finally {
    cancel();
    controller.abort();
  }
}

watch(
  [connected, () => catalogue.busy.value, () => runCloneImport.pending.value, isClonePageActive],
  ([online, loading, _pending, visible]) => {
    const id = daemonId();

    if (!visible || !online || loading || !id || !runCloneImport.pending.value) return;
    const value = runCloneImport.consume(id);

    if (value) void consumeRunClone(value);
  },
  { immediate: true },
);
</script>
<template>
  <section
    class="run-builder mx-auto flex w-full max-w-6xl flex-col gap-6"
    aria-labelledby="project-title"
    :style="{ '--run-pipeline-bottom': `${pipelineBottom}px` }"
    @dragenter="dragEnter"
    @dragleave="dragLeave"
    @dragover.prevent
    @drop.prevent="drop"
  >
    <MotionConfig reduced-motion="user">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <h1 id="project-title" class="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">
            {{ t('project.buildATrainingRun') }}
          </h1>
          <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {{ t('builder.subtitle') }}
            <span
              v-if="savedRecently && !offered"
              :class="cn('inline-flex items-center gap-1 text-xs', projectStyles.draftSaved)"
              role="status"
            >
              <Check class="size-3 text-success" aria-hidden="true" />{{ t('builder.draftSaved') }}
            </span>
          </p>
        </div>
        <ConfigMenu
          :draft="values"
          :disabled="busy || !connected"
          @import="openImport"
          @notice="exportNotice"
        />
        <input
          id="training-config-import"
          ref="importInput"
          type="file"
          class="sr-only"
          accept=".yaml,.yml,.json,application/yaml,application/json"
          tabindex="-1"
          :aria-label="t('builder.importConfig')"
          @change="pickedFile"
        />
      </header>

      <Alert v-if="!connected">
        <AlertTitle>{{ t('project.verifiedConnectionRequired') }}</AlertTitle>
        <AlertDescription>{{ t('project.connectionRequired') }}</AlertDescription>
      </Alert>

      <RunPipeline
        :blocks="blocks"
        :active="active"
        :panel-id="panelId"
        :class="offered ? projectStyles.runBuilderMuted : ''"
        @select="selectBlock"
        @measure="pipelineBottom = $event"
      />

      <Transition
        :enter-active-class="projectStyles.runNoticeEnterActive"
        :leave-active-class="projectStyles.runNoticeLeaveActive"
        :enter-from-class="projectStyles.runNoticeEnterFrom"
        :leave-to-class="projectStyles.runNoticeLeaveTo"
        mode="out-in"
      >
        <div
          v-if="notice"
          :key="notice.id"
          :class="projectStyles.runNotice"
          :data-tone="notice.tone"
          role="status"
        >
          <Check
            v-if="notice.tone === 'success'"
            :class="cn('run-notice-icon', projectStyles.runNoticeIcon)"
            aria-hidden="true"
          />
          <CircleAlert
            v-else-if="notice.tone === 'warning'"
            :class="cn('run-notice-icon', projectStyles.runNoticeIcon)"
            aria-hidden="true"
          />
          <Info
            v-else
            :class="cn('run-notice-icon', projectStyles.runNoticeIcon)"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ notice.title() }}</p>
            <p v-if="notice.detail" class="mt-0.5 text-xs break-words text-muted-foreground">
              {{ notice.detail() }}
            </p>
          </div>
          <Button v-if="notice.undo" type="button" size="sm" variant="ghost" @click="notice.undo">
            <Undo2 aria-hidden="true" />{{ t('builder.undo') }}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            :aria-label="t('builder.dismiss')"
            @click="clearNotice"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </Transition>

      <Alert
        v-if="message"
        role="alert"
        :variant="messageTone"
        :class="projectStyles.runMessage"
        :data-tone="messageTone"
      >
        <OctagonAlert v-if="messageTone === 'destructive'" aria-hidden="true" />
        <TriangleAlert v-else-if="messageTone === 'warning'" aria-hidden="true" />
        <Info v-else aria-hidden="true" />
        <AlertTitle>
          {{
            messageTone === 'destructive' ? t('builder.planBlocked') : t('project.planningStatus')
          }}
        </AlertTitle>
        <AlertDescription>
          <p>
            {{
              message === 'project.submissionAckUnknown'
                ? t('project.submissionAckUnknown')
                : displayMessage
            }}
          </p>
          <div v-if="blockedBlocks.length" class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="block in blockedBlocks"
              :key="block"
              type="button"
              :class="projectStyles.runMessageFix"
              @click="selectBlock(block)"
            >
              {{ t(projectBlockMessageKeys[block]) }}
              <span v-if="issueCount(block)" class="opacity-75"
                >· {{ t('builder.issueCount', { count: issueCount(block) }) }}</span
              >
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </AlertDescription>
      </Alert>

      <StartPanel
        v-if="offered && draftSummary"
        :summary="draftSummary"
        :dragging="dragging"
        @continue="continueDraft"
        @import="openImport"
        @fresh="startFresh"
      />

      <form
        v-show="!offered"
        ref="stepTop"
        :id="panelId"
        role="tabpanel"
        :aria-labelledby="`${panelId}-tab-${active}`"
        :class="
          cn(
            projectStyles.runBuilderPanel,
            planSubmitted && active === 'plan' && 'flex flex-1 flex-col',
          )
        "
        :data-dragging="dragging"
        novalidate
        @submit.prevent
      >
        <StepHeader ref="stepHeader" :title="t(stepMessages[active])" />
        <DatasetInspector
          v-show="active === 'dataset'"
          :active="active === 'dataset'"
          :session="session"
          :selection="data"
          :inspection="datasetInspection"
          @select="selectData"
          @inspected="inspectData"
        />
        <ModelInspector
          v-show="active === 'model'"
          :session="session"
          :models="catalogue.models.value"
          :busy="catalogue.busy.value"
          :message="catalogue.message.value"
          :selection="model"
          :pretrained="values.config.pretrained"
          :inspection="datasetInspection"
          :single-channel="values.config.single_channel"
          :disabled="busy || !connected"
          @choose="chooseModel"
          @custom="selectModel"
          @reload="catalogue.load"
        />
        <TrainingInspector
          v-show="active === 'training'"
          :scope="scope"
          :disabled="busy"
          @preset="applyPreset"
          @reset="resetTraining"
        />
        <RuntimeInspector
          v-show="active === 'runtime'"
          v-model:setup="setup"
          :profile="host.profile.value"
          :detecting="host.busy.value"
          :disabled="busy"
          @environment="setFieldValue('runtime.environment', $event)"
          @storage="setFieldValue('storage_map', $event)"
          @detect="host.load"
          @detected="applyDetected"
        />
        <PlanInspector
          v-show="active === 'plan'"
          :plan="plan"
          :command="planCommand"
          :acknowledged="acknowledged"
          :readiness="readiness"
          :can-preview="canPreview"
          :busy="busy"
          :connected="connected"
          @retry="preview"
          @status="status"
          @open="openAcknowledged"
          @stop="stopWaiting"
          @fresh="startFresh"
          @go="active = $event"
        />
        <StepNav
          :show-back="!!previousBlock"
          :back-disabled="backDisabled"
          :next-disabled="nextDisabled"
          :next-hint="nextHint"
          :final="active === 'plan'"
          :submitted="planSubmitted"
          :start-disabled="!plan || !connected || busy || planSubmitted"
          :busy="busy"
          :connected="connected"
          @back="navigateStep('back')"
          @next="navigateStep('next')"
          @start="submit"
          @open="openAcknowledged"
        />
      </form>
    </MotionConfig>
  </section>
</template>

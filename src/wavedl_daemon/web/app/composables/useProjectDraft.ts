import type { FormContext } from 'vee-validate';
import type { Ref } from 'vue';
import { clientError } from '../i18n/client-messages';
import { CatalogApi } from '../lib/catalog-api';
import type { ConnectionSession } from '../lib/connection-session';
import { CONFIG_IMPORT_LIMIT, parseTrainingConfig } from '../lib/training-import';
import {
  clearProjectDraft,
  draftSetup,
  draftRequest,
  loadProjectDraft,
  projectDraft,
  saveProjectDraft,
  validDraftConfig,
} from '../lib/project-draft';
import type { ProjectBlock, ProjectDraft } from '../../shared/schemas/project-draft';
import type { RuntimeSetup } from '../../shared/schemas/host-profile';
import type { TrainingRequest } from '../../shared/schemas/training-request';
import type { DataSelection, ModelDescription, ModelSelection } from '~~/types/catalog-api';
import type { DatasetInspection } from '~~/types/dataset-inspection';
import type { TrainingFieldName } from '~~/types/training-layout';

interface ProjectDraftOptions {
  session: () => ConnectionSession;
  daemonId: () => string | null;
  defaults: () => TrainingRequest;
  form: Pick<FormContext<TrainingRequest>, 'values' | 'resetForm' | 'setFieldValue'>;
  data: Ref<DataSelection | null>;
  model: Ref<ModelSelection | null>;
  datasetInspection: Ref<DatasetInspection | null>;
  active: Ref<ProjectBlock>;
  setup: Ref<RuntimeSetup>;
  scope: Readonly<Ref<number>>;
  connected: Readonly<Ref<boolean>>;
  pageActive: Readonly<Ref<boolean>>;
  models: Readonly<Ref<readonly ModelDescription[]>>;
  catalogueSelection: (description: ModelDescription) => ModelSelection | null;
  selectData: (selection: DataSelection, restoring: boolean) => void;
  selectModel: (selection: ModelSelection, restoring: boolean) => void;
  retireScope: () => void;
  fieldLabel: (name: TrainingFieldName) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
  clientMessage: ReturnType<typeof useClientMessages>['clientMessage'];
}

/** Daemon-scoped draft storage and explicit restore/import handoffs; never owns approval. */
export function useProjectDraft(options: ProjectDraftOptions) {
  const { values, resetForm, setFieldValue } = options.form;

  const {
    daemonId,
    defaults,
    data,
    model,
    datasetInspection,
    active,
    setup,
    connected,
    selectData,
    selectModel,
    retireScope,
    fieldLabel,
    t,
    clientMessage,
  } = options;

  const binding = usePlannedRunBinding();
  const plannedRunId = computed(() => binding.runId(daemonId()));
  const offered = shallowRef<ProjectDraft | null>(null);
  watch(
    binding.retired,
    (retired) => {
      const draft = offered.value;

      if (draft && retired?.daemonId === draft.daemonId && retired.runId === draft.plannedRunId)
        offered.value = { ...draft, plannedRunId: undefined };
    },
    { flush: 'sync' },
  );
  const pendingModel = shallowRef<string | null>(null);
  const dragging = shallowRef(false);
  const savedAt = shallowRef<number | null>(null);
  // Restoring selections writes form values, so it must not share the plan invalidation epoch.
  let restoreEpoch = 0;
  let submittedDraft = false;

  function cancelRestore() {
    restoreEpoch++;
    pendingModel.value = null;
  }

  /** Title and detail are read at render time so a visible notice follows the locale. */
  interface Notice {
    readonly id: number;
    readonly tone: 'success' | 'info' | 'warning';
    readonly title: () => string;
    readonly detail?: () => string;
    readonly undo?: () => void;
  }

  const notice = shallowRef<Notice | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
    notice.value = null;
  }

  function announce(value: Omit<Notice, 'id'>) {
    clearTimeout(noticeTimer);
    notice.value = { ...value, id: Date.now() };
    noticeTimer = setTimeout(() => (notice.value = null), value.undo ? 12000 : 6000);
  }

  // Draft restore and import name a model before the catalogue may have loaded.
  watch([options.models, pendingModel], ([models, id]) => {
    if (!id || !models.length) return;
    const description = models.find((item) => item.id === id);
    const selection = description ? options.catalogueSelection(description) : null;

    if (selection) selectModel(selection, true);
    else {
      pendingModel.value = null;
      announce({ tone: 'warning', title: () => t('builder.modelMissing', { model: id }) });
    }
  });

  /** Automatic runtime values are detected, not authored, so they alone are not worth saving. */
  function meaningful(): boolean {
    const fresh = defaults();
    const { config, ...rest } = toRaw(values);
    const { config: freshConfig, ...freshRest } = fresh;

    return (
      !!data.value ||
      !!model.value ||
      JSON.stringify(config) !== JSON.stringify(freshConfig) ||
      (setup.value === 'manual' && JSON.stringify(rest) !== JSON.stringify(freshRest))
    );
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  watch(
    [values, data, model, active, setup, plannedRunId],
    () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const id = daemonId();

        // Never overwrite a draft the user has not yet chosen to continue or discard.
        if (!id || offered.value || submittedDraft || !connected.value) return;

        if (!meaningful()) return;

        if (
          saveProjectDraft(id, {
            plannedRunId: plannedRunId.value ?? undefined,
            block: active.value,
            data: data.value,
            model: model.value,
            request: values,
            setup: setup.value,
          })
        )
          savedAt.value = Date.now();
      }, 450);
    },
    { deep: true },
  );

  // A newly created association must survive a reload even before the debounce fires.
  function bindPlan(runId: string | null) {
    const id = daemonId();

    if (id) binding.bind(id, runId);

    if (!runId || !id || offered.value || submittedDraft || !connected.value) return;
    saveProjectDraft(id, {
      plannedRunId: runId,
      block: active.value,
      data: data.value,
      model: model.value,
      request: values,
      setup: setup.value,
    });
  }

  async function restoreSelections(
    dataset: ProjectDraft['dataset'],
    chosen: ProjectDraft['model'],
    isCurrent: () => boolean,
  ): Promise<string[]> {
    const api = new CatalogApi(toRaw(options.session()));
    const missing: string[] = [];

    if (dataset) {
      try {
        const selection = await api.resolve(dataset.root, dataset.relativePath);

        if (!isCurrent()) return missing;

        if (selection.kind === 'file') selectData(selection, true);
      } catch {
        if (!isCurrent()) return missing;
        missing.push(dataset.relativePath);
      }
    }

    if (!isCurrent()) return missing;

    if (chosen?.custom) {
      try {
        const selection = await api.selectCustomModel(chosen.id);

        if (!isCurrent()) return missing;
        selectModel(selection, true);
      } catch {
        if (!isCurrent()) return missing;
        missing.push(chosen.id);
      }
    } else if (chosen) pendingModel.value = chosen.id;

    return missing;
  }

  async function continueDraft() {
    const draft = offered.value;

    if (!draft) return;
    cancelRestore();
    const current = restoreEpoch;
    offered.value = null;
    binding.bind(draft.daemonId, draft.plannedRunId ?? null);
    setup.value = draftSetup(draft);
    resetForm({ values: draftRequest(draft, defaults()) });

    const missing = await restoreSelections(
      draft.dataset,
      draft.model,
      () => current === restoreEpoch,
    );

    if (current !== restoreEpoch) return;
    active.value = !data.value ? 'dataset' : !draft.model ? 'model' : draft.block;

    if (missing.length)
      announce({
        tone: 'warning',
        title: () => t('builder.restoreIncomplete'),
        detail: () => missing.join(', '),
      });
  }

  function startFresh() {
    const id = daemonId();

    if (id) clearProjectDraft(id);
    offered.value = null;
    retireScope();
    setup.value = 'automatic';
    resetForm({ values: defaults() });
    active.value = 'dataset';
    savedAt.value = null;
  }

  async function importFile(file: File) {
    cancelRestore();
    const current = restoreEpoch;
    const isCurrent = () => current === restoreEpoch;

    if (file.size > CONFIG_IMPORT_LIMIT) {
      announce({
        tone: 'warning',
        title: () => clientMessage(clientError('configImportTooLarge')),
      });

      return;
    }

    let imported: ReturnType<typeof parseTrainingConfig>;

    try {
      const text = await file.text();

      if (!isCurrent()) return;
      imported = parseTrainingConfig(text);
    } catch (error) {
      if (!isCurrent()) return;
      announce({
        tone: 'warning',
        title: () => t('builder.importFailed', { file: file.name }),
        detail: () => clientMessage(error instanceof Error ? error : String(error)),
      });

      return;
    }

    const id = daemonId();

    // Field-wise snapshot (no deep clone of reactive state); environment values are copied.
    const before = id
      ? {
          draft: projectDraft(id, {
            plannedRunId: plannedRunId.value ?? undefined,
            block: active.value,
            data: data.value,
            model: model.value,
            request: values,
            setup: setup.value,
          }),
          environment: { ...values.runtime.environment },
          data: data.value,
          model: model.value,
          inspection: datasetInspection.value,
          scope: options.scope.value,
        }
      : null;

    offered.value = null;
    // Fields that choose which code or checkpoint the run executes never arrive by file:
    // like presets, an import cannot retarget executable code or checkpoints.
    const withheld = codeFields.filter((name) => imported.config[name] !== undefined);

    const applied = validDraftConfig(
      Object.fromEntries(
        Object.entries(imported.config).filter(([name]) => !withheld.some((code) => code === name)),
      ),
    );

    const next = {
      ...values.config,
      ...applied,
      data_path: values.config.data_path,
      model: values.config.model,
    };

    // An import that changes nothing must not revoke an approved plan.
    if (JSON.stringify(next) !== JSON.stringify(values.config)) setFieldValue('config', next);
    const missing: string[] = [];

    if (imported.dataPath) {
      try {
        const selection = await new CatalogApi(toRaw(options.session())).locate(imported.dataPath);

        if (!isCurrent()) return;

        if (selection?.kind === 'file') selectData(selection, true);
        else missing.push(imported.dataPath);
      } catch {
        if (!isCurrent()) return;
        missing.push(imported.dataPath);
      }
    }

    if (imported.model) {
      const known = options.models.value.find((item) => item.id === imported.model);

      if (known) {
        const selection = options.catalogueSelection(known);

        if (selection) {
          selectModel(selection, true);
          setFieldValue(
            'config.pretrained',
            imported.config.pretrained ?? values.config.pretrained,
          );
        }
      } else if (options.models.value.length) {
        try {
          const selection = await new CatalogApi(toRaw(options.session())).selectCustomModel(
            imported.model,
          );

          if (!isCurrent()) return;
          selectModel(selection, true);
        } catch {
          if (!isCurrent()) return;
          missing.push(imported.model);
        }
      } else pendingModel.value = imported.model;
    }

    if (!isCurrent()) return;
    active.value = data.value ? 'training' : 'dataset';
    // Fields that choose which code or checkpoint the run executes are never applied quietly.
    announce({
      tone: missing.length || withheld.length ? 'warning' : 'success',
      title: () => t('builder.imported', { file: file.name, count: Object.keys(applied).length }),
      detail: () =>
        [
          withheld.length
            ? t('builder.importCode', { keys: withheld.map(fieldLabel).join(', ') })
            : '',
          missing.length ? t('builder.importMissing', { items: missing.join(', ') }) : '',
          imported.skipped.length
            ? t('builder.importSkipped', { keys: imported.skipped.join(', ') })
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      undo: before
        ? () => {
            if (before.scope !== options.scope.value) return;
            const api = new CatalogApi(toRaw(options.session()));

            try {
              if (before.data) api.assertSelection(before.data);

              if (before.model) api.assertSelection(before.model);
            } catch {
              clearNotice();

              return;
            }

            cancelRestore();
            const restored = draftRequest(before.draft, defaults());
            resetForm({
              values: {
                ...restored,
                config: {
                  ...restored.config,
                  data_path: before.data?.path ?? restored.config.data_path,
                  model: before.model?.model ?? restored.config.model,
                },
                runtime: { ...restored.runtime, environment: before.environment },
              },
            });
            data.value = before.data;
            model.value = before.model;
            datasetInspection.value = before.inspection;
            clearNotice();
          }
        : undefined,
    });
  }

  const codeFields: readonly TrainingFieldName[] = [
    'import_modules',
    'constraint',
    'constraint_file',
    'resume',
  ];

  function pickedFile(event: Event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    const file = event.target.files?.[0];
    event.target.value = '';

    if (file) void importFile(file);
  }

  let dragDepth = 0;

  function hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer?.types.includes('Files');
  }

  function dragEnter(event: DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth++;
    dragging.value = true;
  }

  function dragLeave(event: DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);

    if (!dragDepth) dragging.value = false;
  }

  function drop(event: DragEvent) {
    dragDepth = 0;
    dragging.value = false;
    const file = event.dataTransfer?.files[0];

    if (file && connected.value) void importFile(file);
  }

  function exportNotice(value: string | Error, ok: boolean, detail?: string) {
    announce({
      tone: ok ? 'success' : 'warning',
      detail: detail ? () => t(detail) : undefined,
      title: () =>
        !(value instanceof Error) && value.startsWith('project.') ? t(value) : clientMessage(value),
    });
  }

  function offerSaved() {
    const id = daemonId();
    offered.value = id ? loadProjectDraft(id) : null;
  }

  function retire() {
    cancelRestore();
    clearNotice();
  }

  function edited() {
    submittedDraft = false;
  }

  function submitted() {
    const id = daemonId();

    if (id) binding.bind(id, null);

    if (id) clearProjectDraft(id);
    submittedDraft = true;
  }

  watch(
    options.pageActive,
    (visible) => {
      if (!visible) retire();
    },
    { flush: 'sync' },
  );

  onBeforeUnmount(() => {
    retire();
    clearTimeout(saveTimer);
  });

  return {
    binding,
    bindPlan,
    plannedRunId,
    offered,
    pendingModel,
    dragging,
    savedAt,
    notice,
    announce,
    clearNotice,
    offerSaved,
    retire,
    cancelRestore,
    edited,
    submitted,
    continueDraft,
    startFresh,
    pickedFile,
    dragEnter,
    dragLeave,
    drop,
    exportNotice,
  };
}

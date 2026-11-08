import { clientError } from '../i18n/client-messages';
import { trainingRequestSchema, type TrainingRequest } from '../../shared/schemas/training-request';
import { CatalogApi } from './catalog-api';
import type { ConnectionSession } from './connection-session';
import { RequestApproval } from './request-approval';
import { toRaw } from 'vue';
import type { DataSelection, ModelSelection } from '~~/types/catalog-api';
import type { PlanView, RunView } from '~~/types/daemon-api';

/** Memory-only draft/approval scope; retries never rotate an unchanged request key. */
export class ProjectPlan {
  readonly session: ConnectionSession;
  readonly #approval: RequestApproval;
  constructor(
    session: ConnectionSession,
    readonly keyFactory: () => string = () => crypto.randomUUID(),
  ) {
    this.session = toRaw(session);
    this.#approval = new RequestApproval(this.session, keyFactory);
  }
  get approved(): PlanView | null {
    return this.#approval.approved;
  }
  get key(): string {
    return this.#approval.key;
  }
  invalidate(): void {
    this.#approval.invalidate();
  }
  prepare(draft: TrainingRequest, data: DataSelection, model: ModelSelection): void {
    this.invalidate();
    const catalogue = new CatalogApi(this.session);
    catalogue.assertSelection(data);
    catalogue.assertSelection(model);

    if (
      data.kind !== 'file' ||
      draft.config.data_path !== data.path ||
      draft.config.model !== model.model
    )
      throw clientError('trainingSelectionMismatch', {});
    const request = trainingRequestSchema.parse(draft);

    if (!request.storage_map?.length) delete request.storage_map;
    this.#approval.prepare(request);
  }
  preview(
    signal?: AbortSignal,
    binding?: { runId: string | null; bind: (runId: string | null) => void },
  ): Promise<PlanView> {
    return this.#approval.preview(
      {
        requestRequired: 'validateTheTrainingDraftFirst',
        validationRequired: 'catalogSelectionStale',
        draftChanged: 'planningDraftChanged',
      },
      signal,
      binding,
    );
  }
  submit(signal?: AbortSignal): Promise<RunView> {
    return this.#approval.submit('trainingPreviewRequired', signal);
  }
  status(signal?: AbortSignal): Promise<RunView> {
    return this.#approval.status('submissionPreviewRequired', 'runPlanMismatch', signal);
  }
}

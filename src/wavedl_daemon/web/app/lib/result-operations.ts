import { clientError } from '../i18n/client-messages';
import { resultRequestSchema, type ResultRequest } from '../../shared/schemas/result-request';
import { toRaw } from 'vue';
import { ArtifactClient } from './artifact-client';
import { CatalogApi } from './catalog-api';
import type { ConnectionSession } from './connection-session';
import { RequestApproval } from './request-approval';
import type { Checkpoint } from '~~/types/artifact-client';
import type { DataSelection } from '~~/types/catalog-api';
import type { PlanView, RunView } from '~~/types/daemon-api';

/** Explicit checkpoint source; no filename, last attempt or host-path inference. */
export class ResultOperations {
  readonly #approval: RequestApproval;
  readonly session: ConnectionSession;
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
  invalidate() {
    this.#approval.invalidate();
  }
  prepare(draft: ResultRequest, data: DataSelection, checkpoint: Checkpoint): void {
    this.invalidate();
    new CatalogApi(this.session).assertSelection(data);
    new ArtifactClient(this.session).assertSelection(checkpoint);
    const request = resultRequestSchema.parse(draft);

    if (!request.storage_map?.length) delete request.storage_map;

    if (
      data.kind !== 'file' ||
      request.config.data_path !== data.path ||
      request.checkpoint_source.run_id !== checkpoint.runId ||
      request.checkpoint_source.checkpoint !== checkpoint.name
    )
      throw clientError('inferenceSelectionRequired', {});
    this.#approval.prepare(request);
  }
  preview(signal?: AbortSignal): Promise<PlanView> {
    return this.#approval.preview(
      {
        requestRequired: 'validateTheInferenceDraftFirst',
        validationRequired: 'inferenceValidationRequired',
        draftChanged: 'draftChangedPreviewAgain',
      },
      signal,
    );
  }
  submit(signal?: AbortSignal): Promise<RunView> {
    return this.#approval.submit('inferencePreviewRequired', signal);
  }
  status(signal?: AbortSignal): Promise<RunView> {
    return this.#approval.status('previewFirst', 'inferencePlanMismatch', signal);
  }
}

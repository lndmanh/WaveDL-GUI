import type { useDaemonConnection } from '../app/composables/useDaemonConnection';
import type { ShallowRef, ComputedRef } from 'vue';
import type { DaemonApiError } from '../app/lib/daemon-api';
import type { ConnectionSession } from '../app/lib/connection-session';
import type { AppearancePreferences } from './preferences';
import type { ConnectionStatus } from './connection-session';
import type { RunView } from './daemon-api';

export type WorkstationConnection = ReturnType<typeof useDaemonConnection>;

export interface WorkstationContext {
  connection: WorkstationConnection;
  state: WorkstationConnection['state'];
  api: WorkstationConnection['api'];
  session: ConnectionSession;
  reportFailure: ComputedRef<(error: DaemonApiError) => void>;
  revision: ComputedRef<number>;
  appearance: ShallowRef<AppearancePreferences>;
  appearanceChanged(value: AppearancePreferences): void;
  monitorRun(run: RunView): Promise<void>;
}

export interface WorkstationAuthState {
  status: ConnectionStatus;
  resumePending: boolean;
}

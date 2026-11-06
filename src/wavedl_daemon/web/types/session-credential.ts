import type { SessionCredential } from '../shared/schemas/session-credential';

export type SessionCredentialStorageArea = 'session' | 'local';

export interface StoredSessionCredential {
  credential: SessionCredential;
  storage: SessionCredentialStorageArea;
}

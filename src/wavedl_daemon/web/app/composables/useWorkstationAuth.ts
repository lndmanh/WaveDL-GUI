import type { WorkstationAuthState } from '~~/types/workstation';

/** Middleware runs before the layout mounts. Defer until initial resume settles. */
export function useWorkstationAuth() {
  return useState('workstation-auth', (): WorkstationAuthState => ({
    status: 'disconnected',
    resumePending: true,
  }));
}

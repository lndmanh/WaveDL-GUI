import type { cursorSchema, runEventSchema } from '../shared/schemas/event-stream';
import type { eventPageSchema } from '../app/lib/daemon-api-schemas';
import type { z } from 'zod';
import type { PreferenceStorage } from './preferences';

export type Cursor = z.infer<typeof cursorSchema>;

export type RunEvent = z.infer<typeof runEventSchema>;
export type EventPage = z.infer<typeof eventPageSchema>;

export interface StreamControl {
  type: 'overflow' | 'error';
  resumePosition: Cursor;
}

export type CursorStorage = Pick<PreferenceStorage, 'getItem' | 'setItem'>;

import type { cursorSchema, runEventSchema } from '../shared/schemas/event-stream';
import type { eventPageSchema } from '../shared/schemas/daemon-api';
import type { z } from 'zod';

export type Cursor = z.infer<typeof cursorSchema>;

export type RunEvent = z.infer<typeof runEventSchema>;
export type EventPage = z.infer<typeof eventPageSchema>;

export interface StreamControl {
  type: 'overflow' | 'error';
  resumePosition: Cursor;
}

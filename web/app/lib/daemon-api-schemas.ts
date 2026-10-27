import { z } from 'zod';
import type { JsonObject } from './daemon-api';

// Run only after boundedJson/parseJson validate the JSON domain. All response
// objects historically permit additive fields; DTO schemas strip only at return.
export const jsonObjectSchema = z.custom<JsonObject>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
);
export const RUN_STATES = [
  'planned',
  'pending',
  'submission_unknown',
  'submitted',
  'queued',
  'held',
  'running',
  'stopping',
  'completed',
  'failed',
  'cancelled',
  'terminal_unknown',
  'observation_unavailable',
  'supervision_lost',
] as const;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const integer = z.number().refine(Number.isSafeInteger);
const positive = integer.refine((value) => value > 0);
const printable = z.string().regex(/^[\x21-\x7e]{1,256}$/);
const nullableInteger = integer.nullable();
const signal = positive.nullable();
const outcome = z
  .looseObject({
    status: z.enum(['success', 'failed', 'cancelled', 'unknown']).optional(),
    exit_code: nullableInteger.optional(),
    signal: signal.optional(),
    detail: z.string().optional(),
  })
  .nullable();

const nativeIdentity = (runId: string, requestId: string) =>
  z
    .looseObject({
      run_id: z.literal(runId),
      request_id: z.literal(requestId),
      cluster: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/),
      owner: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/),
      job_id: z
        .string()
        .regex(/^[1-9][0-9]{0,18}$/)
        .pipe(z.string().refine((value) => BigInt(value) <= 9223372036854775807n)),
      restart_count: integer.refine((value) => value >= 0),
    })
    .nullable();

export const evidenceShape = (runId: string, requestId: string) =>
  z.looseObject({
    native_pending: z.boolean().optional(),
    native_identity: nativeIdentity(runId, requestId).optional(),
    current_runtime_attempt: positive.nullable().optional(),
    last_runtime_attempt: positive.nullable().optional(),
    confidence: z.enum(['confirmed', 'unconfirmed']).optional(),
    reason: z.string().optional(),
    runtime: jsonObjectSchema.optional(),
    backend: jsonObjectSchema.nullable().optional(),
    last_observation: jsonObjectSchema.nullable().optional(),
    batch: jsonObjectSchema.nullable().optional(),
    stage_out: jsonObjectSchema.nullable().optional(),
  });
export const runtimeSchema = z.looseObject({
  hello_seen: z.boolean().optional(),
  conflicting_exits: z.boolean().optional(),
  state: z.string().nullable().optional(),
  state_seq: integer.refine((value) => value >= -1).optional(),
  exit_seq: integer.refine((value) => value >= -1).optional(),
  outcome: outcome.optional(),
});
export const outcomeSchema = outcome;
export const observationSchema = (runId: string, requestId: string) =>
  z.looseObject({
    status: z
      .enum(['queued', 'held', 'running', 'terminal', 'absent', 'error', 'supervision_lost'])
      .optional(),
    native_state: z.string().nullable().optional(),
    detail: z.string().optional(),
    attempt: positive.optional(),
    native_identity: nativeIdentity(runId, requestId).optional(),
    exit_code: nullableInteger.optional(),
    signal: signal.optional(),
    batch: outcome.optional(),
    stage_out: outcome.optional(),
  });

export const runViewSchema = z.object({
  plan_id: uuid,
  run_id: uuid,
  request_id: uuid,
  backend: z.string().min(1),
  operation: z.enum(['train', 'test', 'plot']),
  attempt: positive.nullable(),
  state: z.enum(RUN_STATES),
  uncertainty: z.boolean(),
  submission_requested: z.boolean(),
  cancellation_requested: z.boolean(),
  evidence: jsonObjectSchema.nullable(),
});
export const healthSchema = z.object({
  daemon_id: printable,
  build_id: printable,
  protocol_min: integer,
  protocol_max: integer,
});
export const sessionGrantSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_at: positive,
  daemon_id: printable,
});
export const planSchema = z.object({
  plan_id: uuid,
  run_id: uuid,
  request_id: uuid,
  preview: jsonObjectSchema,
});
export const runListSchema = z.object({ runs: z.array(z.unknown()) });

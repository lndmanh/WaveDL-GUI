import { z } from 'zod';

export const catalogTextSchema = (maximum = 8192) => z.string().max(maximum).refine((value) => !value.includes('\0'));

export const catalogIntegerSchema = (maximum: number) => z.number().refine(Number.isSafeInteger).min(0).max(maximum);

export const catalogNumberSchema = (maximum: number) => z.number().finite().min(0).max(maximum);

export const rootIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const modelIdSchema = z.string().regex(/^[a-z0-9_]{1,128}$/);

export const customModelIdSchema = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/);

export const pretrainedSchema = z.boolean();

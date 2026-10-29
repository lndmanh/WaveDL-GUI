<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Minus, Plus } from '@lucide/vue';
import { compactNumber } from '../../lib/training-layout';

/**
 * Locale-independent numeric entry: native number inputs render "0,001" in some
 * locales, which reads as one thousand. Steppers follow how the value is tuned.
 */
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: number | null | undefined;
    integer?: boolean;
    step?: 'linear' | 'double' | 'decade';
    min?: number;
    disabled?: boolean;
    invalid?: boolean;
    testId?: string;
    describedBy?: string;
  }>(),
  { integer: false, step: 'linear', min: undefined, testId: undefined, describedBy: undefined },
);
const emit = defineEmits<{ 'update:modelValue': [value: number]; blur: [event: FocusEvent] }>();
const { t } = useI18n({ useScope: 'global' });
const focused = shallowRef(false);
const text = shallowRef('');

function format(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return props.step === 'decade' ? compactNumber(value) : String(value);
}

function parse(value: string): number {
  const trimmed = value.trim().replace(/^\+/, '');
  if (!trimmed || !/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}
watch(
  () => props.modelValue,
  (value) => {
    // Never rewrite what the user is typing; reformat only external changes.
    if (!focused.value || !Object.is(parse(text.value), value)) text.value = format(value);
  },
  { immediate: true },
);

function input(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  text.value = event.target.value;
  emit('update:modelValue', parse(text.value));
}
function clamp(value: number): number {
  const rounded = props.integer ? Math.round(value) : Number(value.toPrecision(12));
  return props.min === undefined ? rounded : Math.max(props.min, rounded);
}
function stepped(direction: 1 | -1): number {
  const current = typeof props.modelValue === 'number' && Number.isFinite(props.modelValue)
    ? props.modelValue
    : (props.min ?? 0);
  if (props.step === 'double')
    return clamp(direction > 0 ? Math.max(1, current * 2) : current / 2);
  if (props.step === 'decade' && current > 0) {
    const exponent = Math.floor(Math.log10(current) + 1e-9);
    const mantissa = current / 10 ** exponent;
    if (direction > 0) return clamp(mantissa < 2.999 ? 3 * 10 ** exponent : 10 ** (exponent + 1));
    if (mantissa > 3.001) return clamp(3 * 10 ** exponent);
    return clamp(mantissa > 1.001 ? 10 ** exponent : 3 * 10 ** (exponent - 1));
  }
  return clamp(current + direction);
}
function nudge(direction: 1 | -1) {
  if (props.disabled) return;
  const value = stepped(direction);
  text.value = format(value);
  emit('update:modelValue', value);
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  nudge(event.key === 'ArrowUp' ? 1 : -1);
}
function blur(event: FocusEvent) {
  focused.value = false;
  if (Number.isFinite(parse(text.value))) text.value = format(parse(text.value));
  emit('blur', event);
}
</script>
<template>
  <div class="number-field" :data-invalid="invalid || undefined" :data-disabled="disabled || undefined">
    <button
      type="button"
      class="number-field-step"
      tabindex="-1"
      :disabled="disabled"
      :aria-label="t('builder.decrease', { label })"
      @click="nudge(-1)"
    >
      <Minus aria-hidden="true" />
    </button>
    <input
      :id="id"
      class="number-field-input"
      type="text"
      :inputmode="integer ? 'numeric' : 'decimal'"
      autocomplete="off"
      spellcheck="false"
      :value="text"
      :disabled="disabled"
      :aria-invalid="invalid"
      :aria-describedby="describedBy"
      :data-testid="testId"
      @focus="focused = true"
      @input="input"
      @keydown="keydown"
      @blur="blur"
    />
    <button
      type="button"
      class="number-field-step"
      tabindex="-1"
      :disabled="disabled"
      :aria-label="t('builder.increase', { label })"
      @click="nudge(1)"
    >
      <Plus aria-hidden="true" />
    </button>
  </div>
</template>
<style>
.number-field {
  display: inline-flex;
  height: 2.1rem;
  align-items: stretch;
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  transition: box-shadow 150ms ease;
}
.number-field:focus-within {
  box-shadow: 0 0 0 2px var(--primary);
}
.number-field[data-invalid] {
  box-shadow: 0 0 0 1.5px var(--destructive, #bc2836);
}
.number-field-input {
  width: 6.5rem;
  min-width: 0;
  border: 0;
  background: transparent;
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
}
.number-field-step {
  display: grid;
  width: 1.9rem;
  place-items: center;
  border-radius: 0.6rem;
  color: var(--muted-foreground);
  transition:
    color 120ms ease,
    background-color 120ms ease;
}
.number-field-step:hover:not(:disabled) {
  color: var(--foreground);
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
}
.number-field-step:active:not(:disabled) {
  transform: scale(0.92);
}
.number-field-step svg {
  width: 0.8rem;
  height: 0.8rem;
}
.number-field[data-disabled] {
  opacity: 0.55;
}
</style>

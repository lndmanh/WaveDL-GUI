<template>
  <!-- 1. No name → default fallback icon -->
  <component :is="DEFAULT_ICON" v-if="!name" :size="size" :class="cn(props.class)" />

  <!-- 2. Vue component passed directly -->
  <component :is="name" v-else-if="!isStringName" :size="size" :class="cn(props.class)" />

  <!-- 3. Emoji string -->
  <span
    v-else-if="isEmoji"
    :style="{ fontSize: `${size}px`, lineHeight: 1 }"
    :class="cn(props.class)"
    >{{ name }}</span
  >

  <!-- 4. Image URL or path -->
  <NuxtImg
    v-else-if="isImage"
    :src="imageSrc"
    :width="size"
    :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :class="cn(props.class)"
    loading="lazy"
  />

  <!-- 5. File-type icon (useFileIcon) -->
  <component :is="fileIcon" v-else-if="fileIcon" :size="size" :class="cn(props.class)" />

  <!-- 6. Lucide icon string -->
  <component :is="lucideIcon" v-else-if="lucideIcon" :size="size" :class="cn(props.class)" />

  <!-- 7. Unresolved string → fallback -->
  <component :is="DEFAULT_ICON" v-else :size="size" :class="cn(props.class)" />
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import * as lucideIcons from "@lucide/vue";
import { cn } from "~/lib/utils";
import { useFileIcon } from "~/composables/useFileIcon";

// ─── Props ───────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    name?: string | Component;
    size?: number;
    class?: string;
  }>(),
  {
    size: 16,
  },
);

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_ICON = lucideIcons.CircleHelp;

// Non-capturing groups throughout: these are only ever used with .test().
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u;
const IMAGE_RE
  = /^(?:https?:\/\/|\/|\.\/|\.\.\/)|\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp)(?:\?.*)?$/i;

/**
 * Lucide's module namespace, widened so icons can be looked up by name.
 * Values stay `unknown` and are checked by `isComponent` before use.
 */
const iconRegistry: Record<string, unknown> = lucideIcons;

// ─── Computed flags ──────────────────────────────────────────

/**
 * The name when it was supplied as a string, otherwise undefined. Carrying the
 * narrowed value rather than a boolean is what lets every consumer below use it
 * without re-asserting its type.
 */
const stringName = computed(() => (typeof props.name === "string" ? props.name : undefined));

const isStringName = computed(() => stringName.value !== undefined);

const isEmoji = computed(() => {
  const value = stringName.value;
  return value !== undefined && EMOJI_RE.test(value);
});

/** The resolved image source, or an empty string when the name is not an image. */
const imageSrc = computed(() => {
  const value = stringName.value;
  return value !== undefined && IMAGE_RE.test(value) ? value : "";
});

const isImage = computed(() => imageSrc.value !== "");

const fileIcon = computed<Component | undefined>(() => {
  const value = stringName.value;
  if (value === undefined || isEmoji.value || isImage.value) return undefined;
  return useFileIcon(value);
});

const lucideIcon = computed<Component | null>(() => {
  const value = stringName.value;
  if (value === undefined || isEmoji.value || isImage.value || fileIcon.value) return null;
  const icon = iconRegistry[toPascalCase(value)];
  return isComponent(icon) ? icon : null;
});

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Every Lucide export is either a functional component or a component options
 * object, so this is enough to tell an icon apart from any other export.
 */
function isComponent(value: unknown): value is Component {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

/**
 * Converts a kebab-case icon name (with optional lucide prefix) to PascalCase.
 *
 * @example
 * toPascalCase('lucide:arrow-right') // → 'ArrowRight'
 * toPascalCase('lucide-lab:flask')   // → 'Flask'
 * toPascalCase('chevron-down')       // → 'ChevronDown'
 */
function toPascalCase(raw: string): string {
  return raw
    .replace(/^lucide(-lab)?:/, "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}
</script>

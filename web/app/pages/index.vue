<script setup lang="ts">
import { isEmpty } from 'es-toolkit/compat';
import { APP_MANIFEST } from '#shared/constants/manifest';

definePageMeta({
  breadcrumb: 'Home',
});

useSeo({
  title: APP_MANIFEST.short_name,
  description: APP_MANIFEST.description,
  type: 'website',
});

/**
 * The hero this page falls back to. The content module replaces it below with
 * the landing collection; without that module this is the whole homepage.
 */
const hero = ref({ title: APP_MANIFEST.name, subtitle: APP_MANIFEST.description });


const route = useRoute();
if (!isEmpty(route.hash)) {
  const sectionId = route.hash.substring(1);
  setTimeout(() => scrollToSection(sectionId), 300);
}

function scrollToSection(sectionId: string) {
  const element = document.getElementById(sectionId);
  if (element) {
    const headerOffset = 80;
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.scrollY - headerOffset;
    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
  }
}
</script>

<template>
  <div>
    <div class="container py-16">
      <div class="prose max-w-none">
        <h1>{{ hero.title }}</h1>
        <p>{{ hero.subtitle }}</p>
      </div>
    </div>
  </div>
</template>

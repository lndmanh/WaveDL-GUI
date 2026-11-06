<script setup lang="ts">
import { ArrowUpRight, Waves } from '@lucide/vue';
import { CLIENT_BUILD_ID } from '../../lib/build-identity';

const { t } = useI18n({ useScope: 'global' });
</script>

<template>
  <section aria-labelledby="about-heading" class="flex flex-col gap-6">
    <header class="space-y-1.5">
      <h2 id="about-heading" class="text-xl font-semibold tracking-tight">{{ t('shell.aboutWavedl') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('shell.settingsAboutSummary') }}</p>
    </header>
    <Card>
      <CardHeader class="gap-4">
        <div class="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Waves class="size-6" aria-hidden="true" /></div>
        <CardTitle>{{ t('shell.aboutWavedl') }}</CardTitle>
        <CardDescription class="max-w-lg leading-relaxed">{{ t('shell.aboutDescription') }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-5">
        <dl class="space-y-1.5 text-sm">
          <dt class="text-muted-foreground">{{ t('shell.settingsClientBuild') }}</dt>
          <dd class="break-all font-mono text-xs">{{ CLIENT_BUILD_ID }}</dd>
        </dl>
        <Separator />
        <Button as-child variant="outline" class="min-h-11">
          <a href="https://github.com/ductho-le/WaveDL" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">
            {{ t('shell.projectAndFeedback') }}<ArrowUpRight class="size-4" aria-hidden="true" />
          </a>
        </Button>
      </CardContent>
    </Card>
  </section>
</template>

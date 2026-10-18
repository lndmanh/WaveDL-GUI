<template>
  <div class="w-full max-w-3xl mx-auto px-4 py-8 space-y-8">
    <!-- Story title -->
    <div class="space-y-3">
      <div class="reader-skeleton reader-skeleton--primary w-2/3 rounded">
        <Skeleton class="h-8 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton reader-skeleton--secondary w-1/3 rounded">
        <Skeleton class="h-5 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
    </div>

    <!-- Meta row: author, date, tags -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="reader-skeleton reader-skeleton--pill w-20 rounded-full">
        <Skeleton class="h-6 w-full rounded-full bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton reader-skeleton--pill w-24 rounded-full">
        <Skeleton class="h-6 w-full rounded-full bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton reader-skeleton--pill w-16 rounded-full">
        <Skeleton class="h-6 w-full rounded-full bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton reader-skeleton--pill w-20 rounded-full">
        <Skeleton class="h-6 w-full rounded-full bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
    </div>

    <!-- Cover image placeholder -->
    <div class="reader-skeleton reader-skeleton--cover rounded-lg">
      <Skeleton class="h-56 w-full rounded-lg bg-muted/75 animate-none sm:h-72" />
      <span class="reader-skeleton__shine" />
    </div>

    <!-- Section heading -->
    <div class="reader-skeleton w-1/2 rounded">
      <Skeleton class="h-6 w-full rounded bg-muted/75 animate-none" />
      <span class="reader-skeleton__shine" />
    </div>

    <!-- Paragraph 1 -->
    <div class="space-y-2">
      <div class="reader-skeleton w-full rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-full rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-full rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-4/5 rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
    </div>

    <!-- Paragraph 2 -->
    <div class="space-y-2">
      <div class="reader-skeleton w-full rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-full rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-5/6 rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-full rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
      <div class="reader-skeleton w-3/4 rounded">
        <Skeleton class="h-4 w-full rounded bg-muted/75 animate-none" />
        <span class="reader-skeleton__shine" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.reader-skeleton {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.reader-skeleton__shine {
  position: absolute;
  inset: 0;
  display: block;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklch, var(--primary) 0%, transparent) 18%,
    color-mix(in oklch, var(--primary) 4%, transparent) 32%,
    color-mix(in oklch, var(--primary) 14%, transparent) 50%,
    color-mix(in oklch, var(--primary) 4%, transparent) 68%,
    color-mix(in oklch, var(--primary) 0%, transparent) 82%,
    transparent 100%
  );
  box-shadow: 0 0 14px color-mix(in oklch, var(--primary) 5%, transparent);
  transform: translate3d(-140%, 0, 0) skewX(-12deg);
  will-change: transform, opacity;
  animation-name: reader-skeleton-shimmer;
  animation-duration: var(--reader-skeleton-duration, 2.45s);
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  animation-iteration-count: infinite;
}

.reader-skeleton--primary .reader-skeleton__shine {
  --reader-skeleton-duration: 2.35s;
}

.reader-skeleton--secondary .reader-skeleton__shine {
  --reader-skeleton-duration: 2.55s;
}

.reader-skeleton--pill .reader-skeleton__shine {
  --reader-skeleton-duration: 2.7s;
  opacity: 0.7;
}

.reader-skeleton--cover .reader-skeleton__shine {
  --reader-skeleton-duration: 2.85s;
}

@keyframes reader-skeleton-shimmer {
  0% {
    transform: translate3d(-140%, 0, 0) skewX(-12deg);
    opacity: 0;
  }

  18% {
    opacity: 0.72;
  }

  54% {
    opacity: 0.62;
  }

  100% {
    transform: translate3d(140%, 0, 0) skewX(-12deg);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reader-skeleton__shine {
    animation: none;
    opacity: 0;
  }
}
</style>

import type { MaybeRefOrGetter } from 'vue';
import { ArtifactClient, pngPreviewImage } from '../lib/artifact-client';
import { ArtifactImageCache } from '../lib/artifact-images';
import type { ArtifactImageOptions, ArtifactImageState } from '../lib/artifact-images';
import type { Artifact } from '~~/types/artifact-client';

export type { ArtifactImageState } from '../lib/artifact-images';

export interface ArtifactImages {
  state(artifact: Artifact): ArtifactImageState;
  request(artifact: Artifact, options?: ArtifactImageOptions): Promise<ArtifactImageState | null>;
}

/** Separate from artifact downloads: thumbnails never occupy the inventory busy state. */
export function useArtifactImages(runId: MaybeRefOrGetter<string | null>): ArtifactImages {
  const workstation = useWorkstation();
  const session = computed(() => toRaw(workstation.session));
  const { isActive } = usePageActive();
  const connected = shallowRef(false);
  const version = shallowRef(0);
  let disposed = false;

  const cache = new ArtifactImageCache(
    async (artifact, signal) => {
      const blob = await new ArtifactClient(session.value).verifiedBlob(artifact, signal);
      const image = await pngPreviewImage(blob);
      signal.throwIfAborted();

      const url = URL.createObjectURL(image.blob);
      const decoder = new Image();

      const abort = () => {
        decoder.removeAttribute('src');
        URL.revokeObjectURL(url);
      };

      signal.addEventListener('abort', abort, { once: true });

      try {
        decoder.src = url;
        await decoder.decode();
        signal.throwIfAborted();

        return { url, width: image.width, height: image.height };
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
        decoder.removeAttribute('src');
      }
    },
    (url) => URL.revokeObjectURL(url),
    () => version.value++,
  );

  watch(
    session,
    (current, _prior, onCleanup) => {
      cache.reset();
      let revision = current.snapshot().revision;

      const unsubscribe = current.subscribe((state) => {
        connected.value = state.status === 'connected';

        if (!connected.value || revision !== state.revision) cache.reset();
        revision = state.revision;
      });

      onCleanup(unsubscribe);
    },
    { immediate: true, flush: 'sync' },
  );
  watch(
    () => toValue(runId),
    () => cache.reset(),
    { flush: 'sync' },
  );
  watch(
    isActive,
    (active) => {
      if (!active) cache.reset();
    },
    { flush: 'sync' },
  );
  onBeforeUnmount(() => {
    disposed = true;
    cache.reset();
  });

  return {
    state(artifact) {
      // Reading the version makes the otherwise non-reactive cache observable to consumers.
      void version.value;

      return cache.state(artifact);
    },
    request(artifact, options) {
      if (
        disposed ||
        !isActive.value ||
        !connected.value ||
        artifact.runId !== toValue(runId) ||
        !artifact.path.toLowerCase().endsWith('.png')
      )
        return Promise.resolve(null);

      // A matching cache key is not authority: every caller must retain its original inventory record.
      try {
        new ArtifactClient(session.value).assertSelection(artifact);
      } catch {
        return Promise.resolve(null);
      }

      return cache.request(artifact, options);
    },
  };
}

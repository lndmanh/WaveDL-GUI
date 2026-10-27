import { onBeforeUnmount, shallowRef } from 'vue';

/** Native download handoff with no claim that the browser saved the file. */
export function usePreviewExport(filename: string) {
  const exportMessage = shallowRef('');
  const exporting = shallowRef(false);
  let revision = 0;
  function resetExport() {
    revision++;
    exporting.value = false;
    exportMessage.value = '';
  }
  onBeforeUnmount(resetExport);
  function exportPng(canvas: HTMLCanvasElement | null | undefined) {
    if (exporting.value) return;
    if (!canvas) {
      exportMessage.value = 'PNG export is unavailable until the chart is ready.';
      return;
    }
    const current = revision;
    exporting.value = true;
    exportMessage.value = 'Preparing PNG export…';
    try {
      canvas.toBlob((blob) => {
        if (current !== revision) return;
        exporting.value = false;
        if (!blob) {
          exportMessage.value = 'PNG export could not be prepared. Retry the export.';
          return;
        }
        let url: string | undefined;
        try {
          url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.click();
          exportMessage.value =
            'PNG export requested. Your browser controls where it is saved; this is the bounded preview.';
        } catch {
          exportMessage.value =
            'PNG export could not be requested. Check browser download settings and retry.';
        } finally {
          if (url) {
            const requestedUrl = url;
            setTimeout(() => URL.revokeObjectURL(requestedUrl), 1000);
          }
        }
      });
    } catch {
      exporting.value = false;
      exportMessage.value = 'PNG export could not be prepared. Retry the export.';
    }
  }
  return { exportMessage, exporting, exportPng, resetExport };
}

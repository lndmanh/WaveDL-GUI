import { onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef } from 'vue';

/**
 * Tracks whether the enclosing kept-alive page is shown. Outside KeepAlive it
 * stays active. `resume`/`pause` run once per mount or activation transition.
 */
export function usePageActive(resume?: () => void, pause?: () => void) {
  // Start active so content (e.g. popover portals) renders on first paint.
  const isActive = shallowRef(true);
  let running = false;
  function activate() {
    isActive.value = true;
    if (running) return;
    running = true;
    resume?.();
  }
  function deactivate() {
    isActive.value = false;
    if (!running) return;
    running = false;
    pause?.();
  }
  onMounted(activate);
  onActivated(activate);
  onDeactivated(deactivate);
  onBeforeUnmount(deactivate);
  return { isActive };
}

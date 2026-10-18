// Read-only QA identity observation; no app/network/reload interception.
export function installControllerIdentityObserver() {
  if (Object.hasOwn(window, '__wavedlControllerIdentity')) throw new Error('Controller observer already installed');
  const original = navigator.serviceWorker.controller;
  let controllerChanges = 0;
  navigator.serviceWorker.addEventListener('controllerchange', () => { controllerChanges++; });
  Object.defineProperty(window, '__wavedlControllerIdentity', {
    value: () => ({
      originalControllerPresent: original !== null,
      sameControllerObject: navigator.serviceWorker.controller === original,
      controllerChanges,
    }),
  });
}
export const controllerIdentityScript = `(${installControllerIdentityObserver.toString()})()`;

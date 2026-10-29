import { defineNuxtRouteMiddleware, navigateTo } from '#app';
import { authRedirect } from '../lib/auth-routing';
import { useWorkstationAuth } from '../composables/useWorkstationAuth';

export default defineNuxtRouteMiddleware((to) => {
  const auth = useWorkstationAuth();
  const redirect = authRedirect(to.fullPath, auth.value.status, auth.value.resumePending);
  return redirect ? navigateTo(redirect, { replace: true }) : undefined;
});

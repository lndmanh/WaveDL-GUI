export default defineNuxtPlugin(() => {
  const { dataWebsiteId, src } = useRuntimeConfig().public.umami;

  if (!import.meta.dev) {
    const scriptInput = { src, defer: true };
    useScriptUmamiAnalytics({
      scriptInput,
      websiteId: dataWebsiteId,
    });
  }
});

export default defineBackground(() => {
  console.log('[IEEE Extension] Background script loaded', { id: browser.runtime.id });
});

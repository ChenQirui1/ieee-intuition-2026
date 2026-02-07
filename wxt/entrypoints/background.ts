import { browser } from 'wxt/browser';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'CAPTURE_VISIBLE_TAB') {
      return;
    }

    const windowId = sender.tab?.windowId ?? browser.windows.WINDOW_ID_CURRENT;
    browser.tabs.captureVisibleTab(windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => {
        console.warn('[IEEE Extension] captureVisibleTab failed:', error);
        sendResponse({ ok: false });
      });
    return true;
  });
});

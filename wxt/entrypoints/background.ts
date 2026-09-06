import { browser } from 'wxt/browser';

type LanguageCode = 'en' | 'zh' | 'ms' | 'ta';

const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const GOOGLE_LANGUAGE_CODE: Record<LanguageCode, string> = {
  en: 'en',
  zh: 'zh-CN',
  ms: 'ms',
  ta: 'ta',
};

function extractTranslatedText(data: unknown): string | null {
  if (
    data &&
    typeof data === 'object' &&
    'sentences' in data &&
    Array.isArray((data as { sentences?: unknown[] }).sentences)
  ) {
    const joined = (data as { sentences: Array<{ trans?: unknown }> }).sentences
      .map((sentence) => (typeof sentence?.trans === 'string' ? sentence.trans : ''))
      .join('');
    if (joined.trim()) return joined;
  }

  if (Array.isArray(data) && Array.isArray(data[0])) {
    const joined = (data[0] as unknown[])
      .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
      .join('');
    if (joined.trim()) return joined;
  }

  return null;
}

async function translateSingleText(text: string, targetLanguage: LanguageCode): Promise<string> {
  if (!text.trim() || targetLanguage === 'en') return text;

  const params = new URLSearchParams();
  params.set('client', 'gtx');
  params.set('sl', 'auto');
  params.set('tl', GOOGLE_LANGUAGE_CODE[targetLanguage]);
  params.set('dt', 't');
  params.set('dj', '1');
  params.set('q', text);

  const resp = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    throw new Error(`Google translate failed: ${resp.status}`);
  }

  const data = await resp.json();
  const translated = extractTranslatedText(data);
  return translated && translated.trim() ? translated : text;
}

function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  });
  return Promise.all(workers).then(() => results);
}

const MARKER_PREFIX = '__CWX9P_';

function buildMarkedPayload(texts: string[]): string {
  return texts.map((text, index) => `${MARKER_PREFIX}${index}__\n${text}`).join('\n');
}

function parseMarkedPayload(payload: string, expectedCount: number): string[] | null {
  const markerRegex = /__CWX9P_(\d+)__/g;
  const markerMatches = Array.from(payload.matchAll(markerRegex)).map((match) => ({
    marker: match[0],
    index: Number.parseInt(match[1] ?? '', 10),
    start: match.index ?? -1,
  }));

  if (markerMatches.length !== expectedCount) return null;

  const parsed = new Array<string>(expectedCount).fill('');
  for (let i = 0; i < markerMatches.length; i += 1) {
    const current = markerMatches[i];
    if (!current) return null;
    if (!Number.isFinite(current.index) || current.index < 0 || current.index >= expectedCount) {
      return null;
    }

    const nextStart = markerMatches[i + 1]?.start ?? payload.length;
    const segmentStart = current.start + current.marker.length;
    if (segmentStart < 0 || nextStart < segmentStart) return null;

    parsed[current.index] = payload.slice(segmentStart, nextStart).trim();
  }

  return parsed;
}

async function translateTexts(texts: string[], targetLanguage: LanguageCode): Promise<string[]> {
  if (!texts.length) return [];
  if (targetLanguage === 'en') return texts;

  try {
    const payload = buildMarkedPayload(texts);
    const translatedPayload = await translateSingleText(payload, targetLanguage);
    const parsedBatch = parseMarkedPayload(translatedPayload, texts.length);
    if (parsedBatch) {
      return texts.map((original, index) => {
        const candidate = parsedBatch[index];
        return typeof candidate === 'string' && candidate.trim() ? candidate : original;
      });
    }
  } catch {
    // Fall through to per-text fallback.
  }

  const translated = await mapWithConcurrency(texts, 8, async (text) => {
    try {
      const result = await translateSingleText(text, targetLanguage);
      return result.trim() ? result : text;
    } catch {
      return text;
    }
  });

  return translated.map((item, index) =>
    item && item.trim() ? item : (texts[index] ?? ''),
  );
}

export default defineBackground(() => {
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(error => console.warn('[ClearWeb] Could not enable toolbar launcher:', error));
  let captureInFlight = false;
  let lastCaptureAt = 0;
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'CAPTURE_VISIBLE_TAB') {
      const sourceTab = sender.tab;
      const sourceTabId = sourceTab?.id;
      const sourceWindowId = sourceTab?.windowId;
      if (!sourceTab || sourceTabId === undefined || sourceWindowId === undefined || captureInFlight || Date.now() - lastCaptureAt < 550) {
        sendResponse({ ok: false, error: 'Capture unavailable; retry shortly.' });
        return false;
      }
      captureInFlight = true;
      (async () => {
        const [before] = await browser.tabs.query({ active: true, windowId: sourceWindowId });
        if (before?.id !== sourceTabId || before.url !== sourceTab.url) throw new Error('Source tab is no longer active');
        lastCaptureAt = Date.now();
        const dataUrl = await browser.tabs.captureVisibleTab(sourceWindowId, { format: 'png' });
        const [after] = await browser.tabs.query({ active: true, windowId: sourceWindowId });
        if (after?.id !== sourceTabId || after.url !== sourceTab.url) throw new Error('Source tab changed during capture');
        return dataUrl;
      })()
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) => {
          console.warn('[IEEE Extension] captureVisibleTab failed:', error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => { captureInFlight = false; });
      return true;
    }

    if (message?.type === 'TRANSLATE_TEXTS') {
      const targetLanguage: LanguageCode = message.targetLanguage === 'zh'
        ? 'zh'
        : message.targetLanguage === 'ms'
          ? 'ms'
          : message.targetLanguage === 'ta'
            ? 'ta'
            : 'en';
      const texts: string[] = Array.isArray(message.texts)
        ? message.texts.filter((t: unknown) => typeof t === 'string') as string[]
        : [];

      translateTexts(texts, targetLanguage)
        .then((translations) => sendResponse({ ok: true, translations }))
        .catch((error) => {
          console.warn('[IEEE Extension] translate failed:', error);
          sendResponse({ ok: false, translations: texts });
        });
      return true;
    }
  });
});

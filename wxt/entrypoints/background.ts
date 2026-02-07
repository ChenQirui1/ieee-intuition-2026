import { browser } from 'wxt/browser';

type LanguageCode = 'en' | 'zh' | 'ms' | 'ta';

// Keep in sync with sidepanel API base for local development.
const API_BASE_URL = 'http://127.0.0.1:8000';

const LANGUAGE_LABEL: Record<LanguageCode, string> = {
  en: 'English',
  zh: 'Simplified Chinese (简体中文)',
  ms: 'Malay (Bahasa Melayu)',
  ta: 'Tamil (தமிழ்)',
};

function parseJsonArrayLoose(text: string): unknown[] | null {
  const trimmed = (text || '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // fall through
  }

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function translateTexts(texts: string[], targetLanguage: LanguageCode): Promise<string[]> {
  if (!texts.length) return [];

  const system = [
    'You are a translation engine for short UI and webpage snippets.',
    `Translate each item to ${LANGUAGE_LABEL[targetLanguage]}.`,
    'Return ONLY a JSON array of strings with the same length and order as the input.',
    'Do not add any extra text. Do not wrap in markdown.',
    'Keep URLs, emails, numbers, and punctuation unchanged where possible.',
  ].join(' ');

  const body = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(texts) },
    ],
    temperature: 0,
  };

  const resp = await fetch(`${API_BASE_URL}/text-completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`translate failed: ${resp.status}`);
  }

  const data = await resp.json();
  const raw = typeof data?.response === 'string' ? data.response : '';
  const parsed = parseJsonArrayLoose(raw);
  if (!parsed || parsed.length !== texts.length) {
    return texts;
  }

  return parsed.map((item, idx) => (typeof item === 'string' && item.trim() ? item : texts[idx]));
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'CAPTURE_VISIBLE_TAB') {
      const windowId = sender.tab?.windowId ?? browser.windows.WINDOW_ID_CURRENT;
      browser.tabs.captureVisibleTab(windowId, { format: 'png' })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) => {
          console.warn('[IEEE Extension] captureVisibleTab failed:', error);
          sendResponse({ ok: false });
        });
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

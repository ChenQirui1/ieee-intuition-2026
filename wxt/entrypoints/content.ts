import tocbot from 'tocbot';
import { browser } from 'wxt/browser';
import { storage } from '@wxt-dev/storage';

type LanguageCode = 'en' | 'zh' | 'ms' | 'ta';
type PageLanguageMode = 'preferred' | 'original';

interface UserPreferences {
  language: LanguageCode;
  fontSize: 'standard' | 'large' | 'extra-large';
  linkStyle: 'default' | 'underline' | 'highlight' | 'border';
  contrastMode: 'standard' | 'high-contrast-yellow';
  magnifyingZoomLevel: 1.5 | 2 | 2.5 | 3;
  hideAds: boolean;
  simplifyLanguage: boolean;
  showBreadcrumbs: boolean;
  ttsRate: number;
  autoReadAssistant: boolean;
  profileName: string;
}

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  language: 'en',
  fontSize: 'standard',
  linkStyle: 'default',
  contrastMode: 'standard',
  magnifyingZoomLevel: 2.5,
  hideAds: false,
  simplifyLanguage: false,
  showBreadcrumbs: false,
  ttsRate: 1,
  autoReadAssistant: false,
  profileName: 'My Profile',
};

const SKIP_TRANSLATE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'CODE',
  'PRE',
  'SVG',
  'CANVAS',
  'IFRAME',
]);

const TRANSLATE_MAX_TEXT_NODES = 5000;
const TRANSLATE_CHUNK_SIZE = 40;

const originalTextByNode = new WeakMap<Text, string>();
const touchedTextNodes = new Set<Text>();
const translationCache: Record<LanguageCode, Map<string, string>> = {
  en: new Map(),
  zh: new Map(),
  ms: new Map(),
  ta: new Map(),
};

let activeTranslateJobId = 0;
let preferredPageLanguage: LanguageCode = DEFAULT_USER_PREFERENCES.language;
let currentPageLanguageMode: PageLanguageMode = 'preferred';
let preferredLanguageRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let translationInProgress = false;
let translationInProgressJobId = 0;

function startTranslationJob(): number {
  activeTranslateJobId += 1;
  return activeTranslateJobId;
}

function splitWhitespace(value: string): { leading: string; core: string; trailing: string } {
  const match = value.match(/^(\s*)(.*?)(\s*)$/s);
  return {
    leading: match?.[1] ?? '',
    core: match?.[2] ?? value,
    trailing: match?.[3] ?? '',
  };
}

function shouldTranslateText(text: string): boolean {
  const { core } = splitWhitespace(text);
  const trimmed = core.trim();
  if (!trimmed) return false;
  if (trimmed.length < 2) return false;
  if (/^[\d\s.,:;!?"'()\-_/\\]+$/.test(trimmed)) return false;
  return true;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function collectTranslatableTextNodes(): Text[] {
  const root = document.body || document.documentElement;
  if (!root) return [];

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node: Node) {
        if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        if (parent.closest('[data-ieee-extension]')) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (SKIP_TRANSLATE_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

        const text = node.nodeValue ?? '';
        if (!shouldTranslateText(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    } as unknown as NodeFilter,
  );

  const nodes: Text[] = [];
  while (nodes.length < TRANSLATE_MAX_TEXT_NODES && walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

async function requestTranslations(texts: string[], targetLanguage: LanguageCode): Promise<string[]> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'TRANSLATE_TEXTS',
      targetLanguage,
      texts,
    });

    if (response?.ok && Array.isArray(response.translations)) {
      return response.translations.map((t: unknown, idx: number) => {
        if (typeof t === 'string' && t.trim()) return t;
        return texts[idx] ?? '';
      });
    }
  } catch (error) {
    console.warn('[IEEE Extension] Translation request failed:', error);
  }

  return texts;
}

function restoreOriginalLanguage() {
  for (const node of Array.from(touchedTextNodes)) {
    const original = originalTextByNode.get(node);
    if (typeof original === 'string') {
      node.nodeValue = original;
    }
  }
  touchedTextNodes.clear();
}

async function applyPreferredLanguage(targetLanguage: LanguageCode, jobId: number) {
  const nodes = collectTranslatableTextNodes();
  if (nodes.length === 0) return;

  const textToNodes = new Map<string, Text[]>();
  for (const node of nodes) {
    const currentValue = node.nodeValue ?? '';
    const originalValue = originalTextByNode.get(node) ?? currentValue;
    if (!originalTextByNode.has(node)) {
      originalTextByNode.set(node, currentValue);
    }

    const { core } = splitWhitespace(originalValue);
    const key = core.trim();
    if (!key) continue;

    const arr = textToNodes.get(key) ?? [];
    arr.push(node);
    textToNodes.set(key, arr);
  }

  const cache = translationCache[targetLanguage] ?? translationCache.en;
  const uniqueKeys = Array.from(textToNodes.keys());
  const needsTranslation = uniqueKeys.filter((k) => !cache.has(k));

  const applyKey = (key: string, translated: string) => {
    const nodeList = textToNodes.get(key);
    if (!nodeList || !nodeList.length) return;
    for (const node of nodeList) {
      const original = originalTextByNode.get(node) ?? (node.nodeValue ?? '');
      const { leading, trailing } = splitWhitespace(original);
      node.nodeValue = `${leading}${translated}${trailing}`;
      touchedTextNodes.add(node);
    }
  };

  // Apply any cached translations immediately so the page updates without waiting for network.
  for (const key of uniqueKeys) {
    const cached = cache.get(key);
    if (typeof cached === 'string' && cached.trim()) {
      applyKey(key, cached);
    }
  }

  for (const batch of chunk(needsTranslation, TRANSLATE_CHUNK_SIZE)) {
    if (jobId !== activeTranslateJobId) return;
    const translated = await requestTranslations(batch, targetLanguage);
    if (jobId !== activeTranslateJobId) return;

    for (let i = 0; i < batch.length; i += 1) {
      const key = batch[i];
      const value = translated[i] ?? key;
      cache.set(key, value);
      applyKey(key, value);
    }
  }
}

async function applyPageLanguageMode(mode: PageLanguageMode, targetLanguage: LanguageCode) {
  const jobId = startTranslationJob();

  if (mode === 'original' || targetLanguage === 'en') {
    restoreOriginalLanguage();
    return;
  }

  translationInProgress = true;
  translationInProgressJobId = jobId;
  try {
    await applyPreferredLanguage(targetLanguage, jobId);
  } finally {
    if (translationInProgressJobId === jobId) {
      translationInProgress = false;
    }
  }
}

function schedulePreferredLanguageRefresh(delayMs: number = 1200) {
  if (preferredLanguageRefreshTimer) {
    clearTimeout(preferredLanguageRefreshTimer);
    preferredLanguageRefreshTimer = null;
  }
  if (currentPageLanguageMode !== 'preferred') return;
  preferredLanguageRefreshTimer = setTimeout(() => {
    if (currentPageLanguageMode !== 'preferred') return;
    if (translationInProgress) {
      schedulePreferredLanguageRefresh(1200);
      return;
    }
    void applyPageLanguageMode('preferred', preferredPageLanguage);
  }, delayMs);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('[IEEE Extension] Content script loaded');
    initInterpreter();
    initAccessibilityFeatures();
  },
});

/**
 * Initialize the Interpreter
 */
function initInterpreter() {
  try {
    // Initialize click handler for sidepanel
    initClickHandler();
    console.log('[IEEE Extension] Click handler initialized');

    // Initialize magnifying glass feature
    initMagnifyingGlass();
    console.log('[IEEE Extension] Magnifying glass initialized');

    // Listen for messages from sidepanel
    initMessageListener();
    console.log('[IEEE Extension] Message listener initialized');

    // Notify sidepanel that page is loaded
    notifyPageLoaded();

    window.addEventListener('load', () => {
      schedulePreferredLanguageRefresh(1200);
    });
  } catch (error) {
    console.error('[IEEE Extension] Failed to initialize:', error);
  }
}

/**
 * Initialize click handler to send element data to sidepanel
 */
function initClickHandler() {
  let selectionMode = false;
  let selectedElement: HTMLElement | null = null;
  let hoveredElement: HTMLElement | null = null;

  // Listen for selection mode toggle from sidepanel
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_SELECTION_MODE') {
      selectionMode = message.enabled;

      // Clear selection when turning off
      if (!selectionMode) {
        if (selectedElement) {
          selectedElement = null;
        }
        if (hoveredElement) {
          removeHoverHighlight(hoveredElement);
          hoveredElement = null;
        }
      }

      console.log('[IEEE Extension] Selection mode', selectionMode ? 'enabled' : 'disabled');
    }
  });

  // Add hover effect when selection mode is on
  document.addEventListener('mouseover', (event) => {
    if (!selectionMode) return;

    const target = event.target as HTMLElement;

    // Skip if hovering extension's own elements
    if (target.closest('[data-ieee-extension]')) {
      return;
    }

    // Skip text nodes and document
    if (target.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    // Remove previous hover highlight
    if (hoveredElement && hoveredElement !== target) {
      removeHoverHighlight(hoveredElement);
    }

    // Add hover highlight
    hoveredElement = target;
    addHoverHighlight(target);
  });

  document.addEventListener('mouseout', (event) => {
    if (!selectionMode) return;

    const target = event.target as HTMLElement;
    if (hoveredElement === target) {
      removeHoverHighlight(target);
      hoveredElement = null;
    }
  });

  document.addEventListener('click', (event) => {
    // Only handle clicks when selection mode is ON
    if (!selectionMode) {
      return; // Allow normal clicking when selection mode is OFF
    }

    const target = event.target as HTMLElement;

    // Skip if clicking on the extension's own elements
    if (target.closest('[data-ieee-extension]')) {
      return;
    }

    // Skip text nodes and document
    if (target.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    // Prevent default behavior when selection mode is ON
    event.preventDefault();
    event.stopPropagation();

    // Remove previous selection
    if (selectedElement) {
      selectedElement = null;
    }

    selectedElement = target;

    const tag = target.tagName.toLowerCase();

    let elementData: any = {
      tag,
      id: target.id || undefined,
      classes: Array.from(target.classList),
    };

    // Images often have no textContent; send src/alt so the sidepanel can caption them.
    if (target instanceof HTMLImageElement) {
      const img = target as HTMLImageElement;
      const rawSrc = img.currentSrc || img.src || '';

      let src: string | undefined;
      try {
        src = rawSrc ? new URL(rawSrc, document.baseURI).toString() : undefined;
      } catch {
        src = rawSrc || undefined;
      }

      const figcaption = img
        .closest('figure')
        ?.querySelector('figcaption')
        ?.textContent?.trim() || '';

      elementData = {
        ...elementData,
        tag: 'img',
        text: (img.alt || figcaption || '').trim(),
        src,
        alt: img.alt || undefined,
        title: img.title || undefined,
        figcaption: figcaption || undefined,
      };
    } else {
      const text = target.textContent?.trim() || '';
      elementData = {
        ...elementData,
        text,
      };
    }

    // Send to sidepanel to open chat
    browser.runtime.sendMessage({
      type: 'ELEMENT_CLICKED',
      data: elementData,
      openChat: true, // Flag to switch to chat tab
    }).catch(() => {
      // Sidepanel might not be open, that's okay
    });

    console.log('[IEEE Extension] Element selected:', elementData);
  }, true);

  function addHoverHighlight(element: HTMLElement) {
    element.style.outline = '3px solid #FEF08A';
    element.style.backgroundColor = 'rgba(254, 240, 138, 0.2)';
    element.style.cursor = 'pointer';
  }

  function removeHoverHighlight(element: HTMLElement) {
    element.style.outline = '';
    element.style.backgroundColor = '';
    element.style.cursor = '';
  }
}

/**
 * Initialize magnifying glass feature (viewport snapshot -> crop -> scale).
 */
function initMagnifyingGlass() {
  let magnifyingMode = false;
  let zoomLevel = 2.5;
  const lensSize = 150;
  const captureFps = 24;
  const captureIntervalMs = 1000 / captureFps;
  let captureInFlight = false;
  let lastCaptureAt = 0;
  let renderFrame: number | null = null;
  let lastX = 0;
  let lastY = 0;

  let snapshotImage: HTMLImageElement | null = null;
  let snapshotReady = false;
  let snapshotWidth = 0;
  let snapshotHeight = 0;

  const magnifyingLens = document.createElement('div');
  magnifyingLens.id = 'ieee-magnifying-lens';
  magnifyingLens.setAttribute('data-ieee-extension', 'true');
  magnifyingLens.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: ${lensSize}px;
    height: ${lensSize}px;
    border: 3px solid #3B82F6;
    border-radius: 50%;
    background-color: white;
    box-shadow: 0 0 10px rgba(59, 130, 246, 0.5), inset 0 0 10px rgba(59, 130, 246, 0.2);
    overflow: hidden;
    pointer-events: none;
    display: none;
    z-index: 999999;
    will-change: transform;
  `;

  const magnifierCanvas = document.createElement('canvas');
  magnifierCanvas.setAttribute('data-ieee-extension', 'true');
  magnifierCanvas.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  `;
  const magnifierCtx = magnifierCanvas.getContext('2d');
  magnifyingLens.appendChild(magnifierCanvas);

  const attachLens = () => {
    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) {
      return false;
    }
    mountTarget.appendChild(magnifyingLens);
    return true;
  };
  if (!attachLens()) {
    document.addEventListener('DOMContentLoaded', () => {
      attachLens();
    }, { once: true });
  }

  const applyCursor = (enabled: boolean) => {
    if (!document.body) return;
    document.body.style.cursor = enabled
      ? 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2732%22 height=%2732%22 viewBox=%220 0 32 32%22%3E%3Ccircle cx=%2716%22 cy=%2716%22 r=%2714%22 fill=%22none%22 stroke=%22%233B82F6%22 stroke-width=%222%22/%3E%3Cline x1=%2722%22 y1=%2722%22 x2=%2728%22 y2=%2728%22 stroke=%22%233B82F6%22 stroke-width=%222%22/%3E%3C/svg%3E") 16 16, auto'
      : 'auto';
  };

  const loadMagnifyingPreference = async () => {
    try {
      const preferences = await storage.getItem<UserPreferences>('sync:userPreferences');
      if (preferences?.magnifyingZoomLevel) {
        zoomLevel = preferences.magnifyingZoomLevel;
      }

      storage.watch<UserPreferences>('sync:userPreferences', (newPreferences) => {
        if (newPreferences?.magnifyingZoomLevel) {
          zoomLevel = newPreferences.magnifyingZoomLevel;
        }
      });
    } catch (error) {
      console.error('[IEEE Extension] Failed to load magnifying preferences:', error);
    }
  };

  loadMagnifyingPreference();

  const notifyMagnifyingMode = (enabled: boolean) => {
    browser.runtime.sendMessage({
      type: 'MAGNIFYING_MODE_CHANGED',
      enabled,
    }).catch(() => {
      // Sidepanel might not be open
    });
  };

  const requestSnapshotCapture = async (force = false) => {
    if (!magnifyingMode || captureInFlight) return;
    const now = performance.now();
    if (!force && now - lastCaptureAt < captureIntervalMs) {
      return;
    }
    lastCaptureAt = now;
    captureInFlight = true;

    // Prevent feedback loops: if the lens is visible during captureVisibleTab,
    // it will be captured into the snapshot and then re-magnified, creating the
    // appearance that zoom keeps increasing. Hide the lens just for the capture.
    const prevVisibility = magnifyingLens.style.visibility;
    const shouldHideLens = magnifyingLens.style.display !== 'none';
    if (shouldHideLens) {
      magnifyingLens.style.visibility = 'hidden';
    }
    try {
      const response = await browser.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
      if (response?.ok && response.dataUrl) {
        const img = new Image();
        img.onload = () => {
          snapshotImage = img;
          snapshotWidth = img.naturalWidth || img.width;
          snapshotHeight = img.naturalHeight || img.height;
          snapshotReady = true;
          scheduleRender();
        };
        img.src = response.dataUrl;
      }
    } catch (error) {
      console.warn('[IEEE Extension] Snapshot capture failed:', error);
    } finally {
      if (shouldHideLens) {
        magnifyingLens.style.visibility = prevVisibility;
      }
      captureInFlight = false;
    }
  };

  const scheduleRender = () => {
    if (!magnifyingMode) return;
    if (renderFrame) {
      cancelAnimationFrame(renderFrame);
    }
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      renderMagnifier();
    });
  };

  const renderMagnifier = () => {
    if (!magnifyingMode || !magnifierCtx) return;
    magnifyingLens.style.display = 'block';
    magnifyingLens.style.transform = `translate(${lastX + 15}px, ${lastY + 15}px)`;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(lensSize * dpr);
    const targetHeight = Math.round(lensSize * dpr);
    if (magnifierCanvas.width !== targetWidth || magnifierCanvas.height !== targetHeight) {
      magnifierCanvas.width = targetWidth;
      magnifierCanvas.height = targetHeight;
    }

    magnifierCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    magnifierCtx.imageSmoothingEnabled = true;
    magnifierCtx.clearRect(0, 0, lensSize, lensSize);

    if (!snapshotReady || !snapshotImage) {
      magnifierCtx.fillStyle = '#FFFFFF';
      magnifierCtx.fillRect(0, 0, lensSize, lensSize);
      magnifierCtx.fillStyle = '#64748B';
      magnifierCtx.font = '12px system-ui, sans-serif';
      magnifierCtx.textAlign = 'center';
      magnifierCtx.fillText('Loading...', lensSize / 2, lensSize / 2);
      return;
    }

    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const ratioX = snapshotWidth / viewportWidth;
    const ratioY = snapshotHeight / viewportHeight;

    const sourceW = (lensSize / zoomLevel) * ratioX;
    const sourceH = (lensSize / zoomLevel) * ratioY;
    let sourceX = lastX * ratioX - sourceW / 2;
    let sourceY = lastY * ratioY - sourceH / 2;

    sourceX = Math.max(0, Math.min(snapshotWidth - sourceW, sourceX));
    sourceY = Math.max(0, Math.min(snapshotHeight - sourceH, sourceY));

    magnifierCtx.drawImage(
      snapshotImage,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      0,
      0,
      lensSize,
      lensSize
    );
  };

  document.addEventListener('mousemove', (event) => {
    lastX = event.clientX;
    lastY = event.clientY;
    if (magnifyingMode) {
      scheduleRender();
      // Keep the magnification stable by avoiding continuous viewport captures.
      // Snapshot refreshes happen on enable + scroll/resize.
      if (!snapshotReady) {
        requestSnapshotCapture();
      }
    }
  });

  document.addEventListener('mouseleave', () => {
    if (!magnifyingMode) return;
    magnifyingLens.style.display = 'none';
  });

  document.addEventListener('mouseenter', () => {
    if (!magnifyingMode) return;
    magnifyingLens.style.display = 'block';
    scheduleRender();
  });

  window.addEventListener('scroll', () => {
    if (!magnifyingMode) return;
    requestSnapshotCapture(true);
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (!magnifyingMode) return;
    requestSnapshotCapture(true);
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message.type !== 'TOGGLE_MAGNIFYING_MODE') {
      return;
    }

    magnifyingMode = message.enabled;
    if (magnifyingMode) {
      if (!lastX && !lastY) {
        lastX = Math.round(window.innerWidth / 2);
        lastY = Math.round(window.innerHeight / 2);
      }
      snapshotReady = false;
      magnifyingLens.style.display = 'block';
      applyCursor(true);
      requestSnapshotCapture(true);
      scheduleRender();
    } else {
      magnifyingLens.style.display = 'none';
      applyCursor(false);
    }

    notifyMagnifyingMode(magnifyingMode);
  });
}

/**
 * Initialize message listener for sidepanel commands
 */
function initMessageListener() {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'GET_PAGE_CONTENT') {
      handleGetPageContent();
    } else if (message.type === 'SCROLL_TO_HEADING') {
      handleScrollToHeading(message.index);
    } else if (message.type === 'APPLY_USER_PREFERENCES') {
      if (message.preferences) {
        applyAccessibilityStyles(message.preferences);
      } else {
        removeAccessibilityStyles();
      }
    } else if (message.type === 'SET_PAGE_LANGUAGE_MODE') {
      const mode: PageLanguageMode = message.mode === 'original' ? 'original' : 'preferred';
      const lang: LanguageCode = message.language === 'zh'
        ? 'zh'
        : message.language === 'ms'
          ? 'ms'
          : message.language === 'ta'
            ? 'ta'
            : 'en';
      currentPageLanguageMode = mode;
      preferredPageLanguage = lang;
      applyPageLanguageMode(currentPageLanguageMode, preferredPageLanguage);
      schedulePreferredLanguageRefresh(450);
    }
  });
}

/**
 * Handle GET_PAGE_CONTENT message - extract page content for summary
 */
function handleGetPageContent() {
  // Extract main content from the page
  const title = document.title;

  // Use tocbot to find headings intelligently
  // Create a temporary container for tocbot
  const tempTocContainer = document.createElement('div');
  tempTocContainer.id = 'ieee-temp-toc';
  tempTocContainer.style.display = 'none';
  document.body.appendChild(tempTocContainer);

  // Initialize tocbot to analyze the page
  tocbot.init({
    tocSelector: '#ieee-temp-toc',
    contentSelector: 'body',
    headingSelector: 'h1, h2, h3, h4, h5, h6',
    hasInnerContainers: true,
    collapseDepth: 6,
  });

  // Extract headings from the generated TOC
  const tocLinks = tempTocContainer.querySelectorAll('a');
  const headings = Array.from(tocLinks).map((link, index) => {
    const href = link.getAttribute('href');
    if (!href) return null;

    // Find the actual heading element
    const headingId = href.substring(1); // Remove the '#'
    const headingElement = document.getElementById(headingId);

    if (!headingElement) return null;

    const text = headingElement.textContent?.trim();
    if (!text) return null;

    // Get the heading level
    const tagName = headingElement.tagName;
    const level = tagName.match(/^H[1-6]$/) ? parseInt(tagName.substring(1)) : 2;

    // Store index as data attribute for later scrolling
    headingElement.setAttribute('data-ieee-heading-index', index.toString());

    return {
      text,
      level,
      index,
      id: headingId,
    };
  }).filter(Boolean);

  // Clean up
  tocbot.destroy();
  tempTocContainer.remove();

  const paragraphs = Array.from(document.querySelectorAll('p'))
    .map((p) => p.textContent?.trim())
    .filter((text) => text && text.length > 50)
    .slice(0, 18);

  const interactions = extractInteractiveSummary();

  const pageData = {
    title,
    headings,
    paragraphs,
    interactions,
    url: window.location.href,
  };

  // Send back to sidepanel
  browser.runtime.sendMessage({
    type: 'PAGE_LOADED',
    data: pageData,
  }).catch(() => {
    // Sidepanel might not be open yet
  });

  console.log('[IEEE Extension] Page content extracted:', pageData);
  console.log('[IEEE Extension] Found headings:', headings.length);
}

function extractInteractiveSummary(): string[] {
  const unique = new Set<string>();

  const isVisible = (el: Element): boolean => {
    const element = el as HTMLElement;
    if (!element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    return true;
  };

  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

  const ariaLabelledByText = (el: HTMLElement): string => {
    const ids = (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = document.getElementById(id);
      const txt = clean(ref?.textContent || '');
      if (txt) parts.push(txt);
    }
    return parts.join(' ');
  };

  const labelForInput = (input: HTMLElement): string => {
    const id = input.getAttribute('id');
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const txt = clean(label?.textContent || '');
      if (txt) return txt;
    }

    const wrappedLabel = input.closest('label');
    const wrappedTxt = clean(wrappedLabel?.textContent || '');
    if (wrappedTxt) return wrappedTxt;

    return '';
  };

  const accessibleName = (el: HTMLElement): string => {
    const aria = clean(el.getAttribute('aria-label') || '');
    if (aria) return aria;
    const labelledBy = ariaLabelledByText(el);
    if (labelledBy) return labelledBy;

    const title = clean(el.getAttribute('title') || '');
    if (title) return title;

    const text = clean(el.textContent || '');
    if (text) return text;

    const placeholder = clean(el.getAttribute('placeholder') || '');
    if (placeholder) return placeholder;

    const name = clean(el.getAttribute('name') || '');
    if (name) return name;

    const id = clean(el.getAttribute('id') || '');
    if (id) return id;

    return '';
  };

  const describe = (el: HTMLElement): string | null => {
    if (el.closest('[data-ieee-extension]')) return null;
    if (!isVisible(el)) return null;

    const tag = el.tagName.toLowerCase();

    if (tag === 'a') {
      const href = (el as HTMLAnchorElement).href || '';
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return null;
      }
      const name = accessibleName(el).slice(0, 80);
      if (!name) return null;
      return `LINK: "${name}" href="${href}"`;
    }

    if (tag === 'button') {
      const name = accessibleName(el).slice(0, 80);
      if (!name) return null;
      return `BUTTON: "${name}"`;
    }

    if (tag === 'input') {
      const input = el as HTMLInputElement;
      const type = (input.type || 'text').toLowerCase();
      if (type === 'hidden') return null;

      // Treat submit/button as buttons
      if (type === 'submit' || type === 'button' || type === 'reset') {
        const name = accessibleName(el).slice(0, 80);
        if (!name) return null;
        return `BUTTON: "${name}"`;
      }

      const label = clean(labelForInput(el));
      const placeholder = clean(input.placeholder || '');
      const name = label || placeholder || accessibleName(el);
      if (!name) return null;

      const extra: string[] = [];
      if (label) extra.push(`label="${label.slice(0, 80)}"`);
      if (placeholder) extra.push(`placeholder="${placeholder.slice(0, 80)}"`);

      const kind = type === 'checkbox' ? 'CHECKBOX' : type === 'radio' ? 'RADIO' : `INPUT(${type})`;
      return `${kind}: "${name.slice(0, 80)}"${extra.length ? ' ' + extra.join(' ') : ''}`;
    }

    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const label = clean(labelForInput(el));
      const name = label || accessibleName(el);
      const options = Array.from(select.options)
        .map((o) => clean(o.textContent || ''))
        .filter(Boolean)
        .slice(0, 6);

      if (!name) return null;
      const extra = options.length ? ` options=${JSON.stringify(options)}` : '';
      return `SELECT: "${name.slice(0, 80)}"${extra}`;
    }

    if (tag === 'textarea') {
      const label = clean(labelForInput(el));
      const placeholder = clean(el.getAttribute('placeholder') || '');
      const name = label || placeholder || accessibleName(el);
      if (!name) return null;
      const extra: string[] = [];
      if (label) extra.push(`label="${label.slice(0, 80)}"`);
      if (placeholder) extra.push(`placeholder="${placeholder.slice(0, 80)}"`);
      return `TEXTAREA: "${name.slice(0, 80)}"${extra.length ? ' ' + extra.join(' ') : ''}`;
    }

    // Fallback for ARIA-based buttons/links (rarely needed)
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'button' || role === 'link') {
      const name = accessibleName(el).slice(0, 80);
      if (!name) return null;
      return `${role.toUpperCase()}: "${name}"`;
    }

    return null;
  };

  const candidates = Array.from(
    document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"]')
  ) as HTMLElement[];

  const described = candidates
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, left: rect.left, desc: describe(el) };
    })
    .filter((x) => Boolean(x.desc))
    .sort((a, b) => (a.top - b.top) || (a.left - b.left));

  const out: string[] = [];
  for (const item of described) {
    const desc = item.desc as string;
    if (unique.has(desc)) continue;
    unique.add(desc);
    out.push(desc);
    if (out.length >= 80) break;
  }

  return out;
}

/**
 * Handle SCROLL_TO_HEADING message - scroll to a specific heading
 */
function handleScrollToHeading(index: number) {
  const heading = document.querySelector(`[data-ieee-heading-index="${index}"]`);

  if (heading) {
    // Scroll to the heading with smooth behavior
    heading.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });

    console.log('[IEEE Extension] Scrolled to heading:', heading.textContent);
  } else {
    console.warn('[IEEE Extension] Heading not found at index:', index);
  }
}

/**
 * Notify sidepanel that page has loaded
 */
function notifyPageLoaded() {
  // Wait a bit for page to fully load
  setTimeout(() => {
    handleGetPageContent();
    schedulePreferredLanguageRefresh(900);
  }, 1000);
}

/**
 * Initialize accessibility features based on user preferences
 */
async function initAccessibilityFeatures() {
  try {
    // Load user preferences from storage
    const preferences = await storage.getItem<UserPreferences>('sync:userPreferences');

    if (preferences) {
      console.log('[IEEE Extension] Applying accessibility preferences:', preferences);
      applyAccessibilityStyles(preferences);
      preferredPageLanguage = preferences.language ?? DEFAULT_USER_PREFERENCES.language;
      if (currentPageLanguageMode === 'preferred') {
        await applyPageLanguageMode(currentPageLanguageMode, preferredPageLanguage);
        schedulePreferredLanguageRefresh(1500);
      }
    } else {
      console.log('[IEEE Extension] No preferences found, using defaults');
      removeAccessibilityStyles();
      preferredPageLanguage = DEFAULT_USER_PREFERENCES.language;
      if (currentPageLanguageMode === 'preferred') {
        await applyPageLanguageMode(currentPageLanguageMode, preferredPageLanguage);
        schedulePreferredLanguageRefresh(1500);
      }
    }

    // Watch for preference changes (even if preferences aren't set yet).
    storage.watch<UserPreferences>('sync:userPreferences', (newPreferences) => {
      if (newPreferences) {
        console.log('[IEEE Extension] Preferences updated:', newPreferences);
        applyAccessibilityStyles(newPreferences);
        preferredPageLanguage = newPreferences.language ?? DEFAULT_USER_PREFERENCES.language;
        if (currentPageLanguageMode === 'preferred') {
          void applyPageLanguageMode(currentPageLanguageMode, preferredPageLanguage);
          schedulePreferredLanguageRefresh(800);
        }
      } else {
        removeAccessibilityStyles();
        preferredPageLanguage = DEFAULT_USER_PREFERENCES.language;
        if (currentPageLanguageMode === 'preferred') {
          void applyPageLanguageMode(currentPageLanguageMode, preferredPageLanguage);
          schedulePreferredLanguageRefresh(800);
        }
      }
    });
  } catch (error) {
    console.error('[IEEE Extension] Failed to load preferences:', error);
  }
}

function removeAccessibilityStyles() {
  const existingStyle = document.getElementById('ieee-accessibility-styles');
  if (existingStyle) {
    existingStyle.remove();
  }
}

/**
 * Apply accessibility styles based on user preferences
 */
function applyAccessibilityStyles(preferences: UserPreferences) {
  const effectivePreferences: UserPreferences = { ...DEFAULT_USER_PREFERENCES, ...preferences };
  // Remove existing style element if it exists
  const existingStyle = document.getElementById('ieee-accessibility-styles');
  if (existingStyle) {
    existingStyle.remove();
  }

  // Create new style element
  const styleElement = document.createElement('style');
  styleElement.id = 'ieee-accessibility-styles';

  let css = '';

  // Zoom rate adjustments
  if (effectivePreferences.fontSize === 'large') {
    css += `
      body {
        zoom: 1.25 !important;
      }
      /* Counter-zoom for magnifying glass to keep it unaffected */
      #ieee-magnifying-lens {
        zoom: ${1 / 1.25} !important;
      }
    `;
  } else if (effectivePreferences.fontSize === 'extra-large') {
    css += `
      body {
        zoom: 1.5 !important;
      }
      /* Counter-zoom for magnifying glass to keep it unaffected */
      #ieee-magnifying-lens {
        zoom: ${1 / 1.5} !important;
      }
    `;
  } else {
    // Reset magnifying glass zoom when at standard size
    css += `
      #ieee-magnifying-lens {
        zoom: 1 !important;
      }
    `;
  }

  // Link styling
  if (effectivePreferences.linkStyle === 'underline') {
    css += `
      a, a:link, a:visited {
        text-decoration: underline !important;
      }
    `;
  } else if (effectivePreferences.linkStyle === 'highlight') {
    css += `
      a, a:link, a:visited {
        background-color: #FEF08A !important;
        background-image: linear-gradient(#FEF08A, #FEF08A) !important;
        box-decoration-break: clone !important;
        -webkit-box-decoration-break: clone !important;
        padding: 0 !important;
        border-radius: 0 !important;
        text-decoration: none !important;
      }
    `;
  } else if (effectivePreferences.linkStyle === 'border') {
    css += `
      a, a:link, a:visited {
        border: 2px solid currentColor !important;
        padding: 2px 4px !important;
        border-radius: 4px !important;
        text-decoration: none !important;
      }
    `;
  }

  // High contrast mode (Yellow on Black)
  if (effectivePreferences.contrastMode === 'high-contrast-yellow') {
    css += `
      body, body * {
        background-color: #000000 !important;
        color: #FFFF00 !important;
        border-color: #FFFF00 !important;
      }

      a, a:link, a:visited {
        color: #FFFF00 !important;
      }

      img, video, iframe {
        filter: brightness(0.8) contrast(1.2) !important;
      }
    `;
  }

  // Hide ads
  if (effectivePreferences.hideAds) {
    css += `
      /* Common ad selectors */
      [class*="ad-"], [id*="ad-"],
      [class*="advertisement"], [id*="advertisement"],
      [class*="banner"], [id*="banner"],
      .ad, .ads, .advert, .advertisement,
      iframe[src*="doubleclick"],
      iframe[src*="googlesyndication"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
  }

  styleElement.textContent = css;
  document.head.appendChild(styleElement);

  console.log('[IEEE Extension] Accessibility styles applied');
}


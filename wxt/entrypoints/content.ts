import tocbot from 'tocbot';
import { browser } from 'wxt/browser';
import { storage } from '@wxt-dev/storage';

interface UserPreferences {
  fontSize: 'standard' | 'large' | 'extra-large';
  linkStyle: 'default' | 'underline' | 'highlight' | 'border';
  contrastMode: 'standard' | 'high-contrast-yellow';
  hideAds: boolean;
  simplifyLanguage: boolean;
  showBreadcrumbs: boolean;
  ttsRate: number;
  autoReadAssistant: boolean;
  profileName: string;
}

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  fontSize: 'standard',
  linkStyle: 'default',
  contrastMode: 'standard',
  hideAds: false,
  simplifyLanguage: false,
  showBreadcrumbs: false,
  ttsRate: 1,
  autoReadAssistant: false,
  profileName: 'My Profile',
};

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

    // Listen for messages from sidepanel
    initMessageListener();
    console.log('[IEEE Extension] Message listener initialized');

    // Notify sidepanel that page is loaded
    notifyPageLoaded();
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
    .slice(0, 10);

  const pageData = {
    title,
    headings,
    paragraphs,
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
    } else {
      console.log('[IEEE Extension] No preferences found, using defaults');
      removeAccessibilityStyles();
    }

    // Watch for preference changes (even if preferences aren't set yet).
    storage.watch<UserPreferences>('sync:userPreferences', (newPreferences) => {
      if (newPreferences) {
        console.log('[IEEE Extension] Preferences updated:', newPreferences);
        applyAccessibilityStyles(newPreferences);
      } else {
        removeAccessibilityStyles();
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
    `;
  } else if (effectivePreferences.fontSize === 'extra-large') {
    css += `
      body {
        zoom: 1.5 !important;
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
        padding: 2px 4px !important;
        border-radius: 2px !important;
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

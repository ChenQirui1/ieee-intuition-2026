import type { UserProfile, FontSize, SpacingMode } from '@/types/userProfile';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('[IEEE Extension] Content script loaded');
    initInterpreter();
  },
});

// Mock user profile - will be replaced with actual storage later
const mockUserProfile: UserProfile = {
  theme: {
    // Color preferences
    primaryColor: '#3b82f6', // blue-500
    backgroundColor: '#ffffff',
    textColor: '#1f2937', // gray-800
    highlightColor: '#fbbf24', // amber-400

    // Accessibility settings
    highContrast: true,
    colorBlindMode: 'none', // 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'

    // Typography
    fontSize: 'large', // 'small' | 'medium' | 'large' | 'x-large'
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineHeight: 1.6,
    letterSpacing: 'normal',

    // Spacing
    spacing: 'normal', // 'compact' | 'normal' | 'comfortable'
  },
  interactions: {
    highlightOnHover: true,
    showTooltips: true,
  },
};

/**
 * Initialize the Interpreter
 */
async function initInterpreter() {
  try {
    // Step 1: Load profile (using mock for now)
    const userProfile = await loadUserProfile();
    console.log('[IEEE Extension] User profile loaded:', userProfile);

    // Step 2: Inject theme
    injectTheme(userProfile.theme);
    console.log('[IEEE Extension] Theme injected');

    // Step 3: Initialize the Highlighter
    if (userProfile.interactions.highlightOnHover) {
      initHighlighter(userProfile);
      console.log('[IEEE Extension] Highlighter initialized');
    }

    // Step 4: Initialize click handler for sidepanel
    initClickHandler();
    console.log('[IEEE Extension] Click handler initialized');

    // Step 5: Listen for messages from sidepanel
    initMessageListener();
    console.log('[IEEE Extension] Message listener initialized');

    // Step 6: Notify sidepanel that page is loaded
    notifyPageLoaded();
  } catch (error) {
    console.error('[IEEE Extension] Failed to initialize:', error);
  }
}

/**
 * Load user profile from storage (mock implementation)
 */
async function loadUserProfile() {
  // TODO: Replace with actual storage.sync.get() when settings page is ready
  // const result = await browser.storage.sync.get('userProfile');
  // return result.userProfile || mockUserProfile;

  return mockUserProfile;
}

/**
 * Inject theme CSS variables into the page
 */
function injectTheme(theme: UserProfile['theme']) {
  // Create or get existing style element
  let styleEl = document.getElementById('ieee-extension-theme') as HTMLStyleElement;

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ieee-extension-theme';
    document.head.appendChild(styleEl);
  }

  // Font size mapping
  const fontSizeMap = {
    small: '14px',
    medium: '16px',
    large: '18px',
    'x-large': '20px',
  };

  // Spacing mapping
  const spacingMap = {
    compact: '0.75',
    normal: '1',
    comfortable: '1.25',
  };

  // Build CSS with custom properties and actual style overrides
  const css = `
    :root {
      --ieee-primary-color: ${theme.primaryColor};
      --ieee-bg-color: ${theme.backgroundColor};
      --ieee-text-color: ${theme.textColor};
      --ieee-highlight-color: ${theme.highlightColor};
      --ieee-font-size: ${fontSizeMap[theme.fontSize]};
      --ieee-font-family: ${theme.fontFamily};
      --ieee-line-height: ${theme.lineHeight};
      --ieee-letter-spacing: ${theme.letterSpacing};
      --ieee-spacing-multiplier: ${spacingMap[theme.spacing]};
    }

    /* Apply font size adjustments */
    body, p, div, span, li, td, th, a, button, input, textarea, select {
      font-size: ${fontSizeMap[theme.fontSize]} !important;
      line-height: ${theme.lineHeight} !important;
      letter-spacing: ${theme.letterSpacing} !important;
    }

    /* Apply font family */
    body, p, div, span, li, td, th, a, button, input, textarea, select {
      font-family: ${theme.fontFamily} !important;
    }

    /* Apply spacing adjustments */
    p, h1, h2, h3, h4, h5, h6, ul, ol, li {
      margin-top: calc(1em * ${spacingMap[theme.spacing]}) !important;
      margin-bottom: calc(1em * ${spacingMap[theme.spacing]}) !important;
    }

    /* Apply padding adjustments */
    button, input, textarea, select {
      padding: calc(0.5em * ${spacingMap[theme.spacing]}) calc(1em * ${spacingMap[theme.spacing]}) !important;
    }

    /* Highlight animation */
    @keyframes ieee-highlight-pulse {
      0% {
        outline: 3px solid ${theme.highlightColor};
        outline-offset: 2px;
        background-color: ${theme.highlightColor}20;
      }
      50% {
        outline: 3px solid ${theme.highlightColor};
        outline-offset: 4px;
        background-color: ${theme.highlightColor}30;
      }
      100% {
        outline: 3px solid ${theme.highlightColor};
        outline-offset: 2px;
        background-color: ${theme.highlightColor}20;
      }
    }

    .ieee-highlighted {
      outline: 3px solid ${theme.highlightColor} !important;
      outline-offset: 2px !important;
      background-color: ${theme.highlightColor}20 !important;
      border-radius: 4px !important;
      animation: ieee-highlight-pulse 0.6s ease-out;
    }

    /* Selected element (persistent highlight) */
    .ieee-selected {
      outline: 3px solid ${theme.highlightColor} !important;
      outline-offset: 2px !important;
      background-color: ${theme.highlightColor}30 !important;
      border-radius: 4px !important;
    }

    /* High contrast mode */
    ${theme.highContrast ? `
      body {
        filter: contrast(1.5) brightness(1.1) !important;
      }

      /* Enhance text contrast */
      p, h1, h2, h3, h4, h5, h6, span, a, li, td, th {
        color: #000000 !important;
        text-shadow: 0 0 1px rgba(0,0,0,0.3) !important;
      }

      /* Enhance borders */
      button, input, textarea, select, a {
        border: 2px solid #000000 !important;
      }
    ` : ''}

    /* Color blind modes - using CSS filters */
    ${theme.colorBlindMode === 'protanopia' ? `
      html {
        filter: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="protanopia"><feColorMatrix type="matrix" values="0.567, 0.433, 0, 0, 0, 0.558, 0.442, 0, 0, 0, 0, 0.242, 0.758, 0, 0, 0, 0, 0, 1, 0"/></filter></svg>#protanopia');
      }
    ` : ''}
    ${theme.colorBlindMode === 'deuteranopia' ? `
      html {
        filter: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="deuteranopia"><feColorMatrix type="matrix" values="0.625, 0.375, 0, 0, 0, 0.7, 0.3, 0, 0, 0, 0, 0.3, 0.7, 0, 0, 0, 0, 0, 1, 0"/></filter></svg>#deuteranopia');
      }
    ` : ''}
    ${theme.colorBlindMode === 'tritanopia' ? `
      html {
        filter: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="tritanopia"><feColorMatrix type="matrix" values="0.95, 0.05, 0, 0, 0, 0, 0.433, 0.567, 0, 0, 0, 0.475, 0.525, 0, 0, 0, 0, 0, 1, 0"/></filter></svg>#tritanopia');
      }
    ` : ''}
  `;

  styleEl.textContent = css;
}

/**
 * Initialize the Highlighter - adds hover listener to highlight elements
 * Highlights persist until hovering over a different element
 */
function initHighlighter(userProfile: UserProfile) {
  let currentHighlighted: HTMLElement | null = null;

  // Global mouseover listener (bubbles up from child elements)
  document.addEventListener('mouseover', (event) => {
    const target = event.target as HTMLElement;

    // Skip if hovering over the extension's own elements
    if (target.closest('[data-ieee-extension]')) {
      return;
    }

    // Skip text nodes and document
    if (target.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    // Skip if already highlighting this element
    if (target === currentHighlighted) {
      return;
    }

    // Remove previous highlight
    if (currentHighlighted) {
      currentHighlighted.classList.remove('ieee-highlighted');
    }

    // Add highlight to hovered element (persists after mouse leaves)
    target.classList.add('ieee-highlighted');
    currentHighlighted = target;
  }, true); // Use capture phase to catch events early

  console.log('[IEEE Extension] Persistent hover highlighter active');
}

/**
 * Initialize click handler to send element data to sidepanel
 */
function initClickHandler() {
  let selectionMode = false;
  let selectedElement: HTMLElement | null = null;

  // Listen for selection mode toggle from sidepanel
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_SELECTION_MODE') {
      selectionMode = message.enabled;

      // Clear selection when turning off
      if (!selectionMode && selectedElement) {
        selectedElement.classList.remove('ieee-selected');
        selectedElement = null;
      }

      console.log('[IEEE Extension] Selection mode', selectionMode ? 'enabled' : 'disabled');
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    // Skip if clicking on the extension's own elements
    if (target.closest('[data-ieee-extension]')) {
      return;
    }

    // Skip text nodes and document
    if (target.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    // If selection mode is ON, prevent default behavior and highlight
    if (selectionMode) {
      event.preventDefault();
      event.stopPropagation();

      // Remove previous selection
      if (selectedElement) {
        selectedElement.classList.remove('ieee-selected');
      }

      // Add selection to clicked element
      target.classList.add('ieee-selected');
      selectedElement = target;

      // Extract text content
      const text = target.textContent?.trim() || '';

      // Extract element information
      const elementData = {
        tag: target.tagName.toLowerCase(),
        text: text,
        id: target.id || undefined,
        classes: Array.from(target.classList).filter(cls => cls !== 'ieee-selected'),
      };

      // Send to sidepanel
      browser.runtime.sendMessage({
        type: 'ELEMENT_CLICKED',
        data: elementData,
      }).catch(() => {
        // Sidepanel might not be open, that's okay
      });

      console.log('[IEEE Extension] Element selected:', elementData);
      return;
    }

    // If selection mode is OFF, allow normal clicking
    // Only send to sidepanel if there's meaningful text content
    const text = target.textContent?.trim() || '';
    if (text.length >= 10) {
      const elementData = {
        tag: target.tagName.toLowerCase(),
        text: text,
        id: target.id || undefined,
        classes: Array.from(target.classList),
      };

      // Send to sidepanel (non-blocking)
      browser.runtime.sendMessage({
        type: 'ELEMENT_CLICKED',
        data: elementData,
      }).catch(() => {
        // Sidepanel might not be open, that's okay
      });
    }
  }, true);
}

/**
 * Initialize message listener for sidepanel commands
 */
function initMessageListener() {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'GET_PAGE_CONTENT') {
      handleGetPageContent();
    } else if (message.type === 'TOGGLE_SIMPLIFY_VIEW') {
      handleToggleSimplifyView(message.enabled);
    }
  });
}

/**
 * Handle GET_PAGE_CONTENT message - extract page content for summary
 */
function handleGetPageContent() {
  // Extract main content from the page
  const title = document.title;
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map((h) => h.textContent?.trim())
    .filter(Boolean)
    .slice(0, 5);

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
}

/**
 * Handle TOGGLE_SIMPLIFY_VIEW message - hide/show clutter
 */
function handleToggleSimplifyView(enabled: boolean) {
  if (enabled) {
    // Add simplified view styles
    const style = document.createElement('style');
    style.id = 'ieee-simplify-view';
    style.textContent = `
      /* Hide common clutter elements */
      aside,
      nav:not([role="navigation"]),
      [role="complementary"],
      [role="banner"]:not(:first-of-type),
      .sidebar,
      .advertisement,
      .ad,
      .social-share,
      .comments,
      .related-posts,
      iframe:not([title*="video"]) {
        display: none !important;
      }

      /* Simplify main content */
      body {
        max-width: 800px !important;
        margin: 0 auto !important;
        padding: 2rem !important;
        background: white !important;
      }

      /* Enhance readability */
      p, li {
        line-height: 1.8 !important;
        font-size: 18px !important;
      }

      /* Remove background images and colors */
      * {
        background-image: none !important;
      }
    `;
    document.head.appendChild(style);
    console.log('[IEEE Extension] Simplified view enabled');
  } else {
    // Remove simplified view styles
    const style = document.getElementById('ieee-simplify-view');
    if (style) {
      style.remove();
      console.log('[IEEE Extension] Simplified view disabled');
    }
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

import { useState, useEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '@wxt-dev/storage';
import { simplifyPage, sendTextCompletion } from './api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface PageSummary {
  bullets: string[];
}

interface Heading {
  text: string;
  level: number;
  index: number;
}

interface UserPreferences {
  fontSize: 'standard' | 'large' | 'extra-large';
  linkStyle: 'default' | 'underline' | 'highlight' | 'border';
  contrastMode: 'standard' | 'high-contrast-yellow';
  magnifyingZoomLevel: 1.5 | 2 | 2.5 | 3;
  hideAds: boolean;
  simplifyLanguage: boolean;
  showBreadcrumbs: boolean;
  profileName: string;
}

const SelectionIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="7.5" />
    <line x1="12" y1="2.5" x2="12" y2="5.5" />
    <line x1="12" y1="18.5" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="5.5" y2="12" />
    <line x1="18.5" y1="12" x2="21.5" y2="12" />
  </svg>
);

const MagnifierIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6.5" />
    <line x1="16.2" y1="16.2" x2="21.5" y2="21.5" />
  </svg>
);

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'chat' | 'headings'>('summary');
  const [selectionMode, setSelectionMode] = useState(false);
  const [magnifyingMode, setMagnifyingMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [pageId, setPageId] = useState<string>('');
  const [simplificationId, setSimplificationId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initialize session ID
    const initSession = async () => {
      let sid = await storage.getItem<string>('session:sessionId');
      if (!sid) {
        sid = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await storage.setItem('session:sessionId', sid);
      }
      setSessionId(sid);
    };
    initSession();

    // Test backend connection
    testBackendConnection();

    // Get current tab URL
    const getCurrentUrl = async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
          setCurrentUrl(tabs[0].url);
          // Load cached context for this URL
          const cachedPageId = await storage.getItem<string>(`session:pageId:${tabs[0].url}`);
          const cachedSimplId = await storage.getItem<string>(`session:simplificationId:${tabs[0].url}`);
          if (cachedPageId) setPageId(cachedPageId);
          if (cachedSimplId) setSimplificationId(cachedSimplId);

          // Load chat messages for this URL
          const savedMessages = await storage.getItem<Message[]>(`local:chatMessages:${tabs[0].url}`);
          if (savedMessages && Array.isArray(savedMessages)) {
            console.log('[Sidepanel] Loaded saved messages:', savedMessages.length);
            setMessages(savedMessages);
          }
        }
      } catch (error) {
        console.error('[Sidepanel] Failed to get current URL:', error);
      }
    };
    getCurrentUrl();

    // Listen for messages from content script
    const handleMessage = (message: any, sender: any, sendResponse: any) => {
      console.log('[Sidepanel] Received message:', message);
      if (message.type === 'CAPTURE_VISIBLE_TAB') {
        const windowId = sender?.tab?.windowId ?? browser.windows.WINDOW_ID_CURRENT;
        browser.tabs.captureVisibleTab(windowId, { format: 'png' })
          .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
          .catch((error) => {
            console.error('[Sidepanel] captureVisibleTab failed:', error);
            sendResponse({ ok: false });
          });
        return true;
      }
      if (message.type === 'ELEMENT_CLICKED') {
        // Switch to chat tab if openChat flag is set
        if (message.openChat) {
          setActiveTab('chat');
        }
        handleElementClick(message.data);
      } else if (message.type === 'MAGNIFYING_MODE_CHANGED') {
        setMagnifyingMode(message.enabled);
      } else if (message.type === 'PAGE_LOADED') {
        console.log('[Sidepanel] Page loaded data:', message.data);
        console.log('[Sidepanel] Headings received:', message.data.headings);
        generatePageSummary(message.data);
        setHeadings(message.data.headings || []);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);

    // Request initial page summary
    requestPageSummary();

    // Load user preferences for zoom
    loadPreferences();

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const loadPreferences = async () => {
    try {
      const preferences = await storage.getItem<UserPreferences>('sync:userPreferences');
      if (preferences) {
        applyZoom(preferences.fontSize);

        // Watch for preference changes
        storage.watch<UserPreferences>('sync:userPreferences', (newPreferences) => {
          if (newPreferences) {
            applyZoom(newPreferences.fontSize);
          }
        });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to load preferences:', error);
    }
  };

  const applyZoom = (fontSize: 'standard' | 'large' | 'extra-large') => {
    if (fontSize === 'large') {
      setZoomLevel(1.25);
    } else if (fontSize === 'extra-large') {
      setZoomLevel(1.5);
    } else {
      setZoomLevel(1);
    }
  };

  const handleZoomChange = async (fontSize: 'standard' | 'large' | 'extra-large') => {
    try {
      // Load current preferences
      const preferences = await storage.getItem<UserPreferences>('sync:userPreferences');
      if (preferences) {
        // Update fontSize and save
        const updatedPreferences = { ...preferences, fontSize };
        await storage.setItem('sync:userPreferences', updatedPreferences);
        applyZoom(fontSize);
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to update zoom:', error);
    }
  };

  const handleZoomIn = () => {
    if (zoomLevel === 1) {
      handleZoomChange('large');
    } else if (zoomLevel === 1.25) {
      handleZoomChange('extra-large');
    }
  };

  const handleZoomOut = () => {
    if (zoomLevel === 1.5) {
      handleZoomChange('large');
    } else if (zoomLevel === 1.25) {
      handleZoomChange('standard');
    }
  };

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const requestPageSummary = async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_CONTENT' });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to request page summary:', error);
    }
  };

  const generatePageSummary = async (pageData: any) => {
    console.log('[Sidepanel] generatePageSummary called with pageData:', pageData);
    setIsLoading(true);
    setError('');
    try {
      if (!currentUrl) {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
          console.log('[Sidepanel] Got URL from tab:', tabs[0].url);
          setCurrentUrl(tabs[0].url);
        } else {
          throw new Error('Could not get current tab URL');
        }
      }

      const url = currentUrl || (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.url;
      if (!url) {
        throw new Error('No URL available');
      }

      console.log('[Sidepanel] Calling simplifyPage API with URL:', url);
      console.log('[Sidepanel] Session ID:', sessionId);

      // Call the real API
      const response = await simplifyPage(url, 'easy_read', 'en', sessionId);

      console.log('[Sidepanel] API response received:', {
        page_id: response.page_id,
        language: response.language,
        has_outputs: !!response.outputs,
        has_easy_read: !!response.outputs?.easy_read
      });

      // Store context in session storage
      setPageId(response.page_id);
      setSimplificationId(response.simplification_ids.easy_read || '');
      await storage.setItem(`session:pageId:${url}`, response.page_id);
      await storage.setItem(`session:simplificationId:${url}`, response.simplification_ids.easy_read || '');

      // Extract summary from easy_read output
      const easyRead = response.outputs.easy_read;
      if (easyRead) {
        console.log('[Sidepanel] Extracted key_points:', easyRead.key_points);
        setSummary({
          bullets: easyRead.key_points || [],
        });
      } else {
        console.warn('[Sidepanel] No easy_read output in response');
        setSummary({
          bullets: ['Summary not available. Please try again.'],
        });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to generate summary:', error);
      console.error('[Sidepanel] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      setError(error instanceof Error ? error.message : 'Failed to generate summary');
      setSummary({
        bullets: ['Failed to load summary. Make sure the backend server is running.'],
      });
    } finally {
      setIsLoading(false);
      console.log('[Sidepanel] generatePageSummary completed');
    }
  };

  const handleElementClick = async (elementData: any) => {
    const { text, tag } = elementData;

    if (!text || text.trim().length === 0) {
      return;
    }

    // Add user message - focus on content, not HTML element type
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `What does this mean: "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Save to local storage
    await storage.setItem(`local:chatMessages:${currentUrl}`, updatedMessages);

    // Generate AI response
    setIsLoading(true);
    setError('');
    try {
      // Build conversation history as a single text string
      let conversationText = 'You are a helpful assistant that explains things in very simple, easy-to-understand language. Use short sentences. Avoid jargon.\n\n';

      if (updatedMessages.length > 1) {
        conversationText += 'Previous conversation:\n';
        // Include last 5 messages for context
        const recentMessages = updatedMessages.slice(-6, -1);
        for (const msg of recentMessages) {
          conversationText += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
        }
        conversationText += '\n';
      }

      conversationText += `Text to explain: "${text.substring(0, 500)}"\n\nWhat does this mean?`;

      // Call the text-completion API with conversation history
      const response = await sendTextCompletion(conversationText, 0.7);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessages(finalMessages);

      // Save to local storage
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
    } catch (error) {
      console.error('[Sidepanel] Failed to get AI response:', error);
      setError(error instanceof Error ? error.message : 'Failed to get response');

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I could not process your request. Please make sure the backend server is running.',
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, errorMessage];
      setMessages(finalMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelectionMode = async () => {
    setSelectionMode(!selectionMode);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_SELECTION_MODE',
          enabled: !selectionMode,
        });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to toggle selection mode:', error);
    }
  };

  const toggleMagnifyingMode = async () => {
    const nextEnabled = !magnifyingMode;
    setMagnifyingMode(nextEnabled);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_MAGNIFYING_MODE',
          enabled: nextEnabled,
        });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to toggle magnifying mode:', error);
    }
  };

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  const testBackendConnection = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/openai-test', {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      if (response.ok) {
        setBackendStatus('connected');
      } else {
        setBackendStatus('disconnected');
      }
    } catch (error) {
      console.error('[Sidepanel] Backend connection test failed:', error);
      setBackendStatus('disconnected');
    }
  };

  const handleSubmitMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    const text = inputText.trim();
    if (!text) return;

    // Clear input
    setInputText('');

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Save to local storage
    await storage.setItem(`local:chatMessages:${currentUrl}`, updatedMessages);

    // Generate AI response
    setIsLoading(true);
    setError('');
    try {
      // Build conversation history as a single text string
      let conversationText = 'You are a helpful assistant that explains things in very simple, easy-to-understand language. Use short sentences. Avoid jargon.\n\n';

      if (updatedMessages.length > 1) {
        conversationText += 'Previous conversation:\n';
        // Include last 5 messages for context (to avoid too long prompts)
        const recentMessages = updatedMessages.slice(-6, -1);
        for (const msg of recentMessages) {
          conversationText += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
        }
        conversationText += '\n';
      }

      conversationText += `Current question: ${text}`;

      // Call the text-completion API with conversation history
      const response = await sendTextCompletion(conversationText, 0.7);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessages(finalMessages);

      // Save to local storage
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
    } catch (error) {
      console.error('[Sidepanel] Failed to get AI response:', error);
      setError(error instanceof Error ? error.message : 'Failed to get response');

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I could not process your request. Please make sure the backend server is running.',
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, errorMessage];
      setMessages(finalMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleHeadingClick = async (heading: Heading) => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'SCROLL_TO_HEADING',
          index: heading.index,
        });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to scroll to heading:', error);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Error Banner */}
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">⚠️ Error:</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError('')}
              className="text-red-700 hover:text-red-900 font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {/* Header with Tabs */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg">
        <div className="flex border-b border-blue-500">
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'summary'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            💡 Summary
          </button>
          <button
            onClick={() => setActiveTab('headings')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'headings'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            📑 Headings
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'chat'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            💬 Chat
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'summary' ? (
        /* Summary Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-4xl">💡</span>
              In short...
            </h2>
            {isLoading && !summary ? (
              <div className="space-y-3">
                <div className="h-4 bg-gray-300 rounded animate-pulse"></div>
                <div className="h-4 bg-gray-300 rounded animate-pulse w-5/6"></div>
                <div className="h-4 bg-gray-300 rounded animate-pulse w-4/6"></div>
              </div>
            ) : summary ? (
              <ul className="space-y-3">
                {summary.bullets.map((bullet, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-lg">
                    <span className="text-blue-600 mt-1 text-2xl">•</span>
                    <span className="leading-relaxed text-gray-700">{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 text-lg">
                Loading page summary...
              </p>
            )}
          </div>

          {/* Controls for Summary Tab */}
          <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
            {/* Backend Status */}
            <div className="mb-3 p-2 rounded-lg bg-gray-50 border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-600">Backend:</span>
                  {backendStatus === 'connected' && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      Connected
                    </span>
                  )}
                  {backendStatus === 'disconnected' && (
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      Disconnected
                    </span>
                  )}
                  {backendStatus === 'unknown' && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                      Testing...
                    </span>
                  )}
                </div>
                <button
                  onClick={testBackendConnection}
                  className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                  title="Test backend connection"
                >
                  🔄 Test
                </button>
              </div>
            </div>

            {/* Zoom Controls */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Zoom</span>
                <button
                  onClick={openSettings}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  ⚙️ Settings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 1}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <button
                  onClick={handleZoomIn}
                  disabled={zoomLevel === 1.5}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Other Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectionMode}
                className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg transition-colors ${
                  selectionMode
                    ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                    : 'bg-yellow-50 hover:bg-yellow-100'
                }`}
              >
                <SelectionIcon className="w-5 h-5 text-yellow-700" />
                <span className="text-xs font-medium text-gray-700">
                  {selectionMode ? 'Selection ON' : 'Selection OFF'}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`w-12 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  magnifyingMode
                    ? 'bg-blue-100 hover:bg-blue-200 ring-2 ring-blue-400'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title="Toggle magnifying glass"
              >
                <MagnifierIcon className="w-5 h-5 text-blue-700" />
              </button>
            </div>
          </div>
        </>
      ) : activeTab === 'headings' ? (
        /* Headings Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                <span className="text-4xl">📑</span>
                Table of Contents
              </h2>
              <button
                onClick={requestPageSummary}
                className="px-3 py-1 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                🔄 Refresh
              </button>
            </div>
            {headings.length === 0 ? (
              <div className="text-gray-500 text-lg">
                <p className="mb-2">No headings found on this page.</p>
                <p className="text-base">Try clicking the Refresh button above.</p>
              </div>
            ) : (
              <nav className="space-y-1">
                {headings.map((heading, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleHeadingClick(heading)}
                    className={`w-full text-left px-4 py-3 rounded-lg hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-200 ${
                      heading.level === 1 ? 'font-bold text-lg' :
                      heading.level === 2 ? 'font-semibold text-base' :
                      'text-base'
                    }`}
                    style={{
                      paddingLeft: `${heading.level * 0.75}rem`,
                    }}
                  >
                    <span className="text-blue-600 mr-2">
                      {heading.level === 1 ? '▶' : heading.level === 2 ? '▸' : '·'}
                    </span>
                    <span className="text-gray-800">{heading.text}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>

          {/* Controls for Headings Tab */}
          <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
            {/* Zoom Controls */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Zoom</span>
                <button
                  onClick={openSettings}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  ⚙️ Settings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 1}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <button
                  onClick={handleZoomIn}
                  disabled={zoomLevel === 1.5}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Other Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectionMode}
                className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg transition-colors ${
                  selectionMode
                    ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                    : 'bg-yellow-50 hover:bg-yellow-100'
                }`}
              >
                <SelectionIcon className="w-5 h-5 text-yellow-700" />
                <span className="text-xs font-medium text-gray-700">
                  {selectionMode ? 'Selection ON' : 'Selection OFF'}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`w-12 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  magnifyingMode
                    ? 'bg-blue-100 hover:bg-blue-200 ring-2 ring-blue-400'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title="Toggle magnifying glass"
              >
                <MagnifierIcon className="w-5 h-5 text-blue-700" />
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Chat Tab */
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-0">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 mt-8">
                <svg
                  className="w-16 h-16 mx-auto mb-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                <p className="text-base font-medium mb-1">No conversation yet</p>
                <p className="text-sm">Click on paragraphs or text on the page to start</p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-4 py-3 ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-900 shadow-md border border-gray-200'
                      }`}
                    >
                      <p className="text-base leading-relaxed">{message.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                        }`}
                      >
                        {message.timestamp.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white text-gray-900 shadow-md border border-gray-200 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Text Input Section */}
          <div className="border-t border-gray-200 bg-white p-4">
            <form onSubmit={handleSubmitMessage} className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type your question..."
                disabled={isLoading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={isLoading || !inputText.trim()}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </form>
          </div>

          {/* Controls for Chat Tab */}
          <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
            {/* Zoom Controls */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Zoom</span>
                <button
                  onClick={openSettings}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  ⚙️ Settings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 1}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <button
                  onClick={handleZoomIn}
                  disabled={zoomLevel === 1.5}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Selection Mode Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectionMode}
                className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg transition-colors ${
                  selectionMode
                    ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                    : 'bg-yellow-50 hover:bg-yellow-100'
                }`}
              >
                <SelectionIcon className="w-5 h-5 text-yellow-700" />
                <span className="text-xs font-medium text-gray-700">
                  {selectionMode ? 'Selection ON' : 'Selection OFF'}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`w-12 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  magnifyingMode
                    ? 'bg-blue-100 hover:bg-blue-200 ring-2 ring-blue-400'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title="Toggle magnifying glass"
              >
                <MagnifierIcon className="w-5 h-5 text-blue-700" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;

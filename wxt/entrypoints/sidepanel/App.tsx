import { useState, useEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '@wxt-dev/storage';

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
  hideAds: boolean;
  simplifyLanguage: boolean;
  showBreadcrumbs: boolean;
  profileName: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'chat' | 'headings'>('summary');
  const [selectionMode, setSelectionMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for messages from content script
    const handleMessage = (message: any) => {
      console.log('[Sidepanel] Received message:', message);
      if (message.type === 'ELEMENT_CLICKED') {
        // Switch to chat tab if openChat flag is set
        if (message.openChat) {
          setActiveTab('chat');
        }
        handleElementClick(message.data);
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
    setIsLoading(true);
    try {
      // TODO: Replace with actual AI API call
      // Mock AI response for now
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setSummary({
        bullets: [
          'This page contains information about web accessibility',
          'Key topics include ARIA labels and semantic HTML',
          'Interactive elements are highlighted for easier navigation',
        ],
      });
    } catch (error) {
      console.error('[Sidepanel] Failed to generate summary:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleElementClick = async (elementData: any) => {
    const { text, tag } = elementData;

    if (!text || text.trim().length === 0) {
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `Explain this ${tag}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Generate AI response
    setIsLoading(true);
    try {
      // TODO: Replace with actual AI API call
      // Mock AI response for now
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `This part is about ${text.substring(0, 50)}. In simpler terms, it means that the content is explaining something important to help you understand the topic better.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('[Sidepanel] Failed to get AI response:', error);
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

  const openSettings = () => {
    browser.runtime.openOptionsPage();
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
    setMessages((prev) => [...prev, userMessage]);

    // Generate AI response
    setIsLoading(true);
    try {
      // TODO: Replace with actual AI API call
      // Mock AI response for now
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I understand you're asking about "${text}". Let me help explain that in simpler terms. This is a mock response that will be replaced with actual AI processing.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('[Sidepanel] Failed to get AI response:', error);
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
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-3xl">💡</span>
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
                  <li key={idx} className="flex items-start gap-3 text-base">
                    <span className="text-blue-600 mt-1 text-xl">•</span>
                    <span className="leading-relaxed text-gray-700">{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">
                Loading page summary...
              </p>
            )}
          </div>

          {/* Controls for Summary Tab */}
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
            <button
              onClick={toggleSelectionMode}
              className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg transition-colors ${
                selectionMode
                  ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                  : 'bg-yellow-50 hover:bg-yellow-100'
              }`}
            >
              <span className="text-2xl">🎯</span>
              <span className="text-sm font-medium text-gray-700">
                {selectionMode ? 'Selection ON' : 'Selection OFF'}
              </span>
            </button>
          </div>
        </>
      ) : activeTab === 'headings' ? (
        /* Headings Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <span className="text-3xl">📑</span>
                Table of Contents
              </h2>
              <button
                onClick={requestPageSummary}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                🔄 Refresh
              </button>
            </div>
            {headings.length === 0 ? (
              <div className="text-gray-500">
                <p className="mb-2">No headings found on this page.</p>
                <p className="text-sm">Try clicking the Refresh button above.</p>
              </div>
            ) : (
              <nav className="space-y-1">
                {headings.map((heading, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleHeadingClick(heading)}
                    className={`w-full text-left px-4 py-3 rounded-lg hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-200 ${
                      heading.level === 1 ? 'font-bold text-base' :
                      heading.level === 2 ? 'font-semibold text-sm' :
                      'text-sm'
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
            <button
              onClick={toggleSelectionMode}
              className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg transition-colors ${
                selectionMode
                  ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                  : 'bg-yellow-50 hover:bg-yellow-100'
              }`}
            >
              <span className="text-2xl">🎯</span>
              <span className="text-sm font-medium text-gray-700">
                {selectionMode ? 'Selection ON' : 'Selection OFF'}
              </span>
            </button>
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
                <p className="text-sm font-medium mb-1">No conversation yet</p>
                <p className="text-xs">Click on paragraphs or text on the page to start</p>
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
                      <p className="text-sm leading-relaxed">{message.content}</p>
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
            <button
              onClick={toggleSelectionMode}
              className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg transition-colors ${
                selectionMode
                  ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                  : 'bg-yellow-50 hover:bg-yellow-100'
              }`}
            >
              <span className="text-2xl">🎯</span>
              <span className="text-sm font-medium text-gray-700">
                {selectionMode ? 'Selection ON' : 'Selection OFF'}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;

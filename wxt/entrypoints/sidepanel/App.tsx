import { useState, useEffect, useRef } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface PageSummary {
  bullets: string[];
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [simplifyView, setSimplifyView] = useState(false);
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'chat'>('summary');
  const [selectionMode, setSelectionMode] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for messages from content script
    const handleMessage = (message: any) => {
      if (message.type === 'ELEMENT_CLICKED') {
        handleElementClick(message.data);
      } else if (message.type === 'PAGE_LOADED') {
        generatePageSummary(message.data);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);

    // Request initial page summary
    requestPageSummary();

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

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

  const handleReadAloud = () => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'assistant') {
      // Use Web Speech API
      const utterance = new SpeechSynthesisUtterance(lastMessage.content);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleSimplifyView = async () => {
    setSimplifyView(!simplifyView);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_SIMPLIFY_VIEW',
          enabled: !simplifyView,
        });
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to toggle simplify view:', error);
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

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header with Tabs */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg">
        <div className="flex border-b border-blue-500">
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex-1 px-6 py-4 font-semibold transition-colors ${
              activeTab === 'summary'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            💡 Summary
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 px-6 py-4 font-semibold transition-colors ${
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
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={toggleSelectionMode}
                className={`flex flex-col items-center justify-center p-4 rounded-lg transition-colors ${
                  selectionMode
                    ? 'bg-yellow-100 hover:bg-yellow-200 ring-2 ring-yellow-400'
                    : 'bg-yellow-50 hover:bg-yellow-100'
                }`}
              >
                <span className="text-3xl mb-1">🎯</span>
                <span className="text-xs font-medium text-gray-700">
                  {selectionMode ? 'Selection ON' : 'Selection OFF'}
                </span>
              </button>

              <button
                onClick={toggleSimplifyView}
                className={`flex flex-col items-center justify-center p-4 rounded-lg transition-colors ${
                  simplifyView
                    ? 'bg-purple-100 hover:bg-purple-200'
                    : 'bg-purple-50 hover:bg-purple-100'
                }`}
              >
                <span className="text-3xl mb-1">📄</span>
                <span className="text-xs font-medium text-gray-700">
                  {simplifyView ? 'Normal View' : 'Simplify View'}
                </span>
              </button>

              <button
                onClick={openSettings}
                className="flex flex-col items-center justify-center p-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <span className="text-3xl mb-1">⚙️</span>
                <span className="text-xs font-medium text-gray-700">Edit Profile</span>
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
            <button
              onClick={handleReadAloud}
              disabled={messages.length === 0}
              className="w-full flex items-center justify-center gap-3 p-4 rounded-lg bg-green-50 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="text-3xl">🔊</span>
              <span className="text-sm font-medium text-gray-700">Read Last Message Aloud</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;

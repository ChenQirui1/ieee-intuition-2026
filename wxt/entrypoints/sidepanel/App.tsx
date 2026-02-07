import { useState, useEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '@wxt-dev/storage';
import { simplifyPage, sendImageCaption, sendTextCompletion, type LanguageCode } from './api';
import { useTts } from './useTts';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

function coerceDate(value: unknown): Date {
  if (value instanceof Date) return value;

  const date = new Date(
    typeof value === 'string' || typeof value === 'number' ? value : Date.now(),
  );
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeStoredMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m: any, idx: number) => ({
      id: typeof m.id === 'string' && m.id ? m.id : `${Date.now()}_${idx}`,
      role: m.role === 'user' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
      timestamp: coerceDate(m.timestamp),
    }));
}

function formatTimestamp(value: unknown): string {
  const date = coerceDate(value);
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
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

const UI_STRINGS: Record<LanguageCode, Record<string, string>> = {
  en: {
    error: 'Error',
    tab_summary: 'Summary',
    tab_headings: 'Headings',
    tab_chat: 'Chat',
    in_short: 'In short...',
    table_of_contents: 'Table of Contents',
    refresh: 'Refresh',
    loading_summary: 'Loading page summary...',
    failed_summary: 'Failed to load summary. Make sure the backend server is running.',
    no_headings: 'No headings found on this page.',
    try_refresh: 'Try clicking the Refresh button above.',
    no_conversation: 'No conversation yet',
    click_to_start: 'Click on text or images on the page to start',
    type_question: 'Type your question...',
    send: 'Send',
    backend: 'Backend',
    connected: 'Connected',
    disconnected: 'Disconnected',
    testing: 'Testing...',
    test: 'Test',
    zoom: 'Zoom',
    settings: 'Settings',
    page_language: 'Language',
    original: 'Original',
    selection_on: 'Selection ON',
    selection_off: 'Selection OFF',
    toggle_magnifier: 'Toggle magnifying glass',
    listen: 'Listen',
    pause: 'Pause',
    play: 'Play',
    stop: 'Stop',
    describe_image: 'Describe this image.',
    what_does_this_mean: 'What does this mean:',
    image_caption_error: 'Sorry, I could not caption that image. Please make sure the backend server is running.',
    text_error: 'Sorry, I could not process your request. Please make sure the backend server is running.',
  },
  zh: {
    error: '错误',
    tab_summary: '摘要',
    tab_headings: '目录',
    tab_chat: '聊天',
    in_short: '简而言之...',
    table_of_contents: '目录',
    refresh: '刷新',
    loading_summary: '正在加载页面摘要...',
    failed_summary: '无法加载摘要。请确认后端服务器正在运行。',
    no_headings: '此页面未找到标题。',
    try_refresh: '请点击上方的刷新按钮。',
    no_conversation: '还没有对话',
    click_to_start: '点击网页上的文字或图片开始',
    type_question: '请输入问题...',
    send: '发送',
    backend: '后端',
    connected: '已连接',
    disconnected: '未连接',
    testing: '测试中...',
    test: '测试',
    zoom: '缩放',
    settings: '设置',
    page_language: '语言',
    original: '原文',
    selection_on: '选择 开',
    selection_off: '选择 关',
    toggle_magnifier: '切换放大镜',
    listen: '朗读',
    pause: '暂停',
    play: '播放',
    stop: '停止',
    describe_image: '描述这张图片。',
    what_does_this_mean: '这是什么意思：',
    image_caption_error: '抱歉，我无法为这张图片生成描述。请确认后端服务器正在运行。',
    text_error: '抱歉，我无法处理你的请求。请确认后端服务器正在运行。',
  },
  ms: {
    error: 'Ralat',
    tab_summary: 'Ringkasan',
    tab_headings: 'Kandungan',
    tab_chat: 'Sembang',
    in_short: 'Ringkasnya...',
    table_of_contents: 'Jadual Kandungan',
    refresh: 'Muat semula',
    loading_summary: 'Memuatkan ringkasan halaman...',
    failed_summary: 'Gagal memuat ringkasan. Pastikan pelayan belakang sedang berjalan.',
    no_headings: 'Tiada tajuk ditemui pada halaman ini.',
    try_refresh: 'Cuba tekan butang Muat semula di atas.',
    no_conversation: 'Belum ada perbualan',
    click_to_start: 'Klik teks atau imej pada laman untuk mula',
    type_question: 'Taip soalan anda...',
    send: 'Hantar',
    backend: 'Pelayan',
    connected: 'Disambungkan',
    disconnected: 'Terputus',
    testing: 'Menguji...',
    test: 'Uji',
    zoom: 'Zum',
    settings: 'Tetapan',
    page_language: 'Bahasa',
    original: 'Asal',
    selection_on: 'Pemilihan ON',
    selection_off: 'Pemilihan OFF',
    toggle_magnifier: 'Togol pembesar',
    listen: 'Dengar',
    pause: 'Jeda',
    play: 'Main',
    stop: 'Henti',
    describe_image: 'Terangkan imej ini.',
    what_does_this_mean: 'Apa maksud ini:',
    image_caption_error: 'Maaf, saya tidak dapat menerangkan imej itu. Pastikan pelayan belakang sedang berjalan.',
    text_error: 'Maaf, saya tidak dapat memproses permintaan anda. Pastikan pelayan belakang sedang berjalan.',
  },
  ta: {
    error: 'பிழை',
    tab_summary: 'சுருக்கம்',
    tab_headings: 'தலைப்புகள்',
    tab_chat: 'அரட்டை',
    in_short: 'சுருக்கமாக...',
    table_of_contents: 'உள்ளடக்க பட்டியல்',
    refresh: 'புதுப்பி',
    loading_summary: 'பக்க சுருக்கம் ஏற்றப்படுகிறது...',
    failed_summary: 'சுருக்கத்தை ஏற்ற முடியவில்லை. பின்தள சேவையகம் இயங்குகிறதா என்று சரிபார்க்கவும்.',
    no_headings: 'இந்த பக்கத்தில் தலைப்புகள் இல்லை.',
    try_refresh: 'மேலுள்ள புதுப்பி பொத்தானை அழுத்தி பார்க்கவும்.',
    no_conversation: 'இன்னும் உரையாடல் இல்லை',
    click_to_start: 'தொடங்க பக்கத்தில் உள்ள உரை அல்லது படத்தை கிளிக் செய்யவும்',
    type_question: 'உங்கள் கேள்வியை உள்ளிடவும்...',
    send: 'அனுப்பு',
    backend: 'பின்தளம்',
    connected: 'இணைந்தது',
    disconnected: 'இணைக்கப்படவில்லை',
    testing: 'சோதனை...',
    test: 'சோதனை',
    zoom: 'பெரிதாக்கம்',
    settings: 'அமைப்புகள்',
    page_language: 'மொழி',
    original: 'மூலம்',
    selection_on: 'தேர்வு இயக்கு',
    selection_off: 'தேர்வு அணை',
    toggle_magnifier: 'பெரிதாக்கியை மாற்று',
    listen: 'கேள்',
    pause: 'இடைநிறுத்து',
    play: 'இயக்கு',
    stop: 'நிறுத்து',
    describe_image: 'இந்த படத்தை விவரிக்கவும்.',
    what_does_this_mean: 'இதன் பொருள் என்ன:',
    image_caption_error: 'மன்னிக்கவும், அந்த படத்தை விவரிக்க முடியவில்லை. பின்தள சேவையகம் இயங்குகிறதா என்று சரிபார்க்கவும்.',
    text_error: 'மன்னிக்கவும், உங்கள் கோரிக்கையை செயல்படுத்த முடியவில்லை. பின்தள சேவையகம் இயங்குகிறதா என்று சரிபார்க்கவும்.',
  },
};

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  language: 'en',
  fontSize: 'standard',
  linkStyle: 'default',
  contrastMode: 'standard',
  magnifyingZoomLevel: 2,
  hideAds: false,
  simplifyLanguage: false,
  showBreadcrumbs: false,
  ttsRate: 1,
  autoReadAssistant: false,
  profileName: 'My Profile',
};

const LANGUAGE_BADGE: Record<LanguageCode, string> = {
  en: 'EN',
  zh: '中文',
  ms: 'MS',
  ta: 'தமிழ்',
};

const SUPPORTED_TTS_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function coerceTtsRate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_USER_PREFERENCES.ttsRate;
  return SUPPORTED_TTS_RATES.includes(n as any) ? n : DEFAULT_USER_PREFERENCES.ttsRate;
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
  const tts = useTts();
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_USER_PREFERENCES.language);
  const [pageLanguageMode, setPageLanguageMode] = useState<'preferred' | 'original'>('preferred');

  const ui = UI_STRINGS[language] ?? UI_STRINGS.en;
  const t = (key: keyof typeof UI_STRINGS.en) => ui[key] ?? UI_STRINGS.en[key];

  const [ttsTarget, setTtsTarget] = useState<
    | { kind: 'summary' }
    | { kind: 'headings' }
    | { kind: 'chat'; id: string }
    | null
  >(null);

  const [autoReadAssistantReplies, setAutoReadAssistantReplies] = useState<boolean>(
    DEFAULT_USER_PREFERENCES.autoReadAssistant,
  );

  useEffect(() => {
    if (tts.status === 'idle') {
      setTtsTarget(null);
    }
  }, [tts.status]);

  // Keep audio output scoped to the current view.
  useEffect(() => {
    tts.stop();
    setTtsTarget(null);
  }, [activeTab]);

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
            setMessages(normalizeStoredMessages(savedMessages));
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
      applyZoom(preferences?.fontSize ?? DEFAULT_USER_PREFERENCES.fontSize);
      tts.setRate(coerceTtsRate(preferences?.ttsRate));
      setAutoReadAssistantReplies(
        preferences?.autoReadAssistant ?? DEFAULT_USER_PREFERENCES.autoReadAssistant,
      );
      setLanguage(preferences?.language ?? DEFAULT_USER_PREFERENCES.language);

      // Watch for preference changes (even if preferences aren't set yet).
      storage.watch<UserPreferences>('sync:userPreferences', (newPreferences) => {
        applyZoom(newPreferences?.fontSize ?? DEFAULT_USER_PREFERENCES.fontSize);
        tts.setRate(coerceTtsRate(newPreferences?.ttsRate));
        setAutoReadAssistantReplies(
          newPreferences?.autoReadAssistant ?? DEFAULT_USER_PREFERENCES.autoReadAssistant,
        );
        setLanguage(newPreferences?.language ?? DEFAULT_USER_PREFERENCES.language);
      });
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

  const applyPreferencesToActiveTab = async (preferences: UserPreferences) => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      await browser.tabs.sendMessage(tabId, {
        type: 'APPLY_USER_PREFERENCES',
        preferences,
      });
    } catch {
      // Content script may not be ready (or not allowed on this page); storage watch still covers most cases.
    }
  };

  const applyPageLanguageModeToActiveTab = async (mode: 'preferred' | 'original') => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      await browser.tabs.sendMessage(tabId, {
        type: 'SET_PAGE_LANGUAGE_MODE',
        mode,
        language,
      });
    } catch (error) {
      console.warn('[Sidepanel] Failed to set page language mode:', error);
    }
  };

  const handleZoomChange = async (fontSize: 'standard' | 'large' | 'extra-large') => {
    try {
      // Load current preferences
      const preferences = await storage.getItem<UserPreferences>('sync:userPreferences');
      // Update fontSize and save (create defaults if missing so zoom works even without onboarding).
      const updatedPreferences: UserPreferences = {
        ...DEFAULT_USER_PREFERENCES,
        ...((preferences ?? {}) as Partial<UserPreferences>),
        fontSize,
      };
      await storage.setItem('sync:userPreferences', updatedPreferences);
      applyZoom(fontSize);
      await applyPreferencesToActiveTab(updatedPreferences);
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

  useEffect(() => {
    // Refresh summary/headings when the preferred language or URL changes.
    if (!currentUrl) return;
    requestPageSummary();
  }, [language, currentUrl]);

  useEffect(() => {
    // Default to the preferred language, but allow switching the page back to its original language.
    if (!currentUrl) return;
    applyPageLanguageModeToActiveTab(pageLanguageMode);
  }, [pageLanguageMode, language, currentUrl]);

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
      const response = await simplifyPage(url, 'easy_read', language, sessionId);

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
          bullets: [t('failed_summary')],
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
        bullets: [t('failed_summary')],
      });
    } finally {
      setIsLoading(false);
      console.log('[Sidepanel] generatePageSummary completed');
    }
  };

  const handleElementClick = async (elementData: any) => {
    const { text, tag, src, alt, figcaption } = elementData;

    // Images often have no textContent, so handle them separately.
    if (tag === 'img') {
      const imageUrl = typeof src === 'string' ? src.trim() : '';
      if (!imageUrl) return;

      const hintText = (alt || figcaption || '').trim();
      const userPrompt = t('describe_image');

      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: userPrompt,
        timestamp: new Date(),
      };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, updatedMessages);

      setIsLoading(true);
      setError('');
      try {
        const response = await sendImageCaption(imageUrl, {
          altText: hintText || undefined,
          language,
        });

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response.caption,
          timestamp: new Date(),
        };
        const finalMessages = [...updatedMessages, assistantMessage];
        setMessages(finalMessages);
        await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
        maybeAutoReadAssistantReply(assistantMessage);
      } catch (error) {
        console.error('[Sidepanel] Failed to caption image:', error);
        setError(error instanceof Error ? error.message : 'Failed to caption image');

        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: t('image_caption_error'),
          timestamp: new Date(),
        };
        const finalMessages = [...updatedMessages, errorMessage];
        setMessages(finalMessages);
        await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
        maybeAutoReadAssistantReply(errorMessage);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!text || text.trim().length === 0) {
      return;
    }

    // Add user message - focus on content, not HTML element type
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `${t('what_does_this_mean')} "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`,
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
      const response = await sendTextCompletion(conversationText, { temperature: 0.7, language });

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
      maybeAutoReadAssistantReply(assistantMessage);
    } catch (error) {
      console.error('[Sidepanel] Failed to get AI response:', error);
      setError(error instanceof Error ? error.message : 'Failed to get response');

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t('text_error'),
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, errorMessage];
      setMessages(finalMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
      maybeAutoReadAssistantReply(errorMessage);
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

  const openSettings = async () => {
    // Force opening in a real tab so the UI isn't clipped by Chrome's embedded options dialog.
    // (Chrome's embedded dialog can get covered by the side panel.)
    try {
      const url = browser.runtime.getURL('/options.html');
      await browser.tabs.create({ url });
    } catch (error) {
      console.warn('[Sidepanel] Failed to open settings in a tab, falling back:', error);
      try {
        await browser.runtime.openOptionsPage();
      } catch (fallbackError) {
        console.error('[Sidepanel] Failed to open options page:', fallbackError);
      }
    }
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
      const response = await sendTextCompletion(conversationText, { temperature: 0.7, language });

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
      maybeAutoReadAssistantReply(assistantMessage);
    } catch (error) {
      console.error('[Sidepanel] Failed to get AI response:', error);
      setError(error instanceof Error ? error.message : 'Failed to get response');

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t('text_error'),
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, errorMessage];
      setMessages(finalMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
      maybeAutoReadAssistantReply(errorMessage);
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

  const startSummarySpeech = () => {
    if (!tts.isSupported) return;
    const bullets = summary?.bullets ?? [];
    if (!bullets.length) return;
    const ok = tts.speak(bullets);
    if (ok) setTtsTarget({ kind: 'summary' });
  };

  const startHeadingsSpeech = () => {
    if (!tts.isSupported) return;
    if (!headings.length) return;
    const ok = tts.speak(headings.map((h) => h.text));
    if (ok) setTtsTarget({ kind: 'headings' });
  };

  const startChatMessageSpeech = (message: Message) => {
    if (!tts.isSupported) return;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) return;
    const ok = tts.speak(content);
    if (ok) setTtsTarget({ kind: 'chat', id: message.id });
  };

  const maybeAutoReadAssistantReply = (message: Message) => {
    if (!autoReadAssistantReplies) return;
    if (!tts.isSupported) return;
    if (activeTab !== 'chat') return;
    if (message.role !== 'assistant') return;
    if (tts.status !== 'idle') return; // Don't interrupt manual playback.
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) return;
    const ok = tts.speak(content);
    if (ok) setTtsTarget({ kind: 'chat', id: message.id });
  };

  const renderTopSpeakerControls = (kind: 'summary' | 'headings') => {
    const isActive = ttsTarget?.kind === kind && tts.status !== 'idle';
    const canStart =
      kind === 'summary'
        ? !!summary?.bullets?.length
        : headings.length > 0;

    const label = t('listen');

    const onStart =
      kind === 'summary'
        ? startSummarySpeech
        : startHeadingsSpeech;

    if (!tts.isSupported) {
      return (
        <button
          type="button"
          disabled
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-400 shadow-sm cursor-not-allowed"
          title="Text-to-speech is not supported"
          aria-label="Text-to-speech is not supported"
        >
          <SpeakerWaveIcon className="w-5 h-5" />
        </button>
      );
    }

    if (!isActive) {
      return (
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={label}
          aria-label={label}
        >
          <SpeakerWaveIcon className="w-5 h-5" />
        </button>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (tts.status === 'speaking' ? tts.pause() : tts.resume())}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          title={tts.status === 'speaking' ? t('pause') : t('play')}
          aria-label={tts.status === 'speaking' ? t('pause') : t('play')}
        >
          {tts.status === 'speaking' ? (
            <PauseIcon className="w-5 h-5" />
          ) : (
            <PlayIcon className="w-5 h-5" />
          )}
        </button>
        <button
          type="button"
          onClick={tts.stop}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          title={t('stop')}
          aria-label={t('stop')}
        >
          <StopIcon className="w-5 h-5" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Error Banner */}
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">⚠️ {t('error')}:</span>
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
            💡 {t('tab_summary')}
          </button>
          <button
            onClick={() => setActiveTab('headings')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'headings'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            📑 {t('tab_headings')}
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'chat'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            💬 {t('tab_chat')}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'summary' ? (
        /* Summary Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                <span className="text-4xl">💡</span>
                {t('in_short')}
              </h2>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  onClick={requestPageSummary}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  🔄 {t('refresh')}
                </button>
                {renderTopSpeakerControls('summary')}
              </div>
            </div>
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
                {t('loading_summary')}
              </p>
            )}
          </div>

          {/* Controls for Summary Tab */}
          <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
            {/* Backend Status */}
            <div className="mb-3 p-2 rounded-lg bg-gray-50 border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-600">{t('backend')}:</span>
                  {backendStatus === 'connected' && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      {t('connected')}
                    </span>
                  )}
                  {backendStatus === 'disconnected' && (
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      {t('disconnected')}
                    </span>
                  )}
                  {backendStatus === 'unknown' && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                      {t('testing')}
                    </span>
                  )}
                </div>
                <button
                  onClick={testBackendConnection}
                  className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                  title="Test backend connection"
                >
                  🔄 {t('test')}
                </button>
              </div>
            </div>

            {/* Zoom + Language + Settings */}
            <div className="mb-3 flex items-stretch gap-3">
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">{t('zoom')}</span>
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

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">{t('page_language')}</span>
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setPageLanguageMode('original')}
                      aria-pressed={pageLanguageMode === 'original'}
                      title={t('original')}
                      className={`flex-1 py-3 text-sm font-bold transition-colors ${
                        pageLanguageMode === 'original'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageLanguageMode('preferred')}
                      aria-pressed={pageLanguageMode === 'preferred'}
                      title={LANGUAGE_BADGE[language]}
                      className={`flex-1 py-3 text-sm font-bold transition-colors ${
                        pageLanguageMode === 'preferred'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {LANGUAGE_BADGE[language]}
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={openSettings}
                className="w-32 shrink-0 self-stretch flex flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors border border-gray-200 shadow-sm"
                title={t('settings')}
                aria-label={t('settings')}
              >
                <span className="text-4xl leading-none" aria-hidden="true">⚙️</span>
                <span className="text-sm font-semibold text-gray-700">{t('settings')}</span>
              </button>
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
                  {selectionMode ? t('selection_on') : t('selection_off')}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`w-12 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  magnifyingMode
                    ? 'bg-blue-100 hover:bg-blue-200 ring-2 ring-blue-400'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title={t('toggle_magnifier')}
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
            <div className="flex items-start justify-between mb-4 gap-3">
              <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                <span className="text-4xl">📑</span>
                {t('table_of_contents')}
              </h2>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  onClick={requestPageSummary}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  🔄 {t('refresh')}
                </button>
                {renderTopSpeakerControls('headings')}
              </div>
            </div>
            {headings.length === 0 ? (
              <div className="text-gray-500 text-lg">
                <p className="mb-2">{t('no_headings')}</p>
                <p className="text-base">{t('try_refresh')}</p>
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
            {/* Zoom + Language + Settings */}
            <div className="mb-3 flex items-stretch gap-3">
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">{t('zoom')}</span>
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

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">{t('page_language')}</span>
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setPageLanguageMode('original')}
                      aria-pressed={pageLanguageMode === 'original'}
                      title={t('original')}
                      className={`flex-1 py-3 text-sm font-bold transition-colors ${
                        pageLanguageMode === 'original'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageLanguageMode('preferred')}
                      aria-pressed={pageLanguageMode === 'preferred'}
                      title={LANGUAGE_BADGE[language]}
                      className={`flex-1 py-3 text-sm font-bold transition-colors ${
                        pageLanguageMode === 'preferred'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {LANGUAGE_BADGE[language]}
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={openSettings}
                className="w-32 shrink-0 self-stretch flex flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors border border-gray-200 shadow-sm"
                title={t('settings')}
                aria-label={t('settings')}
              >
                <span className="text-4xl leading-none" aria-hidden="true">⚙️</span>
                <span className="text-sm font-semibold text-gray-700">{t('settings')}</span>
              </button>
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
                  {selectionMode ? t('selection_on') : t('selection_off')}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`w-12 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  magnifyingMode
                    ? 'bg-blue-100 hover:bg-blue-200 ring-2 ring-blue-400'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title={t('toggle_magnifier')}
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
                <p className="text-base font-medium mb-1">{t('no_conversation')}</p>
                <p className="text-sm">{t('click_to_start')}</p>
              </div>
            ) : (
              <>
                {messages.map((message) => {
                 const isAssistant = message.role === 'assistant';
                  const isActive =
                    isAssistant
                    && ttsTarget?.kind === 'chat'
                    && ttsTarget.id === message.id
                    && tts.status !== 'idle';
                  const safeContent = typeof message.content === 'string' ? message.content : String((message as any)?.content ?? '');
                  const canSpeak = tts.isSupported && !!safeContent.trim();
                  const timeLabel = formatTimestamp((message as any)?.timestamp ?? message.timestamp);

                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-4 py-3 relative ${
                          message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-900 shadow-md border border-gray-200'
                        } ${isAssistant ? 'pr-12' : ''}`}
                      >
                        <p className="text-base leading-relaxed break-words">{message.content}</p>
                        <p
                          className={`text-xs mt-1 ${
                            message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                          }`}
                        >
                          {timeLabel}
                        </p>

                        {isAssistant && (
                          <div className="absolute top-2 right-2 flex flex-col items-center gap-2">
                            {!isActive ? (
                              <button
                                type="button"
                                onClick={() => startChatMessageSpeech(message)}
                                disabled={!canSpeak}
                                className="p-2 rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title={t('listen')}
                                aria-label={t('listen')}
                              >
                                <SpeakerWaveIcon className="w-5 h-5" />
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => (tts.status === 'speaking' ? tts.pause() : tts.resume())}
                                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                  title={tts.status === 'speaking' ? t('pause') : t('play')}
                                  aria-label={tts.status === 'speaking' ? t('pause') : t('play')}
                                >
                                  {tts.status === 'speaking' ? (
                                    <PauseIcon className="w-5 h-5" />
                                  ) : (
                                    <PlayIcon className="w-5 h-5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={tts.stop}
                                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                  title={t('stop')}
                                  aria-label={t('stop')}
                                >
                                  <StopIcon className="w-5 h-5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                placeholder={t('type_question')}
                disabled={isLoading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={isLoading || !inputText.trim()}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('send')}
              </button>
            </form>
          </div>

          {/* Controls for Chat Tab */}
          <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
            {/* Zoom + Language + Settings */}
            <div className="mb-3 flex items-stretch gap-3">
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">{t('zoom')}</span>
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

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">{t('page_language')}</span>
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setPageLanguageMode('original')}
                      aria-pressed={pageLanguageMode === 'original'}
                      title={t('original')}
                      className={`flex-1 py-3 text-sm font-bold transition-colors ${
                        pageLanguageMode === 'original'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageLanguageMode('preferred')}
                      aria-pressed={pageLanguageMode === 'preferred'}
                      title={LANGUAGE_BADGE[language]}
                      className={`flex-1 py-3 text-sm font-bold transition-colors ${
                        pageLanguageMode === 'preferred'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {LANGUAGE_BADGE[language]}
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={openSettings}
                className="w-32 shrink-0 self-stretch flex flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors border border-gray-200 shadow-sm"
                title={t('settings')}
                aria-label={t('settings')}
              >
                <span className="text-4xl leading-none" aria-hidden="true">⚙️</span>
                <span className="text-sm font-semibold text-gray-700">{t('settings')}</span>
              </button>
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
                  {selectionMode ? t('selection_on') : t('selection_off')}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`w-12 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  magnifyingMode
                    ? 'bg-blue-100 hover:bg-blue-200 ring-2 ring-blue-400'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title={t('toggle_magnifier')}
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

function SpeakerWaveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a4 4 0 010 7" />
      <path d="M18.5 5.5a8 8 0 010 13" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5v14l12-7-12-7z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}

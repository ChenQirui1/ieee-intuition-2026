import { useState, useEffect, useRef, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '@wxt-dev/storage';
import { simplifyPage, sendTextCompletion } from './api';
import {
  normalizeReadingPayload,
  type ReadingMode,
  type EasyReadOutput,
  type ChecklistGuide,
  type StepByStepGuide,
} from './normalizeReading';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const MOCK_CHECKLIST: ChecklistGuide = {
  goal: 'Complete the task on this page',
  requirements: [
    { id: 'req_1', item: 'Know what you are trying to do', details: 'Example: log in, sign up, pay, or apply.', required: true },
    { id: 'req_2', item: 'Have your details ready', details: 'Email/username, password, or any required information.', required: true },
    { id: 'req_3', item: 'Check for security hints', details: 'Look for https and the correct website name before entering passwords.' },
  ],
  documents: [],
  fees: [],
  deadlines: [],
  actions: [
    { id: 'act_1', item: 'Find the main action button (e.g., "Log in", "Continue", "Submit")' },
    { id: 'act_2', item: 'Fill only the required fields first' },
    { id: 'act_3', item: 'Review your inputs, then submit' },
  ],
  common_mistakes: [
    'Typing the password into the wrong field',
    'Missing a required checkbox (Terms/Consent)',
    'Clicking an ad or fake "Download" button',
  ],
};

const MOCK_STEP_BY_STEP: StepByStepGuide = {
  goal: 'Finish the task on this page',
  steps: [
    {
      id: 'step_1',
      title: 'Identify the main goal',
      what_to_do: 'Look for the page’s main button or form.',
      where_to_click: 'Top of the form area (main call-to-action button).',
      tips: ['If there are multiple buttons, choose the one that matches your goal.'],
    },
    {
      id: 'step_2',
      title: 'Fill the required fields',
      what_to_do: 'Enter the minimum required information first (usually marked with *).',
      where_to_click: 'Input fields inside the main form.',
      tips: ['If something fails, read the small red error text near the field.'],
    },
    {
      id: 'step_3',
      title: 'Submit and confirm',
      what_to_do: 'Click the submit button and check for a confirmation message.',
      where_to_click: 'The primary action button (e.g., "Log in", "Continue", "Submit").',
      tips: ['If it keeps loading, try refreshing once and repeating the step.'],
    },
  ],
  finish_check: ['You see a confirmation message, email, or a new page showing success.', 'You can find the next screen you expected (account/home/receipt).'],
};

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
  const [easyRead, setEasyRead] = useState<EasyReadOutput | null>(null);
  const [checklistGuide, setChecklistGuide] = useState<ChecklistGuide | null>(null);
  const [stepByStepGuide, setStepByStepGuide] = useState<StepByStepGuide | null>(null);
  const [hasChecklist, setHasChecklist] = useState<boolean | null>(null);
  const [hasSteps, setHasSteps] = useState<boolean | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [isSimplifying, setIsSimplifying] = useState(false);
  const [simplifyingMode, setSimplifyingMode] = useState<ReadingMode | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'chat' | 'headings'>('summary');
  const [readingMode, setReadingMode] = useState<ReadingMode>('easy_read');
  const [pageTitle, setPageTitle] = useState<string>('');
  const [pageParagraphs, setPageParagraphs] = useState<string[]>([]);
  const [pageInteractions, setPageInteractions] = useState<string[]>([]);
  const [actionAssistDismissed, setActionAssistDismissed] = useState(false);
  const [checklistDone, setChecklistDone] = useState<Record<string, boolean>>({});
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});
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
        setPageTitle(message.data?.title || '');
        setPageParagraphs(Array.isArray(message.data?.paragraphs) ? message.data.paragraphs : []);
        setPageInteractions(Array.isArray(message.data?.interactions) ? message.data.interactions : []);
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

  useEffect(() => {
    setReadingMode('easy_read');
    setActionAssistDismissed(false);
    setChecklistDone({});
    setStepsDone({});
    setEasyRead(null);
    setChecklistGuide(null);
    setStepByStepGuide(null);
    setHasChecklist(null);
    setHasSteps(null);
    setIsSimplifying(false);
    setSimplifyingMode(null);
    setPageParagraphs([]);
    setPageInteractions([]);
  }, [currentUrl]);

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

  const getUrlForSimplify = async (): Promise<string> => {
    if (currentUrl) return currentUrl;
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url;
    if (!url) throw new Error('No URL available');
    setCurrentUrl(url);
    return url;
  };

  const simplifyWithFallback = async (url: string, mode: ReadingMode | 'all' | 'intelligent') => {
    try {
      return await simplifyPage(url, mode, 'en', sessionId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const shouldRetry =
        mode !== 'intelligent' && (msg.includes('422') || msg.toLowerCase().includes('mode'));
      if (!shouldRetry) throw error;
      console.warn('[Sidepanel] simplifyPage failed; retrying with intelligent mode:', { mode, msg });
      return await simplifyPage(url, 'intelligent', 'en', sessionId);
    }
  };

  const parseModelJson = (raw: string): unknown => {
    const stripFences = (s: string) => s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const text = stripFences(raw).trim();

    try {
      return JSON.parse(text);
    } catch {}

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {}
    }

    return null;
  };

  const collectInteractionLabels = (): string[] => {
    const labels: string[] = [];
    for (const line of pageInteractions) {
      const matches = line.match(/"([^"]+)"/g);
      if (!matches) continue;
      for (const m of matches) {
        const v = m.replaceAll('"', '').trim();
        if (v) labels.push(v);
      }
    }
    return Array.from(new Set(labels));
  };

  const hasBannedGenericPhrases = (text: string): boolean => {
    const t = text.toLowerCase();
    return (
      t.includes('search the internet') ||
      t.includes('search online') ||
      t.includes('google') ||
      t.includes('look it up') ||
      t.includes('web search')
    );
  };

  const guideLooksUngrounded = (mode: ReadingMode, normalized: ReturnType<typeof normalizeReadingPayload>): boolean => {
    if (mode === 'easy_read') return false;

    const labels = collectInteractionLabels().map((s) => s.toLowerCase());
    const hasLabel = (s: string) => labels.some((l) => l && s.toLowerCase().includes(l));

    if (mode === 'checklist') {
      const guide = normalized.checklist;
      if (!guide) return true;

      const texts = [
        guide.goal,
        ...guide.requirements.flatMap((x) => [x.item, x.details || '']),
        ...guide.documents.flatMap((x) => [x.item, x.details || '']),
        ...guide.actions.flatMap((x) => [x.item, x.url || '']),
        ...guide.common_mistakes,
      ];

      if (texts.some(hasBannedGenericPhrases)) return true;

      // If we have interaction labels, at least some checklist items should reference them.
      if (labels.length >= 6) {
        const hits = texts.filter((s) => s && hasLabel(s)).length;
        if (hits === 0) return true;
      }

      return false;
    }

    const guide = normalized.stepByStep;
    if (!guide) return true;

    const texts = [
      guide.goal,
      ...guide.steps.flatMap((s) => [s.title, s.what_to_do, s.where_to_click, s.url || '', ...s.tips]),
      ...guide.finish_check,
    ];

    if (texts.some(hasBannedGenericPhrases)) return true;

    if (labels.length >= 6) {
      for (const step of guide.steps) {
        const where = step.where_to_click || '';
        const allowedUngrounded = where.toLowerCase().includes('not found on this page');
        if (!allowedUngrounded && !hasLabel(where)) return true;
      }
    }

    return false;
  };

  const generateGuideFromPageSnapshot = async (mode: 'checklist' | 'step_by_step') => {
    const snapshot = {
      title: pageTitle,
      url: currentUrl,
      headings: headings.slice(0, 40).map((h) => ({ text: h.text, level: h.level })),
      paragraphs: pageParagraphs.slice(0, 18),
      interactions: pageInteractions.slice(0, 80),
    };

    const schemaChecklist = {
      mode: 'checklist',
      goal: 'string',
      requirements: [{ item: 'string', details: 'string', required: true }],
      documents: [{ item: 'string', details: 'string' }],
      fees: [{ item: 'string', amount: 'string' }],
      deadlines: [{ item: 'string', date: 'string' }],
      actions: [{ item: 'string', url: 'string' }],
      common_mistakes: ['string'],
    };

    const schemaStepByStep = {
      mode: 'step_by_step',
      goal: 'string',
      steps: [
        {
          step: 1,
          title: 'string',
          what_to_do: 'string',
          where_to_click: 'string',
          url: null,
          tips: ['string'],
        },
      ],
      finish_check: ['string'],
    };

    const labels = collectInteractionLabels();
    const labelsHint = labels.slice(0, 30).map((l) => `"${l}"`).join(', ');

    const baseRules = [
      'Return ONLY valid JSON. No markdown. No extra keys.',
      'Use ONLY the PAGE_SNAPSHOT. Do not invent UI labels not present in INTERACTIONS.',
      'Do NOT suggest searching the internet / Google / web search.',
      labels.length
        ? `Whenever you mention where to click, quote exact labels from INTERACTIONS. Example labels: ${labelsHint}`
        : 'If there are no INTERACTIONS, keep the output minimal and say what is missing.',
    ].join('\n');

    const prompt =
      mode === 'checklist'
        ? [
            baseRules,
            '',
            'OUTPUT SCHEMA (produce an instance of this; do not output the schema itself):',
            JSON.stringify(schemaChecklist),
            '',
            'PAGE_SNAPSHOT:',
            JSON.stringify(snapshot),
          ].join('\n')
        : [
            baseRules,
            '',
            'OUTPUT SCHEMA (produce an instance of this; do not output the schema itself):',
            JSON.stringify(schemaStepByStep),
            '',
            'PAGE_SNAPSHOT:',
            JSON.stringify(snapshot),
          ].join('\n');

    // Try twice: first attempt, then a stricter reminder if still generic/ungrounded.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const extra =
        attempt === 0
          ? ''
          : '\n\nYour previous attempt was too generic. You MUST ground steps in INTERACTIONS labels and avoid any web-search advice.\n';
      const completion = await sendTextCompletion(prompt + extra, 0.2);
      const obj = parseModelJson(completion.response);
      if (!obj || typeof obj !== 'object') continue;

      const wrapped =
        mode === 'checklist'
          ? { outputs: { checklist: obj }, simplification_ids: {} }
          : { outputs: { step_by_step: obj }, simplification_ids: {} };

      const normalized = normalizeReadingPayload(wrapped);
      if (guideLooksUngrounded(mode, normalized)) continue;
      return normalized;
    }

    throw new Error('Could not generate a grounded guide from this page');
  };

  const runSimplify = async (mode: ReadingMode) => {
    if (isSimplifying) return;
    console.log('[Sidepanel] runSimplify:', { mode });
    setIsSimplifying(true);
    setSimplifyingMode(mode);
    setError('');

    try {
      const url = await getUrlForSimplify();
      console.log('[Sidepanel] Calling simplifyPage API with URL:', url);
      console.log('[Sidepanel] Session ID:', sessionId);

      if (mode === 'checklist' || mode === 'step_by_step') {
        const hasSnapshot = pageInteractions.length > 0 || pageParagraphs.length > 0 || headings.length > 0;
        if (hasSnapshot) {
          const normalized = await generateGuideFromPageSnapshot(mode);
          if (mode === 'checklist') {
            setChecklistGuide(normalized.checklist);
            setHasChecklist(!!normalized.checklist);
          } else {
            setStepByStepGuide(normalized.stepByStep);
            setHasSteps(!!normalized.stepByStep);
          }
          return;
        }
      }

      const response = await simplifyWithFallback(url, mode);
      const normalized = normalizeReadingPayload(response);

      const pageIdValue = normalized.pageId || response.page_id || '';
      if (pageIdValue) {
        setPageId(pageIdValue);
        await storage.setItem(`session:pageId:${url}`, pageIdValue);
      }

      const ids = normalized.simplificationIds;
      const pickedId =
        mode === 'easy_read'
          ? ids.easy_read || ids.intelligent
          : mode === 'checklist'
            ? ids.checklist || ids.intelligent
            : ids.step_by_step || ids.intelligent;
      if (pickedId) {
        setSimplificationId(pickedId);
        await storage.setItem(`session:simplificationId:${url}`, pickedId);
      }

      if (normalized.easyRead) {
        setEasyRead(normalized.easyRead);
      } else if (mode === 'easy_read') {
        setEasyRead({
          about: '',
          key_points: ['Summary not available. Please try again.'],
          glossary: [],
        });
      }

      if (normalized.checklist) {
        setChecklistGuide(normalized.checklist);
        setHasChecklist(true);
      } else if (mode === 'checklist') {
        setChecklistGuide(null);
        setHasChecklist(false);
      } else if (normalized.signals.hasChecklist !== null) {
        setHasChecklist(normalized.signals.hasChecklist);
        if (normalized.signals.hasChecklist === false) setChecklistGuide(null);
      }

      if (normalized.stepByStep) {
        setStepByStepGuide(normalized.stepByStep);
        setHasSteps(true);
      } else if (mode === 'step_by_step') {
        setStepByStepGuide(null);
        setHasSteps(false);
      } else if (normalized.signals.hasStepByStep !== null) {
        setHasSteps(normalized.signals.hasStepByStep);
        if (normalized.signals.hasStepByStep === false) setStepByStepGuide(null);
      }
    } catch (error) {
      console.error('[Sidepanel] Failed to generate guide:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate guide');
      if (mode === 'easy_read') {
        setEasyRead({
          about: '',
          key_points: ['Failed to load Easy Read. Make sure the backend server is running.'],
          glossary: [],
        });
      }
    } finally {
      setIsSimplifying(false);
      setSimplifyingMode(null);
      console.log('[Sidepanel] runSimplify completed:', { mode });
    }
  };

  const generatePageSummary = async (pageData: any) => {
    console.log('[Sidepanel] generatePageSummary called with pageData:', pageData);
    await runSimplify('easy_read');
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
    setIsChatLoading(true);
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
      setIsChatLoading(false);
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

  const handleSubmitMessage = async (e: FormEvent) => {
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
    setIsChatLoading(true);
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
      setIsChatLoading(false);
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

  const selectReadingMode = async (mode: ReadingMode) => {
    setReadingMode(mode);

    if (mode === 'checklist') {
      if (hasChecklist === false || checklistGuide) return;
      await runSimplify('checklist');
    }

    if (mode === 'step_by_step') {
      if (hasSteps === false || stepByStepGuide) return;
      await runSimplify('step_by_step');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Error Banner */}
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">Error:</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError('')}
              className="text-red-700 hover:text-red-900 font-bold"
            >
              X
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
            Summary
          </button>
          <button
            onClick={() => setActiveTab('headings')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'headings'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            Headings
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-sm ${
              activeTab === 'chat'
                ? 'bg-white text-blue-600'
                : 'text-white hover:bg-blue-500'
            }`}
          >
            Chat
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'summary' ? (
        /* Summary Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Simplified Reading</h2>
              <p className="text-sm text-gray-600 mt-1">Pick a format that is easiest to follow.</p>
            </div>

            <div className="mb-4">
              <div className="inline-flex w-full rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
                <button
                  onClick={() => void selectReadingMode('easy_read')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    readingMode === 'easy_read'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Easy Read
                </button>
                <button
                  onClick={() => void selectReadingMode('checklist')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    readingMode === 'checklist'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Checklist
                </button>
                <button
                  onClick={() => void selectReadingMode('step_by_step')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    readingMode === 'step_by_step'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Step-by-step
                </button>
              </div>
            </div>

            {!actionAssistDismissed &&
              readingMode === 'easy_read' &&
              /\b(login|log in|sign in|sign up|checkout|pay|apply|register|subscribe|password|account)\b/i.test(
                `${pageTitle} ${currentUrl}`
              ) && (
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-blue-900">Action Assist</p>
                      <p className="mt-1 text-sm text-blue-800">
                        This page looks like it might require decisions and actions. Want a checklist or step-by-step guide?
                      </p>
                    </div>
                    <button
                      onClick={() => setActionAssistDismissed(true)}
                      className="flex-none text-xs px-2 py-1 rounded bg-white/70 hover:bg-white border border-blue-200"
                    >
                      Not now
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        setActionAssistDismissed(true);
                        void selectReadingMode('checklist');
                      }}
                      className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Show Checklist
                    </button>
                    <button
                      onClick={() => {
                        setActionAssistDismissed(true);
                        void selectReadingMode('step_by_step');
                      }}
                      className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-white text-blue-700 border border-blue-200 hover:bg-blue-50 transition-colors"
                    >
                      Show Steps
                    </button>
                  </div>
                </div>
              )}

            {readingMode === 'easy_read' ? (
              <>
                {isSimplifying && simplifyingMode === 'easy_read' && !easyRead ? (
                  <div className="space-y-3">
                    <div className="h-4 bg-gray-300 rounded animate-pulse"></div>
                    <div className="h-4 bg-gray-300 rounded animate-pulse w-5/6"></div>
                    <div className="h-4 bg-gray-300 rounded animate-pulse w-4/6"></div>
                  </div>
                ) : easyRead ? (
                  <div className="space-y-4">
                    {easyRead.about ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Short Summary</p>
                        <p className="mt-2 text-sm leading-relaxed text-gray-700">{easyRead.about}</p>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Key Points</p>
                      <ul className="mt-3 space-y-2">
                        {(easyRead.key_points || []).map((bullet, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <span className="mt-2 w-2 h-2 rounded-full bg-blue-600 flex-none"></span>
                            <span className="text-sm leading-relaxed text-gray-700">{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {easyRead.warnings && easyRead.warnings.length > 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Warnings</p>
                        <ul className="mt-3 space-y-2">
                          {easyRead.warnings.slice(0, 6).map((w, idx) => (
                            <li key={idx} className="flex items-start gap-3">
                              <span className="mt-2 w-2 h-2 rounded-full bg-amber-500 flex-none"></span>
                              <span className="text-sm text-amber-900 leading-relaxed">{w}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {easyRead.important_links && easyRead.important_links.length > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Important Links</p>
                        <div className="mt-3 space-y-2">
                          {easyRead.important_links.slice(0, 6).map((l, idx) => (
                            <button
                              key={`${l.url}-${idx}`}
                              onClick={() => browser.tabs.create({ url: l.url })}
                              className="w-full text-left rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors"
                            >
                              <p className="text-sm font-medium text-gray-900">{l.label || l.url}</p>
                              <p className="mt-1 text-xs text-gray-500 break-all">{l.url}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {easyRead.glossary && easyRead.glossary.length > 0 ? (
                      <details className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">Glossary</span>
                          <span className="text-xs text-gray-500">{easyRead.glossary.length} terms</span>
                        </summary>
                        <div className="px-4 pb-4 divide-y divide-gray-100">
                          {easyRead.glossary.map((entry, idx) => (
                            <div key={`${entry.term}-${idx}`} className="py-3">
                              <p className="text-sm font-semibold text-gray-900">{entry.term}</p>
                              <p className="mt-1 text-sm text-gray-700 leading-relaxed">{entry.simple}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {easyRead.sections && easyRead.sections.length > 0 ? (
                      <details className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">More Details</span>
                          <span className="text-xs text-gray-500">{easyRead.sections.length} sections</span>
                        </summary>
                        <div className="px-4 pb-4 space-y-4">
                          {easyRead.sections.map((section, idx) => (
                            <div key={`${section.heading}-${idx}`} className="pt-2">
                              <p className="text-sm font-semibold text-gray-900">{section.heading}</p>
                              <ul className="mt-2 space-y-1">
                                {(section.bullets || []).slice(0, 8).map((b, bIdx) => (
                                  <li key={bIdx} className="flex items-start gap-2">
                                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-gray-400 flex-none"></span>
                                    <span className="text-sm text-gray-700 leading-relaxed">{b}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">Loading Easy Read...</p>
                )}
              </>
            ) : readingMode === 'checklist' ? (
              <div className="space-y-4">
                {!checklistGuide ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">Checklist</p>
                        <p className="mt-1 text-sm text-gray-600">
                          {hasChecklist === false
                            ? 'Checklist not available for this page.'
                            : 'Generate a checklist for this page.'}
                        </p>
                      </div>
                      <button
                        onClick={() => void runSimplify('checklist')}
                        disabled={isSimplifying}
                        className={`flex-none text-xs px-3 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          hasChecklist === false
                            ? 'bg-gray-100 hover:bg-gray-200'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {isSimplifying && simplifyingMode === 'checklist' ? 'Generating...' : hasChecklist === false ? 'Retry' : 'Generate'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">Checklist</p>
                          {checklistGuide.goal ? (
                            <p className="mt-1 text-sm text-gray-600">{checklistGuide.goal}</p>
                          ) : null}
                        </div>
                        <button
                          onClick={() => setChecklistDone({})}
                          className="flex-none text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    {checklistGuide.requirements.length > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Requirements</p>
                        <div className="mt-3 space-y-2">
                          {checklistGuide.requirements.map((req) => (
                            <label
                              key={req.id}
                              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={!!checklistDone[req.id]}
                                onChange={(e) =>
                                  setChecklistDone((prev) => ({ ...prev, [req.id]: e.target.checked }))
                                }
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-gray-900">{req.item}</p>
                                  {req.required ? (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                      Required
                                    </span>
                                  ) : null}
                                </div>
                                {req.details ? (
                                  <p className="mt-1 text-xs text-gray-600 leading-relaxed">{req.details}</p>
                                ) : null}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {checklistGuide.documents.length > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Documents</p>
                        <div className="mt-3 space-y-2">
                          {checklistGuide.documents.map((doc) => (
                            <label
                              key={doc.id}
                              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={!!checklistDone[doc.id]}
                                onChange={(e) =>
                                  setChecklistDone((prev) => ({ ...prev, [doc.id]: e.target.checked }))
                                }
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-gray-900">{doc.item}</p>
                                  {doc.required ? (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                      Required
                                    </span>
                                  ) : null}
                                </div>
                                {doc.details ? (
                                  <p className="mt-1 text-xs text-gray-600 leading-relaxed">{doc.details}</p>
                                ) : null}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {checklistGuide.fees.length > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Fees</p>
                        <ul className="mt-3 space-y-2">
                          {checklistGuide.fees.map((fee) => (
                            <li
                              key={fee.id}
                              className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3"
                            >
                              <span className="text-sm font-medium text-gray-900">{fee.item}</span>
                              {fee.amount ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                                  {fee.amount}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {checklistGuide.deadlines.length > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Deadlines</p>
                        <ul className="mt-3 space-y-2">
                          {checklistGuide.deadlines.map((d) => (
                            <li
                              key={d.id}
                              className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3"
                            >
                              <span className="text-sm font-medium text-gray-900">{d.item}</span>
                              {d.date ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                                  {d.date}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {checklistGuide.actions.length > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</p>
                        <div className="mt-3 space-y-2">
                          {checklistGuide.actions.map((act) => (
                            <label
                              key={act.id}
                              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={!!checklistDone[act.id]}
                                onChange={(e) =>
                                  setChecklistDone((prev) => ({ ...prev, [act.id]: e.target.checked }))
                                }
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">{act.item}</p>
                                {act.url ? (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      browser.tabs.create({ url: act.url });
                                    }}
                                    className="mt-2 text-xs text-blue-700 hover:underline"
                                  >
                                    Open link
                                  </button>
                                ) : null}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {checklistGuide.common_mistakes.length > 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Common Mistakes</p>
                        <ul className="mt-3 space-y-2">
                          {checklistGuide.common_mistakes.map((m, idx) => (
                            <li key={idx} className="flex items-start gap-3">
                              <span className="mt-2 w-2 h-2 rounded-full bg-amber-500 flex-none"></span>
                              <span className="text-sm text-amber-900 leading-relaxed">{m}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {!stepByStepGuide ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">Step-by-step Guide</p>
                        <p className="mt-1 text-sm text-gray-600">
                          {hasSteps === false
                            ? 'Step-by-step guide not available for this page.'
                            : 'Generate a step-by-step guide for this page.'}
                        </p>
                      </div>
                      <button
                        onClick={() => void runSimplify('step_by_step')}
                        disabled={isSimplifying}
                        className={`flex-none text-xs px-3 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          hasSteps === false
                            ? 'bg-gray-100 hover:bg-gray-200'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {isSimplifying && simplifyingMode === 'step_by_step' ? 'Generating...' : hasSteps === false ? 'Retry' : 'Generate'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">Step-by-step Guide</p>
                          {stepByStepGuide.goal ? (
                            <p className="mt-1 text-sm text-gray-600">{stepByStepGuide.goal}</p>
                          ) : null}
                        </div>
                        <button
                          onClick={() => setStepsDone({})}
                          className="flex-none text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="space-y-3">
                        {stepByStepGuide.steps.map((s, idx) => (
                          <div key={s.id} className="rounded-lg border border-gray-200 p-3">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4"
                                checked={!!stepsDone[s.id]}
                                onChange={(e) => setStepsDone((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900">
                                  {s.step ?? idx + 1}. {s.title}
                                </p>
                                {s.what_to_do ? (
                                  <p className="mt-1 text-sm text-gray-700 leading-relaxed">{s.what_to_do}</p>
                                ) : null}
                                {s.where_to_click ? (
                                  <p className="mt-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-700">Where to click:</span> {s.where_to_click}
                                  </p>
                                ) : null}
                                {s.url ? (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      browser.tabs.create({ url: s.url });
                                    }}
                                    className="mt-2 text-xs text-blue-700 hover:underline"
                                  >
                                    Open link
                                  </button>
                                ) : null}
                                {s.tips.length > 0 ? (
                                  <ul className="mt-2 space-y-1">
                                    {s.tips.slice(0, 3).map((t, tIdx) => (
                                      <li key={tIdx} className="text-xs text-gray-600 leading-relaxed">
                                        Tip: {t}
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {stepByStepGuide.finish_check.length > 0 ? (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold text-green-900 uppercase tracking-wide">Finish Check</p>
                        <ul className="mt-3 space-y-2">
                          {stepByStepGuide.finish_check.map((c, idx) => (
                            <li key={idx} className="flex items-start gap-3">
                              <span className="mt-2 w-2 h-2 rounded-full bg-green-500 flex-none"></span>
                              <span className="text-sm text-green-900 leading-relaxed">{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
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
                  Test
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
                  Settings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 1}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  -
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
                Table of Contents
              </h2>
              <button
                onClick={requestPageSummary}
                className="px-3 py-1 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Refresh
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
                      {heading.level === 1 ? '>' : heading.level === 2 ? '-' : '.'}
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
                  Settings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 1}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  -
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
                {isChatLoading && (
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
                disabled={isChatLoading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={isChatLoading || !inputText.trim()}
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
                  Settings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 1}
                  className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  -
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

import { useState, useEffect, useRef, type FormEvent } from "react";
import { browser } from "wxt/browser";
import { storage } from "@wxt-dev/storage";
import {
  normalizeReadingPayload,
  type ReadingMode,
  type EasyReadOutput,
  type ChecklistGuide,
  type StepByStepGuide,
} from "./normalizeReading";
import {
  simplifyPage,
  sendImageCaption,
  sendTextCompletion,
  type LanguageCode,
} from "./api";
import { useTts } from "./useTts";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const MOCK_CHECKLIST: ChecklistGuide = {
  goal: "Complete the task on this page",
  requirements: [
    {
      id: "req_1",
      item: "Know what you are trying to do",
      details: "Example: log in, sign up, pay, or apply.",
      required: true,
    },
    {
      id: "req_2",
      item: "Have your details ready",
      details: "Email/username, password, or any required information.",
      required: true,
    },
    {
      id: "req_3",
      item: "Check for security hints",
      details:
        "Look for https and the correct website name before entering passwords.",
    },
  ],
  documents: [],
  fees: [],
  deadlines: [],
  actions: [
    {
      id: "act_1",
      item: 'Find the main action button (e.g., "Log in", "Continue", "Submit")',
    },
    { id: "act_2", item: "Fill only the required fields first" },
    { id: "act_3", item: "Review your inputs, then submit" },
  ],
  common_mistakes: [
    "Typing the password into the wrong field",
    "Missing a required checkbox (Terms/Consent)",
    'Clicking an ad or fake "Download" button',
  ],
};

const MOCK_STEP_BY_STEP: StepByStepGuide = {
  goal: "Finish the task on this page",
  steps: [
    {
      id: "step_1",
      title: "Identify the main goal",
      what_to_do: "Look for the page’s main button or form.",
      where_to_click: "Top of the form area (main call-to-action button).",
      tips: [
        "If there are multiple buttons, choose the one that matches your goal.",
      ],
    },
    {
      id: "step_2",
      title: "Fill the required fields",
      what_to_do:
        "Enter the minimum required information first (usually marked with *).",
      where_to_click: "Input fields inside the main form.",
      tips: [
        "If something fails, read the small red error text near the field.",
      ],
    },
    {
      id: "step_3",
      title: "Submit and confirm",
      what_to_do:
        "Click the submit button and check for a confirmation message.",
      where_to_click:
        'The primary action button (e.g., "Log in", "Continue", "Submit").',
      tips: [
        "If it keeps loading, try refreshing once and repeating the step.",
      ],
    },
  ],
  finish_check: [
    "You see a confirmation message, email, or a new page showing success.",
    "You can find the next screen you expected (account/home/receipt).",
  ],
};
function coerceDate(value: unknown): Date {
  if (value instanceof Date) return value;

  const date = new Date(
    typeof value === "string" || typeof value === "number" ? value : Date.now(),
  );
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeStoredMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((m) => m && typeof m === "object")
    .map((m: any, idx: number) => ({
      id: typeof m.id === "string" && m.id ? m.id : `${Date.now()}_${idx}`,
      role: m.role === "user" ? "user" : "assistant",
      content:
        typeof m.content === "string" ? m.content : String(m.content ?? ""),
      timestamp: coerceDate(m.timestamp),
    }));
}

function formatTimestamp(value: unknown): string {
  const date = coerceDate(value);
  try {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function splitWhitespace(value: string): {
  leading: string;
  core: string;
  trailing: string;
} {
  const match = value.match(/^(\s*)(.*?)(\s*)$/s);
  return {
    leading: match?.[1] ?? "",
    core: match?.[2] ?? value,
    trailing: match?.[3] ?? "",
  };
}

interface Heading {
  text: string;
  level: number;
  index: number;
}

interface UserPreferences {
  language: LanguageCode;
  fontSize: "standard" | "large" | "extra-large";
  linkStyle: "default" | "underline" | "highlight" | "border";
  contrastMode: "standard" | "high-contrast-yellow";
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
    mode_easy_read: "Easy Read",
    mode_checklist: "Checklist",
    mode_step_by_step: "Step-by-step",
    header_short_summary: "Short Summary",
    header_key_points: "Key Points",
    header_warnings: "Warnings",
    header_important_links: "Important Links",
    header_glossary: "Glossary",
    header_more_details: "More Details",
    header_goal: "Goal",
    header_requirements: "Requirements",
    header_documents: "Documents",
    header_fees: "Fees",
    header_deadlines: "Deadlines",
    header_actions: "Actions",
    header_common_mistakes: "Common Mistakes",
    header_steps: "Steps",
    header_finish_check: "Finish Check",
    error: "Error",
    tab_summary: "Summary",
    tab_headings: "Navigation",
    tab_chat: "Chat",
    in_short: "In short...",
    table_of_contents: "Navigation",
    refresh: "Refresh",
    loading_summary: "Loading page summary...",
    failed_summary: "No summary available for this page.",
    no_headings: "No headings found on this page.",
    try_refresh: "Try clicking the Refresh button above.",
    no_conversation: "No conversation yet",
    click_to_start: "Click on text or images on the page to start",
    type_question: "Type your question...",
    send: "Send",
    backend: "Backend",
    connected: "Connected",
    disconnected: "Disconnected",
    testing: "Testing...",
    test: "Test",
    zoom: "Zoom",
    settings: "Settings",
    page_language: "Language",
    original: "Original",
    selection_on: "Selection ON",
    selection_off: "Selection OFF",
    magnify_on: "Magnify ON",
    magnify_off: "Magnify OFF",
    toggle_magnifier: "Toggle magnifying glass",
    listen: "Listen",
    pause: "Pause",
    play: "Play",
    stop: "Stop",
    describe_image: "Describe this image.",
    what_does_this_mean: "What does this mean:",
    image_caption_error: "No description available for this image.",
    text_error: "No information available. Please try again.",
  },
  zh: {
    mode_easy_read: "易读",
    mode_checklist: "清单",
    mode_step_by_step: "一步一步",
    header_short_summary: "简短摘要",
    header_key_points: "要点",
    header_warnings: "警告",
    header_important_links: "重要链接",
    header_glossary: "词汇表",
    header_more_details: "更多详情",
    header_goal: "目标",
    header_requirements: "要求",
    header_documents: "文件",
    header_fees: "费用",
    header_deadlines: "截止日期",
    header_actions: "行动",
    header_common_mistakes: "常见错误",
    header_steps: "步骤",
    header_finish_check: "完成检查",
    error: "错误",
    tab_summary: "摘要",
    tab_headings: "目录",
    tab_chat: "聊天",
    in_short: "简而言之...",
    table_of_contents: "目录",
    refresh: "刷新",
    loading_summary: "正在加载页面摘要...",
    failed_summary: "此页面无可用摘要。",
    no_headings: "此页面未找到标题。",
    try_refresh: "请点击上方的刷新按钮。",
    no_conversation: "还没有对话",
    click_to_start: "点击网页上的文字或图片开始",
    type_question: "请输入问题...",
    send: "发送",
    backend: "后端",
    connected: "已连接",
    disconnected: "未连接",
    testing: "测试中...",
    test: "测试",
    zoom: "缩放",
    settings: "设置",
    page_language: "语言",
    original: "原文",
    selection_on: "选择 开",
    selection_off: "选择 关",
    magnify_on: "放大 开",
    magnify_off: "放大 关",
    toggle_magnifier: "切换放大镜",
    listen: "朗读",
    pause: "暂停",
    play: "播放",
    stop: "停止",
    describe_image: "描述这张图片。",
    what_does_this_mean: "这是什么意思：",
    image_caption_error: "此图片无可用描述。",
    text_error: "无可用信息。请重试。",
  },
  ms: {
    mode_easy_read: "Mudah Baca",
    mode_checklist: "Senarai semak",
    mode_step_by_step: "Langkah demi langkah",
    header_short_summary: "Ringkasan Ringkas",
    header_key_points: "Perkara Utama",
    header_warnings: "Amaran",
    header_important_links: "Pautan Penting",
    header_glossary: "Glosari",
    header_more_details: "Lagi Butiran",
    header_goal: "Matlamat",
    header_requirements: "Keperluan",
    header_documents: "Dokumen",
    header_fees: "Yuran",
    header_deadlines: "Tarikh akhir",
    header_actions: "Tindakan",
    header_common_mistakes: "Kesilapan Biasa",
    header_steps: "Langkah",
    header_finish_check: "Selesai Semak",
    error: "Ralat",
    tab_summary: "Ringkasan",
    tab_headings: "Kandungan",
    tab_chat: "Sembang",
    in_short: "Ringkasnya...",
    table_of_contents: "Jadual Kandungan",
    refresh: "Muat semula",
    loading_summary: "Memuatkan ringkasan halaman...",
    failed_summary: "Tiada ringkasan tersedia untuk halaman ini.",
    no_headings: "Tiada tajuk ditemui pada halaman ini.",
    try_refresh: "Cuba tekan butang Muat semula di atas.",
    no_conversation: "Belum ada perbualan",
    click_to_start: "Klik teks atau imej pada laman untuk mula",
    type_question: "Taip soalan anda...",
    send: "Hantar",
    backend: "Pelayan",
    connected: "Disambungkan",
    disconnected: "Terputus",
    testing: "Menguji...",
    test: "Uji",
    zoom: "Zum",
    settings: "Tetapan",
    page_language: "Bahasa",
    original: "Asal",
    selection_on: "Pemilihan ON",
    selection_off: "Pemilihan OFF",
    magnify_on: "Pembesar ON",
    magnify_off: "Pembesar OFF",
    toggle_magnifier: "Togol pembesar",
    listen: "Dengar",
    pause: "Jeda",
    play: "Main",
    stop: "Henti",
    describe_image: "Terangkan imej ini.",
    what_does_this_mean: "Apa maksud ini:",
    image_caption_error: "Tiada penerangan tersedia untuk imej ini.",
    text_error: "Tiada maklumat tersedia. Sila cuba lagi.",
  },
  ta: {
    mode_easy_read: "எளிதாக படிக்கலாம்",
    mode_checklist: "சரிபார்ப்பு பட்டியல்",
    mode_step_by_step: "படி-படி",
    header_short_summary: "சுருக்கமான சுருக்கம்",
    header_key_points: "முக்கிய புள்ளிகள்",
    header_warnings: "எச்சரிக்கைகள்",
    header_important_links: "முக்கியமான இணைப்புகள்",
    header_glossary: "சொற்களஞ்சியம்",
    header_more_details: "மேலும் விவரங்கள்",
    header_goal: "இலக்கு",
    header_requirements: "தேவைகள்",
    header_documents: "ஆவணங்கள்",
    header_fees: "கட்டணம்",
    header_deadlines: "காலக்கெடு",
    header_actions: "செயல்கள்",
    header_common_mistakes: "பொதுவான தவறுகள்",
    header_steps: "படிகள்",
    header_finish_check: "சோதனையை முடிக்கவும்",
    error: "பிழை",
    tab_summary: "சுருக்கம்",
    tab_headings: "தலைப்புகள்",
    tab_chat: "அரட்டை",
    in_short: "சுருக்கமாக...",
    table_of_contents: "உள்ளடக்க பட்டியல்",
    refresh: "புதுப்பி",
    loading_summary: "பக்க சுருக்கம் ஏற்றப்படுகிறது...",
    failed_summary: "இந்த பக்கத்திற்கு சுருக்கம் கிடைக்கவில்லை.",
    no_headings: "இந்த பக்கத்தில் தலைப்புகள் இல்லை.",
    try_refresh: "மேலுள்ள புதுப்பி பொத்தானை அழுத்தி பார்க்கவும்.",
    no_conversation: "இன்னும் உரையாடல் இல்லை",
    click_to_start: "தொடங்க பக்கத்தில் உள்ள உரை அல்லது படத்தை கிளிக் செய்யவும்",
    type_question: "உங்கள் கேள்வியை உள்ளிடவும்...",
    send: "அனுப்பு",
    backend: "பின்தளம்",
    connected: "இணைந்தது",
    disconnected: "இணைக்கப்படவில்லை",
    testing: "சோதனை...",
    test: "சோதனை",
    zoom: "பெரிதாக்கம்",
    settings: "அமைப்புகள்",
    page_language: "மொழி",
    original: "மூலம்",
    selection_on: "தேர்வு இயக்கு",
    selection_off: "தேர்வு அணை",
    magnify_on: "பெரிதாக்கு இயக்கு",
    magnify_off: "பெரிதாக்கு அணை",
    toggle_magnifier: "பெரிதாக்கியை மாற்று",
    listen: "கேள்",
    pause: "இடைநிறுத்து",
    play: "இயக்கு",
    stop: "நிறுத்து",
    describe_image: "இந்த படத்தை விவரிக்கவும்.",
    what_does_this_mean: "இதன் பொருள் என்ன:",
    image_caption_error: "இந்த படத்திற்கு விளக்கம் கிடைக்கவில்லை.",
    text_error: "தகவல் கிடைக்கவில்லை. மீண்டும் முயற்சிக்கவும்.",
  },
};

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  language: "en",
  fontSize: "standard",
  linkStyle: "default",
  contrastMode: "standard",
  magnifyingZoomLevel: 2.5,
  hideAds: false,
  simplifyLanguage: false,
  showBreadcrumbs: false,
  ttsRate: 1,
  autoReadAssistant: false,
  profileName: "My Profile",
};

const LANGUAGE_BADGE: Record<LanguageCode, string> = {
  en: "EN",
  zh: "中文",
  ms: "MS",
  ta: "தமிழ்",
};

const TTS_LANG: Record<LanguageCode, string> = {
  en: "en-US",
  zh: "zh-CN",
  ms: "ms-MY",
  ta: "ta-IN",
};

const SUPPORTED_LANGUAGES: LanguageCode[] = ["en", "zh", "ms", "ta"];

const SUPPORTED_TTS_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function coerceTtsRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_USER_PREFERENCES.ttsRate;
  return SUPPORTED_TTS_RATES.includes(n as any)
    ? n
    : DEFAULT_USER_PREFERENCES.ttsRate;
}
const SelectionIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
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
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6.5" />
    <line x1="16.2" y1="16.2" x2="21.5" y2="21.5" />
  </svg>
);

const GearIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3.5" />
    <circle cx="12" cy="12" r="7.5" opacity="0.35" />
    <line x1="12" y1="2.5" x2="12" y2="4.9" />
    <line x1="12" y1="19.1" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="4.9" y2="12" />
    <line x1="19.1" y1="12" x2="21.5" y2="12" />
    <line x1="4.6" y1="4.6" x2="6.3" y2="6.3" />
    <line x1="17.7" y1="17.7" x2="19.4" y2="19.4" />
    <line x1="19.4" y1="4.6" x2="17.7" y2="6.3" />
    <line x1="6.3" y1="17.7" x2="4.6" y2="19.4" />
  </svg>
);

function App() {
  const [messagesRaw, setMessagesRaw] = useState<Message[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [easyReadRaw, setEasyReadRaw] = useState<EasyReadOutput | null>(null);
  const [easyRead, setEasyRead] = useState<EasyReadOutput | null>(null);
  const [checklistGuideRaw, setChecklistGuideRaw] =
    useState<ChecklistGuide | null>(null);
  const [checklistGuide, setChecklistGuide] = useState<ChecklistGuide | null>(
    null,
  );
  const [stepByStepGuideRaw, setStepByStepGuideRaw] =
    useState<StepByStepGuide | null>(null);
  const [stepByStepGuide, setStepByStepGuide] =
    useState<StepByStepGuide | null>(null);
  const [hasChecklist, setHasChecklist] = useState<boolean | null>(null);
  const [hasSteps, setHasSteps] = useState<boolean | null>(null);
  const [headingsRaw, setHeadingsRaw] = useState<Heading[]>([]);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [isSimplifying, setIsSimplifying] = useState(false);
  const [simplifyingMode, setSimplifyingMode] = useState<ReadingMode | null>(
    null,
  );
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "chat" | "headings">(
    "summary",
  );
  const [readingMode, setReadingMode] = useState<ReadingMode>("easy_read");
  const [pageTitle, setPageTitle] = useState<string>("");
  const [pageParagraphs, setPageParagraphs] = useState<string[]>([]);
  const [pageInteractions, setPageInteractions] = useState<string[]>([]);
  const [actionAssistDismissed, setActionAssistDismissed] = useState(false);
  const [checklistDone, setChecklistDone] = useState<Record<string, boolean>>(
    {},
  );
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});
  const [selectionMode, setSelectionMode] = useState(false);
  const [magnifyingMode, setMagnifyingMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [pageId, setPageId] = useState<string>("");
  const [simplificationId, setSimplificationId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [backendStatus, setBackendStatus] = useState<
    "unknown" | "connected" | "disconnected"
  >("unknown");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const tts = useTts();
  const [language, setLanguage] = useState<LanguageCode>(
    DEFAULT_USER_PREFERENCES.language,
  );
  const [pageLanguageMode, setPageLanguageMode] = useState<
    "preferred" | "original"
  >("preferred");

  const ui = UI_STRINGS[language] ?? UI_STRINGS.en;
  const t = (key: keyof typeof UI_STRINGS.en) => ui[key] ?? UI_STRINGS.en[key];

  const [ttsTarget, setTtsTarget] = useState<
    | { kind: "summary" }
    | { kind: "headings" }
    | { kind: "chat"; id: string }
    | null
  >(null);

  const [autoReadAssistantReplies, setAutoReadAssistantReplies] =
    useState<boolean>(DEFAULT_USER_PREFERENCES.autoReadAssistant);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const messageHandlersRef = useRef<{
    handleElementClick: (elementData: any) => Promise<void>;
    generatePageSummary: (pageData: any) => Promise<void>;
    translateTextsIfNeeded: (texts: string[]) => Promise<string[]>;
  }>({
    handleElementClick: async () => {},
    generatePageSummary: async () => {},
    translateTextsIfNeeded: async (texts) => texts,
  });
  const translationCacheRef = useRef<Record<LanguageCode, Map<string, string>>>(
    {
      en: new Map(),
      zh: new Map(),
      ms: new Map(),
      ta: new Map(),
    },
  );
  const localizedEasyReadRef = useRef<
    Record<LanguageCode, EasyReadOutput | null>
  >({
    en: null,
    zh: null,
    ms: null,
    ta: null,
  });
  const localizedChecklistRef = useRef<
    Record<LanguageCode, ChecklistGuide | null>
  >({
    en: null,
    zh: null,
    ms: null,
    ta: null,
  });
  const localizedStepByStepRef = useRef<
    Record<LanguageCode, StepByStepGuide | null>
  >({
    en: null,
    zh: null,
    ms: null,
    ta: null,
  });
  const localizedHeadingsRef = useRef<Record<LanguageCode, Heading[] | null>>({
    en: null,
    zh: null,
    ms: null,
    ta: null,
  });
  const localizedMessagesRef = useRef<Record<LanguageCode, Message[] | null>>({
    en: null,
    zh: null,
    ms: null,
    ta: null,
  });
  const activeLocalizationJobRef = useRef(0);

  useEffect(() => {
    if (tts.status === "idle") {
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
      let sid = await storage.getItem<string>("session:sessionId");
      if (!sid) {
        sid = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await storage.setItem("session:sessionId", sid);
      }
      setSessionId(sid);
    };
    initSession();

    // Test backend connection
    testBackendConnection();

    // Get current tab URL
    const getCurrentUrl = async () => {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const url = tabs[0]?.url;
        if (!url) return;
        setCurrentUrl((prev) => (prev === url ? prev : url));
      } catch (error) {
        console.error("[Sidepanel] Failed to get current URL:", error);
      }
    };
    getCurrentUrl();

    // Load user preferences for zoom
    loadPreferences();

    return () => {
      // no-op cleanup; message listeners are managed by a separate effect.
    };
  }, []);

  useEffect(() => {
    if (!currentUrl) return;
    setReadingMode("easy_read");
    setActionAssistDismissed(false);
    setChecklistDone({});
    setStepsDone({});
    setMessagesRaw([]);
    setMessages([]);
    setEasyReadRaw(null);
    setEasyRead(null);
    setChecklistGuideRaw(null);
    setChecklistGuide(null);
    setStepByStepGuideRaw(null);
    setStepByStepGuide(null);
    setHasChecklist(null);
    setHasSteps(null);
    setHeadingsRaw([]);
    setHeadings([]);
    setIsSimplifying(false);
    setSimplifyingMode(null);
    setPageTitle("");
    setPageParagraphs([]);
    setPageInteractions([]);
    setPageId("");
    setSimplificationId("");
    setError("");
    localizedEasyReadRef.current = { en: null, zh: null, ms: null, ta: null };
    localizedChecklistRef.current = { en: null, zh: null, ms: null, ta: null };
    localizedStepByStepRef.current = { en: null, zh: null, ms: null, ta: null };
    localizedHeadingsRef.current = { en: null, zh: null, ms: null, ta: null };
    localizedMessagesRef.current = { en: null, zh: null, ms: null, ta: null };

    let cancelled = false;
    void (async () => {
      try {
        const cachedPageId = await storage.getItem<string>(
          `session:pageId:${currentUrl}`,
        );
        const cachedSimplId = await storage.getItem<string>(
          `session:simplificationId:${currentUrl}`,
        );
        const savedMessages = await storage.getItem<Message[]>(
          `local:chatMessages:${currentUrl}`,
        );

        if (cancelled) return;

        if (cachedPageId) setPageId(cachedPageId);
        if (cachedSimplId) setSimplificationId(cachedSimplId);

        if (
          savedMessages &&
          Array.isArray(savedMessages) &&
          savedMessages.length > 0
        ) {
          const normalized = normalizeStoredMessages(savedMessages);
          setMessagesRaw(normalized);
          setMessages(normalized);
        }
      } catch (contextError) {
        console.warn(
          "[Sidepanel] Failed to load cached context:",
          contextError,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  useEffect(() => {
    const syncUrlFromActiveTab = async () => {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const url = tabs[0]?.url;
        if (!url) return;
        setCurrentUrl((prev) => (prev === url ? prev : url));
      } catch (error) {
        console.warn("[Sidepanel] Failed to sync URL from active tab:", error);
      }
    };

    const handleActivated = () => {
      void syncUrlFromActiveTab();
    };

    const handleUpdated = (_tabId: number, changeInfo: any, tab: any) => {
      // Only react to actual URL changes for the active tab; this avoids spamming during load.
      if (!tab?.active) return;
      if (!changeInfo?.url) return;
      void syncUrlFromActiveTab();
    };

    try {
      browser.tabs.onActivated.addListener(handleActivated as any);
      browser.tabs.onUpdated.addListener(handleUpdated as any);
    } catch (error) {
      console.warn("[Sidepanel] Failed to attach tab listeners:", error);
    }

    void syncUrlFromActiveTab();

    return () => {
      try {
        browser.tabs.onActivated.removeListener(handleActivated as any);
        browser.tabs.onUpdated.removeListener(handleUpdated as any);
      } catch {
        // ignore
      }
    };
  }, []);

  const loadPreferences = async () => {
    try {
      const preferences = await storage.getItem<UserPreferences>(
        "sync:userPreferences",
      );
      const preferredLanguage =
        preferences?.language ?? DEFAULT_USER_PREFERENCES.language;
      applyZoom(preferences?.fontSize ?? DEFAULT_USER_PREFERENCES.fontSize);
      tts.setRate(coerceTtsRate(preferences?.ttsRate));
      setAutoReadAssistantReplies(
        preferences?.autoReadAssistant ??
          DEFAULT_USER_PREFERENCES.autoReadAssistant,
      );
      setLanguage(preferredLanguage);
      await applyPageLanguageModeToActiveTab("preferred", preferredLanguage);

      // Watch for preference changes (even if preferences aren't set yet).
      storage.watch<UserPreferences>(
        "sync:userPreferences",
        (newPreferences) => {
          const nextLanguage =
            newPreferences?.language ?? DEFAULT_USER_PREFERENCES.language;
          applyZoom(
            newPreferences?.fontSize ?? DEFAULT_USER_PREFERENCES.fontSize,
          );
          tts.setRate(coerceTtsRate(newPreferences?.ttsRate));
          setAutoReadAssistantReplies(
            newPreferences?.autoReadAssistant ??
              DEFAULT_USER_PREFERENCES.autoReadAssistant,
          );
          setLanguage(nextLanguage);
        },
      );
    } catch (error) {
      console.error("[Sidepanel] Failed to load preferences:", error);
    } finally {
      setPreferencesLoaded(true);
    }
  };

  const applyZoom = (fontSize: "standard" | "large" | "extra-large") => {
    if (fontSize === "large") {
      setZoomLevel(1.25);
    } else if (fontSize === "extra-large") {
      setZoomLevel(1.5);
    } else {
      setZoomLevel(1);
    }
  };

  const applyPreferencesToActiveTab = async (preferences: UserPreferences) => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      await browser.tabs.sendMessage(tabId, {
        type: "APPLY_USER_PREFERENCES",
        preferences,
      });
    } catch {
      // Content script may not be ready (or not allowed on this page); storage watch still covers most cases.
    }
  };

  const applyPageLanguageModeToActiveTab = async (
    mode: "preferred" | "original",
    preferredLanguage: LanguageCode = language,
  ) => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      await browser.tabs.sendMessage(tabId, {
        type: "SET_PAGE_LANGUAGE_MODE",
        mode,
        language: preferredLanguage,
      });
    } catch (error) {
      console.warn("[Sidepanel] Failed to set page language mode:", error);
    }
  };

  const handleZoomChange = async (
    fontSize: "standard" | "large" | "extra-large",
  ) => {
    try {
      // Load current preferences
      const preferences = await storage.getItem<UserPreferences>(
        "sync:userPreferences",
      );
      // Update fontSize and save (create defaults if missing so zoom works even without onboarding).
      const updatedPreferences: UserPreferences = {
        ...DEFAULT_USER_PREFERENCES,
        ...((preferences ?? {}) as Partial<UserPreferences>),
        fontSize,
      };
      await storage.setItem("sync:userPreferences", updatedPreferences);
      applyZoom(fontSize);
      await applyPreferencesToActiveTab(updatedPreferences);
    } catch (error) {
      console.error("[Sidepanel] Failed to update zoom:", error);
    }
  };

  const handleZoomIn = () => {
    if (zoomLevel === 1) {
      handleZoomChange("large");
    } else if (zoomLevel === 1.25) {
      handleZoomChange("extra-large");
    }
  };

  const handleZoomOut = () => {
    if (zoomLevel === 1.5) {
      handleZoomChange("large");
    } else if (zoomLevel === 1.25) {
      handleZoomChange("standard");
    }
  };

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // Refresh summary/headings when the URL changes (or first loads).
    if (!preferencesLoaded || !currentUrl) return;
    requestPageSummary();
  }, [currentUrl, preferencesLoaded]);

  useEffect(() => {
    // Default to the preferred language, but allow switching the page back to its original language.
    if (!preferencesLoaded || !currentUrl) return;
    applyPageLanguageModeToActiveTab(pageLanguageMode, language);
  }, [pageLanguageMode, language, currentUrl, preferencesLoaded]);

  const requestPageSummary = async () => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tab = tabs[0];
      if (!tab?.id) return;

      // If the stored URL is stale, update it first so summary/chat keys stay in sync.
      const tabUrl = typeof tab.url === "string" ? tab.url : "";
      if (tabUrl && tabUrl !== currentUrl) {
        setCurrentUrl((prev) => (prev === tabUrl ? prev : tabUrl));
        return;
      }

      browser.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTENT" });
    } catch (error) {
      console.error("[Sidepanel] Failed to request page summary:", error);
    }
  };

  const translateTextsToLanguage = async (
    texts: string[],
    targetLanguage: LanguageCode,
  ): Promise<string[]> => {
    if (!texts.length || targetLanguage === "en") return texts;

    const cache = translationCacheRef.current[targetLanguage];
    const output = new Array<string>(texts.length).fill("");
    const missing = new Map<string, number[]>();

    for (let i = 0; i < texts.length; i += 1) {
      const original =
        typeof texts[i] === "string" ? texts[i] : String(texts[i] ?? "");
      const { leading, core, trailing } = splitWhitespace(original);
      const key = core.trim();
      if (!key) {
        output[i] = original;
        continue;
      }

      const cached = cache.get(key);
      if (typeof cached === "string" && cached.trim()) {
        output[i] = `${leading}${cached}${trailing}`;
        continue;
      }

      const indices = missing.get(key) ?? [];
      indices.push(i);
      missing.set(key, indices);
    }

    const missingKeys = Array.from(missing.keys());
    if (!missingKeys.length) {
      return output.map((v, idx) => v || texts[idx] || "");
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: "TRANSLATE_TEXTS",
        targetLanguage,
        texts: missingKeys,
      });

      if (response?.ok && Array.isArray(response.translations)) {
        for (let k = 0; k < missingKeys.length; k += 1) {
          const key = missingKeys[k];
          const candidate = response.translations[k];
          const translated =
            typeof candidate === "string" && candidate.trim() ? candidate : key;
          cache.set(key, translated);

          const indices = missing.get(key) ?? [];
          for (const idx of indices) {
            const original = texts[idx] ?? "";
            const { leading, trailing } = splitWhitespace(original);
            output[idx] = `${leading}${translated}${trailing}`;
          }
        }
      }
    } catch (error) {
      console.warn("[Sidepanel] Failed to translate texts:", error);
    }

    return output.map((v, idx) => v || texts[idx] || "");
  };

  const translateTextsIfNeeded = async (texts: string[]): Promise<string[]> =>
    translateTextsToLanguage(texts, language);

  const localizeEasyReadOutput = async (
    raw: EasyReadOutput,
    targetLanguage: LanguageCode,
  ): Promise<EasyReadOutput> => {
    if (targetLanguage === "en") return raw;

    const payload: string[] = [];
    payload.push(raw.about);
    payload.push(...(raw.key_points || []));
    payload.push(...(raw.glossary || []).flatMap((g) => [g.term, g.simple]));

    if (raw.sections) {
      for (const section of raw.sections) {
        payload.push(section.heading);
        payload.push(...(section.bullets || []));
      }
    }

    if (raw.important_links) {
      for (const link of raw.important_links) {
        payload.push(link.label);
      }
    }

    if (raw.warnings) {
      payload.push(...raw.warnings);
    }

    const translated = await translateTextsToLanguage(payload, targetLanguage);
    let cursor = 0;

    const about = translated[cursor++] ?? raw.about;
    const key_points = (raw.key_points || []).map(
      (item) => translated[cursor++] ?? item,
    );
    const glossary = (raw.glossary || []).map((g) => {
      const term = translated[cursor++] ?? g.term;
      const simple = translated[cursor++] ?? g.simple;
      return { term, simple };
    });

    const sections = raw.sections
      ? raw.sections.map((section) => {
          const heading = translated[cursor++] ?? section.heading;
          const bullets = (section.bullets || []).map(
            (b) => translated[cursor++] ?? b,
          );
          return { heading, bullets };
        })
      : undefined;

    const important_links = raw.important_links
      ? raw.important_links.map((link) => ({
          ...link,
          label: translated[cursor++] ?? link.label,
        }))
      : undefined;

    const warnings = raw.warnings
      ? raw.warnings.map((w) => translated[cursor++] ?? w)
      : undefined;

    return {
      ...raw,
      about,
      key_points,
      glossary,
      sections,
      important_links,
      warnings,
    };
  };

  const localizeChecklistGuide = async (
    raw: ChecklistGuide,
    targetLanguage: LanguageCode,
  ): Promise<ChecklistGuide> => {
    if (targetLanguage === "en") return raw;

    const payload: string[] = [];
    payload.push(raw.goal);

    const pushItemsWithDetails = (items: ChecklistGuide["requirements"]) => {
      for (const item of items) {
        payload.push(item.item);
        payload.push(item.details ?? "");
      }
    };
    pushItemsWithDetails(raw.requirements || []);
    pushItemsWithDetails(raw.documents || []);

    for (const fee of raw.fees || []) payload.push(fee.item);
    for (const deadline of raw.deadlines || []) payload.push(deadline.item);
    for (const action of raw.actions || []) payload.push(action.item);
    payload.push(...(raw.common_mistakes || []));

    const translated = await translateTextsToLanguage(payload, targetLanguage);
    let cursor = 0;

    const goal = translated[cursor++] ?? raw.goal;
    const mapItemsWithDetails = (items: ChecklistGuide["requirements"]) =>
      items.map((item) => {
        const nextItem = translated[cursor++] ?? item.item;
        const nextDetails = translated[cursor++] ?? item.details ?? "";
        return {
          ...item,
          item: nextItem,
          details: item.details ? nextDetails : undefined,
        };
      });

    const requirements = mapItemsWithDetails(raw.requirements || []);
    const documents = mapItemsWithDetails(raw.documents || []);
    const fees = (raw.fees || []).map((fee) => ({
      ...fee,
      item: translated[cursor++] ?? fee.item,
    }));
    const deadlines = (raw.deadlines || []).map((d) => ({
      ...d,
      item: translated[cursor++] ?? d.item,
    }));
    const actions = (raw.actions || []).map((a) => ({
      ...a,
      item: translated[cursor++] ?? a.item,
    }));
    const common_mistakes = (raw.common_mistakes || []).map(
      (m) => translated[cursor++] ?? m,
    );

    return {
      ...raw,
      goal,
      requirements,
      documents,
      fees,
      deadlines,
      actions,
      common_mistakes,
    };
  };

  const localizeStepByStepGuide = async (
    raw: StepByStepGuide,
    targetLanguage: LanguageCode,
  ): Promise<StepByStepGuide> => {
    if (targetLanguage === "en") return raw;

    const payload: string[] = [];
    payload.push(raw.goal);
    for (const step of raw.steps || []) {
      payload.push(step.title);
      payload.push(step.what_to_do);
      payload.push(step.where_to_click);
      payload.push(...(step.tips || []));
    }
    payload.push(...(raw.finish_check || []));

    const translated = await translateTextsToLanguage(payload, targetLanguage);
    let cursor = 0;

    const goal = translated[cursor++] ?? raw.goal;
    const steps = (raw.steps || []).map((step) => {
      const title = translated[cursor++] ?? step.title;
      const what_to_do = translated[cursor++] ?? step.what_to_do;
      const where_to_click = translated[cursor++] ?? step.where_to_click;
      const tips = (step.tips || []).map((t) => translated[cursor++] ?? t);
      return { ...step, title, what_to_do, where_to_click, tips };
    });
    const finish_check = (raw.finish_check || []).map(
      (f) => translated[cursor++] ?? f,
    );

    return { ...raw, goal, steps, finish_check };
  };

  const localizeHeadings = async (
    raw: Heading[],
    targetLanguage: LanguageCode,
  ): Promise<Heading[]> => {
    if (targetLanguage === "en" || raw.length === 0) return raw;
    const translated = await translateTextsToLanguage(
      raw.map((h) => h.text),
      targetLanguage,
    );
    return raw.map((h, idx) => ({ ...h, text: translated[idx] || h.text }));
  };

  const localizeMessages = async (
    raw: Message[],
    targetLanguage: LanguageCode,
  ): Promise<Message[]> => {
    if (targetLanguage === "en" || raw.length === 0) return raw;
    const translated = await translateTextsToLanguage(
      raw.map((m) => m.content),
      targetLanguage,
    );
    return raw.map((m, idx) => ({
      ...m,
      content: translated[idx] || m.content,
    }));
  };

  const isMessageListPrefix = (prefix: Message[], full: Message[]) => {
    if (prefix.length > full.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
      if (prefix[i]?.id !== full[i]?.id) return false;
    }
    return true;
  };

  const ensureLocalizedEasyRead = async (
    targetLanguage: LanguageCode,
  ): Promise<EasyReadOutput | null> => {
    if (!easyReadRaw) return null;
    localizedEasyReadRef.current.en = easyReadRaw;
    if (targetLanguage === "en") return easyReadRaw;
    const cached = localizedEasyReadRef.current[targetLanguage];
    if (cached) return cached;
    const localized = await localizeEasyReadOutput(easyReadRaw, targetLanguage);
    localizedEasyReadRef.current[targetLanguage] = localized;
    return localized;
  };

  const ensureLocalizedChecklist = async (
    targetLanguage: LanguageCode,
  ): Promise<ChecklistGuide | null> => {
    if (!checklistGuideRaw) return null;
    localizedChecklistRef.current.en = checklistGuideRaw;
    if (targetLanguage === "en") return checklistGuideRaw;
    const cached = localizedChecklistRef.current[targetLanguage];
    if (cached) return cached;
    const localized = await localizeChecklistGuide(
      checklistGuideRaw,
      targetLanguage,
    );
    localizedChecklistRef.current[targetLanguage] = localized;
    return localized;
  };

  const ensureLocalizedStepByStep = async (
    targetLanguage: LanguageCode,
  ): Promise<StepByStepGuide | null> => {
    if (!stepByStepGuideRaw) return null;
    localizedStepByStepRef.current.en = stepByStepGuideRaw;
    if (targetLanguage === "en") return stepByStepGuideRaw;
    const cached = localizedStepByStepRef.current[targetLanguage];
    if (cached) return cached;
    const localized = await localizeStepByStepGuide(
      stepByStepGuideRaw,
      targetLanguage,
    );
    localizedStepByStepRef.current[targetLanguage] = localized;
    return localized;
  };

  const ensureLocalizedHeadings = async (
    targetLanguage: LanguageCode,
  ): Promise<Heading[]> => {
    localizedHeadingsRef.current.en = headingsRaw;
    if (targetLanguage === "en") return headingsRaw;
    const cached = localizedHeadingsRef.current[targetLanguage];
    if (cached) return cached;
    const localized = await localizeHeadings(headingsRaw, targetLanguage);
    localizedHeadingsRef.current[targetLanguage] = localized;
    return localized;
  };

  const ensureLocalizedMessages = async (
    targetLanguage: LanguageCode,
  ): Promise<Message[]> => {
    localizedMessagesRef.current.en = messagesRaw;
    if (targetLanguage === "en") return messagesRaw;
    const cached = localizedMessagesRef.current[targetLanguage];
    const isFresh =
      Array.isArray(cached) &&
      cached.length === messagesRaw.length &&
      isMessageListPrefix(cached, messagesRaw);
    if (isFresh) return cached;
    const localized = await localizeMessages(messagesRaw, targetLanguage);
    localizedMessagesRef.current[targetLanguage] = localized;
    return localized;
  };

  const syncLocalizedContent = async (targetLanguage: LanguageCode) => {
    activeLocalizationJobRef.current += 1;
    const jobId = activeLocalizationJobRef.current;

    if (easyReadRaw) {
      const cached =
        targetLanguage === "en"
          ? easyReadRaw
          : localizedEasyReadRef.current[targetLanguage];
      setEasyRead(cached ?? easyReadRaw);
    } else {
      setEasyRead(null);
    }

    if (checklistGuideRaw) {
      const cached =
        targetLanguage === "en"
          ? checklistGuideRaw
          : localizedChecklistRef.current[targetLanguage];
      setChecklistGuide(cached ?? checklistGuideRaw);
    } else {
      setChecklistGuide(null);
    }

    if (stepByStepGuideRaw) {
      const cached =
        targetLanguage === "en"
          ? stepByStepGuideRaw
          : localizedStepByStepRef.current[targetLanguage];
      setStepByStepGuide(cached ?? stepByStepGuideRaw);
    } else {
      setStepByStepGuide(null);
    }

    if (headingsRaw.length) {
      const cached =
        targetLanguage === "en"
          ? headingsRaw
          : localizedHeadingsRef.current[targetLanguage];
      setHeadings(cached ?? headingsRaw);
    } else {
      setHeadings([]);
    }

    if (messagesRaw.length) {
      if (targetLanguage === "en") {
        setMessages(messagesRaw);
      } else {
        const cached = localizedMessagesRef.current[targetLanguage];
        if (Array.isArray(cached) && isMessageListPrefix(cached, messagesRaw)) {
          // Merge cached translations with any newly appended messages so replies never disappear.
          const merged =
            cached.length === messagesRaw.length
              ? cached
              : [...cached, ...messagesRaw.slice(cached.length)];
          setMessages(merged);
        } else {
          setMessages(messagesRaw);
        }
      }
    } else {
      setMessages([]);
    }

    if (targetLanguage === "en") return;

    const tasks: Promise<void>[] = [];
    if (easyReadRaw && !localizedEasyReadRef.current[targetLanguage]) {
      tasks.push(
        ensureLocalizedEasyRead(targetLanguage).then((localized) => {
          if (jobId !== activeLocalizationJobRef.current || !localized) return;
          setEasyRead(localized);
        }),
      );
    }
    if (checklistGuideRaw && !localizedChecklistRef.current[targetLanguage]) {
      tasks.push(
        ensureLocalizedChecklist(targetLanguage).then((localized) => {
          if (jobId !== activeLocalizationJobRef.current || !localized) return;
          setChecklistGuide(localized);
        }),
      );
    }
    if (stepByStepGuideRaw && !localizedStepByStepRef.current[targetLanguage]) {
      tasks.push(
        ensureLocalizedStepByStep(targetLanguage).then((localized) => {
          if (jobId !== activeLocalizationJobRef.current || !localized) return;
          setStepByStepGuide(localized);
        }),
      );
    }
    if (headingsRaw.length && !localizedHeadingsRef.current[targetLanguage]) {
      tasks.push(
        ensureLocalizedHeadings(targetLanguage).then((localized) => {
          if (jobId !== activeLocalizationJobRef.current) return;
          setHeadings(localized);
        }),
      );
    }
    const messageCacheFresh =
      Array.isArray(localizedMessagesRef.current[targetLanguage]) &&
      (localizedMessagesRef.current[targetLanguage] as Message[]).length ===
        messagesRaw.length &&
      isMessageListPrefix(
        localizedMessagesRef.current[targetLanguage] as Message[],
        messagesRaw,
      );

    if (messagesRaw.length && !messageCacheFresh) {
      tasks.push(
        ensureLocalizedMessages(targetLanguage).then((localized) => {
          if (jobId !== activeLocalizationJobRef.current) return;
          setMessages(localized);
        }),
      );
    }

    await Promise.all(tasks);
  };

  useEffect(() => {
    if (!preferencesLoaded) return;
    void syncLocalizedContent(language);
  }, [
    language,
    preferencesLoaded,
    easyReadRaw,
    checklistGuideRaw,
    stepByStepGuideRaw,
    headingsRaw,
    messagesRaw,
  ]);

  useEffect(() => {
    if (!easyReadRaw) return;
    localizedEasyReadRef.current = {
      en: easyReadRaw,
      zh: null,
      ms: null,
      ta: null,
    };
    void (async () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === "en") continue;
        if (localizedEasyReadRef.current[lang]) continue;
        await ensureLocalizedEasyRead(lang);
      }
    })();
  }, [easyReadRaw]);

  useEffect(() => {
    if (!checklistGuideRaw) return;
    localizedChecklistRef.current = {
      en: checklistGuideRaw,
      zh: null,
      ms: null,
      ta: null,
    };
    void (async () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === "en") continue;
        if (localizedChecklistRef.current[lang]) continue;
        await ensureLocalizedChecklist(lang);
      }
    })();
  }, [checklistGuideRaw]);

  useEffect(() => {
    if (!stepByStepGuideRaw) return;
    localizedStepByStepRef.current = {
      en: stepByStepGuideRaw,
      zh: null,
      ms: null,
      ta: null,
    };
    void (async () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === "en") continue;
        if (localizedStepByStepRef.current[lang]) continue;
        await ensureLocalizedStepByStep(lang);
      }
    })();
  }, [stepByStepGuideRaw]);

  useEffect(() => {
    localizedHeadingsRef.current = {
      en: headingsRaw,
      zh: null,
      ms: null,
      ta: null,
    };
    if (!headingsRaw.length) return;
    void (async () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === "en") continue;
        if (localizedHeadingsRef.current[lang]) continue;
        await ensureLocalizedHeadings(lang);
      }
    })();
  }, [headingsRaw]);

  useEffect(() => {
    localizedMessagesRef.current = {
      en: messagesRaw,
      zh: null,
      ms: null,
      ta: null,
    };
    if (!messagesRaw.length) return;
    void (async () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === "en") continue;
        if (localizedMessagesRef.current[lang]) continue;
        await ensureLocalizedMessages(lang);
      }
    })();
  }, [messagesRaw]);

  const getUrlForSimplify = async (): Promise<string> => {
    if (currentUrl) return currentUrl;
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = tabs[0]?.url;
    if (!url) throw new Error("No URL available");
    setCurrentUrl(url);
    return url;
  };

  const simplifyWithFallback = async (
    url: string,
    mode: ReadingMode | "all" | "intelligent",
  ) => {
    try {
      return await simplifyPage(url, mode, "en", sessionId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const shouldRetry =
        mode !== "intelligent" &&
        (msg.includes("422") || msg.toLowerCase().includes("mode"));
      if (!shouldRetry) throw error;
      console.warn(
        "[Sidepanel] simplifyPage failed; retrying with intelligent mode:",
        { mode, msg },
      );
      return await simplifyPage(url, "intelligent", "en", sessionId);
    }
  };

  const parseModelJson = (raw: string): unknown => {
    const stripFences = (s: string) =>
      s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const text = stripFences(raw).trim();

    try {
      return JSON.parse(text);
    } catch {}

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
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
        const v = m.replaceAll('"', "").trim();
        if (v) labels.push(v);
      }
    }
    return Array.from(new Set(labels));
  };

  const hasBannedGenericPhrases = (text: string): boolean => {
    const t = text.toLowerCase();
    return (
      t.includes("search the internet") ||
      t.includes("search online") ||
      t.includes("google") ||
      t.includes("look it up") ||
      t.includes("web search")
    );
  };

  const guideLooksUngrounded = (
    mode: ReadingMode,
    normalized: ReturnType<typeof normalizeReadingPayload>,
  ): boolean => {
    if (mode === "easy_read") return false;

    const labels = collectInteractionLabels().map((s) => s.toLowerCase());
    const hasLabel = (s: string) =>
      labels.some((l) => l && s.toLowerCase().includes(l));

    if (mode === "checklist") {
      const guide = normalized.checklist;
      if (!guide) return true;

      const texts = [
        guide.goal,
        ...guide.requirements.flatMap((x) => [x.item, x.details || ""]),
        ...guide.documents.flatMap((x) => [x.item, x.details || ""]),
        ...guide.actions.flatMap((x) => [x.item, x.url || ""]),
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
      ...guide.steps.flatMap((s) => [
        s.title,
        s.what_to_do,
        s.where_to_click,
        s.url || "",
        ...s.tips,
      ]),
      ...guide.finish_check,
    ];

    if (texts.some(hasBannedGenericPhrases)) return true;

    if (labels.length >= 6) {
      for (const step of guide.steps) {
        const where = step.where_to_click || "";
        const allowedUngrounded = where
          .toLowerCase()
          .includes("not found on this page");
        if (!allowedUngrounded && !hasLabel(where)) return true;
      }
    }

    return false;
  };

  const generateGuideFromPageSnapshot = async (
    mode: "checklist" | "step_by_step",
  ) => {
    const snapshot = {
      title: pageTitle,
      url: currentUrl,
      headings: headingsRaw
        .slice(0, 40)
        .map((h) => ({ text: h.text, level: h.level })),
      paragraphs: pageParagraphs.slice(0, 18),
      interactions: pageInteractions.slice(0, 80),
    };

    const schemaChecklist = {
      mode: "checklist",
      goal: "string",
      requirements: [{ item: "string", details: "string", required: true }],
      documents: [{ item: "string", details: "string" }],
      fees: [{ item: "string", amount: "string" }],
      deadlines: [{ item: "string", date: "string" }],
      actions: [{ item: "string", url: "string" }],
      common_mistakes: ["string"],
    };

    const schemaStepByStep = {
      mode: "step_by_step",
      goal: "string",
      steps: [
        {
          step: 1,
          title: "string",
          what_to_do: "string",
          where_to_click: "string",
          url: null,
          tips: ["string"],
        },
      ],
      finish_check: ["string"],
    };

    const labels = collectInteractionLabels();
    const labelsHint = labels
      .slice(0, 30)
      .map((l) => `"${l}"`)
      .join(", ");

    const baseRules = [
      "Return ONLY valid JSON. No markdown. No extra keys.",
      "Use ONLY the PAGE_SNAPSHOT. Do not invent UI labels not present in INTERACTIONS.",
      "Do NOT suggest searching the internet / Google / web search.",
      labels.length
        ? `Whenever you mention where to click, quote exact labels from INTERACTIONS. Example labels: ${labelsHint}`
        : "If there are no INTERACTIONS, keep the output minimal and say what is missing.",
    ].join("\n");

    const prompt =
      mode === "checklist"
        ? [
            baseRules,
            "",
            "OUTPUT SCHEMA (produce an instance of this; do not output the schema itself):",
            JSON.stringify(schemaChecklist),
            "",
            "PAGE_SNAPSHOT:",
            JSON.stringify(snapshot),
          ].join("\n")
        : [
            baseRules,
            "",
            "OUTPUT SCHEMA (produce an instance of this; do not output the schema itself):",
            JSON.stringify(schemaStepByStep),
            "",
            "PAGE_SNAPSHOT:",
            JSON.stringify(snapshot),
          ].join("\n");

    // Try twice: first attempt, then a stricter reminder if still generic/ungrounded.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const extra =
        attempt === 0
          ? ""
          : "\n\nYour previous attempt was too generic. You MUST ground steps in INTERACTIONS labels and avoid any web-search advice.\n";
      const completion = await sendTextCompletion(prompt + extra, {
        temperature: 0.2,
      });
      const obj = parseModelJson(completion.response);
      if (!obj || typeof obj !== "object") continue;

      const wrapped =
        mode === "checklist"
          ? { outputs: { checklist: obj }, simplification_ids: {} }
          : { outputs: { step_by_step: obj }, simplification_ids: {} };

      const normalized = normalizeReadingPayload(wrapped);
      if (guideLooksUngrounded(mode, normalized)) continue;
      return normalized;
    }

    throw new Error("Could not generate a grounded guide from this page");
  };

  const runSimplify = async (mode: ReadingMode) => {
    if (isSimplifying) return;
    console.log("[Sidepanel] runSimplify:", { mode });
    setIsSimplifying(true);
    setSimplifyingMode(mode);
    setError("");

    try {
      const url = await getUrlForSimplify();
      console.log("[Sidepanel] Calling simplifyPage API with URL:", url);
      console.log("[Sidepanel] Session ID:", sessionId);

      if (mode === "checklist" || mode === "step_by_step") {
        const hasSnapshot =
          pageInteractions.length > 0 ||
          pageParagraphs.length > 0 ||
          headingsRaw.length > 0;
        if (hasSnapshot) {
          const normalized = await generateGuideFromPageSnapshot(mode);
          if (mode === "checklist") {
            setChecklistGuideRaw(normalized.checklist);
            setChecklistGuide(normalized.checklist);
            setHasChecklist(!!normalized.checklist);
          } else {
            setStepByStepGuideRaw(normalized.stepByStep);
            setStepByStepGuide(normalized.stepByStep);
            setHasSteps(!!normalized.stepByStep);
          }
          return;
        }
      }

      const response = await simplifyWithFallback(url, mode);
      const normalized = normalizeReadingPayload(response);

      const pageIdValue = normalized.pageId || response.page_id || "";
      if (pageIdValue) {
        setPageId(pageIdValue);
        await storage.setItem(`session:pageId:${url}`, pageIdValue);
      }

      const ids = {
        easy_read:
          normalized.simplificationIds.easy_read ||
          response.simplification_ids?.easy_read,
        checklist:
          normalized.simplificationIds.checklist ||
          response.simplification_ids?.checklist,
        step_by_step:
          normalized.simplificationIds.step_by_step ||
          response.simplification_ids?.step_by_step,
        intelligent:
          normalized.simplificationIds.intelligent ||
          response.simplification_ids?.intelligent,
      };
      const pickedId =
        mode === "easy_read"
          ? ids.easy_read || ids.intelligent
          : mode === "checklist"
            ? ids.checklist || ids.intelligent
            : ids.step_by_step || ids.intelligent;
      if (pickedId) {
        setSimplificationId(pickedId);
        await storage.setItem(`session:simplificationId:${url}`, pickedId);
      }

      if (normalized.easyRead) {
        setEasyReadRaw(normalized.easyRead);
        setEasyRead(normalized.easyRead);
      } else if (mode === "easy_read") {
        const fallback: EasyReadOutput = {
          about: "",
          key_points: [t("failed_summary")],
          glossary: [],
        };
        setEasyReadRaw(fallback);
        setEasyRead(fallback);
      }

      if (normalized.checklist) {
        setChecklistGuideRaw(normalized.checklist);
        setChecklistGuide(normalized.checklist);
        setHasChecklist(true);
      } else if (mode === "checklist") {
        setChecklistGuideRaw(null);
        setChecklistGuide(null);
        setHasChecklist(false);
      } else if (normalized.signals.hasChecklist !== null) {
        setHasChecklist(normalized.signals.hasChecklist);
        if (normalized.signals.hasChecklist === false) {
          setChecklistGuideRaw(null);
          setChecklistGuide(null);
        }
      }

      if (normalized.stepByStep) {
        setStepByStepGuideRaw(normalized.stepByStep);
        setStepByStepGuide(normalized.stepByStep);
        setHasSteps(true);
      } else if (mode === "step_by_step") {
        setStepByStepGuideRaw(null);
        setStepByStepGuide(null);
        setHasSteps(false);
      } else if (normalized.signals.hasStepByStep !== null) {
        setHasSteps(normalized.signals.hasStepByStep);
        if (normalized.signals.hasStepByStep === false) {
          setStepByStepGuideRaw(null);
          setStepByStepGuide(null);
        }
      }
    } catch (error) {
      console.error("[Sidepanel] Failed to simplify:", error);
      console.error("[Sidepanel] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      setError(error instanceof Error ? error.message : "Failed to simplify");
      if (mode === "easy_read") {
        const fallback: EasyReadOutput = {
          about: "",
          key_points: [t("failed_summary")],
          glossary: [],
        };
        setEasyReadRaw(fallback);
        setEasyRead(fallback);
      } else if (mode === "checklist") {
        setChecklistGuideRaw(null);
        setChecklistGuide(null);
        setHasChecklist(false);
      } else if (mode === "step_by_step") {
        setStepByStepGuideRaw(null);
        setStepByStepGuide(null);
        setHasSteps(false);
      }
    } finally {
      setIsSimplifying(false);
      setSimplifyingMode(null);
      console.log("[Sidepanel] runSimplify completed:", { mode });
    }
  };

  const generatePageSummary = async (pageData: any) => {
    console.log(
      "[Sidepanel] generatePageSummary called with pageData:",
      pageData,
    );
    await runSimplify("easy_read");
  };

  const handleElementClick = async (elementData: any) => {
    const { text, tag, src, alt, figcaption } = elementData;

    // Images often have no textContent, so handle them separately.
    if (tag === "img") {
      const imageUrl = typeof src === "string" ? src.trim() : "";
      if (!imageUrl) return;

      const hintText = (alt || figcaption || "").trim();
      const userPrompt = t("describe_image");

      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: userPrompt,
        timestamp: new Date(),
      };
      const updatedMessages = [...messagesRaw, userMessage];
      setMessagesRaw(updatedMessages);
      setMessages(updatedMessages);
      await storage.setItem(
        `local:chatMessages:${currentUrl}`,
        updatedMessages,
      );

      setIsChatLoading(true);
      setError("");
      try {
        const response = await sendImageCaption(imageUrl, {
          altText: hintText || undefined,
          language,
        });
        const [localizedCaption] = await translateTextsIfNeeded([
          response.caption,
        ]);

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: localizedCaption || response.caption,
          timestamp: new Date(),
        };
        const finalMessages = [...updatedMessages, assistantMessage];
        setMessagesRaw(finalMessages);
        setMessages(finalMessages);
        await storage.setItem(
          `local:chatMessages:${currentUrl}`,
          finalMessages,
        );
        maybeAutoReadAssistantReply(assistantMessage);
      } catch (error) {
        console.error("[Sidepanel] Failed to caption image:", error);
        setError(
          error instanceof Error ? error.message : "Failed to caption image",
        );

        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: t("image_caption_error"),
          timestamp: new Date(),
        };
        const finalMessages = [...updatedMessages, errorMessage];
        setMessagesRaw(finalMessages);
        setMessages(finalMessages);
        await storage.setItem(
          `local:chatMessages:${currentUrl}`,
          finalMessages,
        );
        maybeAutoReadAssistantReply(errorMessage);
      } finally {
        setIsChatLoading(false);
      }
      return;
    }

    if (!text || text.trim().length === 0) {
      return;
    }

    // Add user message - focus on content, not HTML element type
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `${t("what_does_this_mean")} "${text.substring(0, 200)}${text.length > 200 ? "..." : ""}"`,
      timestamp: new Date(),
    };
    const updatedMessages = [...messagesRaw, userMessage];
    setMessagesRaw(updatedMessages);
    setMessages(updatedMessages);

    // Save to local storage
    await storage.setItem(`local:chatMessages:${currentUrl}`, updatedMessages);

    // Generate AI response
    setIsChatLoading(true);
    setError("");
    try {
      // Build conversation history as a single text string
      let conversationText =
        "You are a helpful assistant that explains things in very simple, easy-to-understand language. Use short sentences. Avoid jargon.\n\n";

      if (updatedMessages.length > 1) {
        conversationText += "Previous conversation:\n";
        // Include last 5 messages for context
        const recentMessages = updatedMessages.slice(-6, -1);
        for (const msg of recentMessages) {
          conversationText += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
        }
        conversationText += "\n";
      }

      conversationText += `Text to explain: "${text.substring(0, 500)}"\n\nWhat does this mean?`;

      // Call the text-completion API with conversation history
      const response = await sendTextCompletion(conversationText, {
        temperature: 0.7,
        language,
      });
      const [localizedReply] = await translateTextsIfNeeded([
        response.response,
      ]);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: localizedReply || response.response,
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessagesRaw(finalMessages);
      setMessages(finalMessages);

      // Save to local storage
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
      maybeAutoReadAssistantReply(assistantMessage);
    } catch (error) {
      console.error("[Sidepanel] Failed to get AI response:", error);
      setError(
        error instanceof Error ? error.message : "Failed to get response",
      );

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: t("text_error"),
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, errorMessage];
      setMessagesRaw(finalMessages);
      setMessages(finalMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
      maybeAutoReadAssistantReply(errorMessage);
    } finally {
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    messageHandlersRef.current = {
      handleElementClick,
      generatePageSummary,
      translateTextsIfNeeded,
    };
  }, [handleElementClick, generatePageSummary, translateTextsIfNeeded]);

  useEffect(() => {
    const handleMessage = (message: any, sender: any, sendResponse: any) => {
      console.log("[Sidepanel] Received message:", message);
      if (message.type === "CAPTURE_VISIBLE_TAB") {
        const windowId =
          sender?.tab?.windowId ?? browser.windows.WINDOW_ID_CURRENT;
        browser.tabs
          .captureVisibleTab(windowId, { format: "png" })
          .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
          .catch((error) => {
            console.error("[Sidepanel] captureVisibleTab failed:", error);
            sendResponse({ ok: false });
          });
        return true;
      }
      if (message.type === "ELEMENT_CLICKED") {
        if (message.openChat) {
          setActiveTab("chat");
        }
        void messageHandlersRef.current.handleElementClick(message.data);
      } else if (message.type === "MAGNIFYING_MODE_CHANGED") {
        setMagnifyingMode(message.enabled);
      } else if (message.type === "PAGE_LOADED") {
        const rawHeadings: Heading[] = Array.isArray(message.data?.headings)
          ? message.data.headings
          : [];
        console.log("[Sidepanel] Page loaded data:", message.data);
        console.log("[Sidepanel] Headings received:", rawHeadings);
        setPageTitle(
          typeof message.data?.title === "string" ? message.data.title : "",
        );
        setPageParagraphs(
          Array.isArray(message.data?.paragraphs)
            ? message.data.paragraphs
            : [],
        );
        setPageInteractions(
          Array.isArray(message.data?.interactions)
            ? message.data.interactions
            : [],
        );

        localizedHeadingsRef.current = {
          en: rawHeadings,
          zh: null,
          ms: null,
          ta: null,
        };
        setHeadingsRaw(rawHeadings);
        setHeadings(rawHeadings);

        void messageHandlersRef.current.generatePageSummary(message.data);
      }
      return false;
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const toggleSelectionMode = async () => {
    setSelectionMode(!selectionMode);
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: "TOGGLE_SELECTION_MODE",
          enabled: !selectionMode,
        });
      }
    } catch (error) {
      console.error("[Sidepanel] Failed to toggle selection mode:", error);
    }
  };

  const toggleMagnifyingMode = async () => {
    const nextEnabled = !magnifyingMode;
    setMagnifyingMode(nextEnabled);
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: "TOGGLE_MAGNIFYING_MODE",
          enabled: nextEnabled,
        });
      }
    } catch (error) {
      console.error("[Sidepanel] Failed to toggle magnifying mode:", error);
    }
  };

  const openSettings = async () => {
    // Force opening in a real tab so the UI isn't clipped by Chrome's embedded options dialog.
    // (Chrome's embedded dialog can get covered by the side panel.)
    try {
      const url = browser.runtime.getURL("/options.html");
      await browser.tabs.create({ url });
    } catch (error) {
      console.warn(
        "[Sidepanel] Failed to open settings in a tab, falling back:",
        error,
      );
      try {
        await browser.runtime.openOptionsPage();
      } catch (fallbackError) {
        console.error(
          "[Sidepanel] Failed to open options page:",
          fallbackError,
        );
      }
    }
  };

  const testBackendConnection = async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/openai-test", {
        method: "GET",
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      if (response.ok) {
        setBackendStatus("connected");
      } else {
        setBackendStatus("disconnected");
      }
    } catch (error) {
      console.error("[Sidepanel] Backend connection test failed:", error);
      setBackendStatus("disconnected");
    }
  };

  const handleSubmitMessage = async (e: FormEvent) => {
    e.preventDefault();

    const text = inputText.trim();
    if (!text) return;

    // Clear input
    setInputText("");

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    const updatedMessages = [...messagesRaw, userMessage];
    setMessagesRaw(updatedMessages);
    setMessages(updatedMessages);

    // Save to local storage
    await storage.setItem(`local:chatMessages:${currentUrl}`, updatedMessages);

    // Generate AI response
    setIsChatLoading(true);
    setError("");
    try {
      // Build conversation history as a single text string
      let conversationText =
        "You are a helpful assistant that explains things in very simple, easy-to-understand language. Use short sentences. Avoid jargon.\n\n";

      if (updatedMessages.length > 1) {
        conversationText += "Previous conversation:\n";
        // Include last 5 messages for context (to avoid too long prompts)
        const recentMessages = updatedMessages.slice(-6, -1);
        for (const msg of recentMessages) {
          conversationText += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
        }
        conversationText += "\n";
      }

      conversationText += `Current question: ${text}`;

      // Call the text-completion API with conversation history
      const response = await sendTextCompletion(conversationText, {
        temperature: 0.7,
        language,
      });
      const [localizedReply] = await translateTextsIfNeeded([
        response.response,
      ]);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: localizedReply || response.response,
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessagesRaw(finalMessages);
      setMessages(finalMessages);

      // Save to local storage
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
      maybeAutoReadAssistantReply(assistantMessage);
    } catch (error) {
      console.error("[Sidepanel] Failed to get AI response:", error);
      setError(
        error instanceof Error ? error.message : "Failed to get response",
      );

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: t("text_error"),
        timestamp: new Date(),
      };
      const finalMessages = [...updatedMessages, errorMessage];
      setMessagesRaw(finalMessages);
      setMessages(finalMessages);
      await storage.setItem(`local:chatMessages:${currentUrl}`, finalMessages);
      maybeAutoReadAssistantReply(errorMessage);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleHeadingClick = async (heading: Heading) => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: "SCROLL_TO_HEADING",
          index: heading.index,
        });
      }
    } catch (error) {
      console.error("[Sidepanel] Failed to scroll to heading:", error);
    }
  };

  const selectReadingMode = async (mode: ReadingMode) => {
    setReadingMode(mode);

    if (mode === "checklist") {
      if (hasChecklist === false || checklistGuide) return;
      await runSimplify("checklist");
    }

    if (mode === "step_by_step") {
      if (hasSteps === false || stepByStepGuide) return;
      await runSimplify("step_by_step");
    }
  };

  const startSummarySpeech = () => {
    if (!tts.isSupported) return;

    const collectEasyReadSpeech = (value: EasyReadOutput): string[] => {
      const out: string[] = [];
      if (value.about) {
        out.push(t("header_short_summary"));
        out.push(value.about);
      }
      if (value.key_points?.length) {
        out.push(t("header_key_points"));
        out.push(...value.key_points);
      }
      if (value.warnings?.length) {
        out.push(t("header_warnings"));
        out.push(...value.warnings);
      }
      if (value.important_links?.length) {
        out.push(t("header_important_links"));
        out.push(
          ...value.important_links
            .map((l) => (l.label || l.url || "").trim())
            .filter(Boolean),
        );
      }
      if (value.glossary?.length) {
        out.push(t("header_glossary"));
        out.push(
          ...value.glossary
            .map((g) => `${g.term}`.trim() && `${g.term}. ${g.simple}`.trim())
            .filter(Boolean),
        );
      }
      if (value.sections?.length) {
        out.push(t("header_more_details"));
        for (const section of value.sections) {
          if (section.heading) out.push(section.heading);
          if (section.bullets?.length) out.push(...section.bullets);
        }
      }
      return out.map((s) => s.trim()).filter(Boolean);
    };

    const collectChecklistSpeech = (value: ChecklistGuide): string[] => {
      const out: string[] = [];
      out.push(t("mode_checklist"));
      if (value.goal) {
        out.push(t("header_goal"));
        out.push(value.goal);
      }

      const pushItems = (items: Array<{ item: string; details?: string }>) => {
        for (const it of items) {
          if (it.item) out.push(it.item);
          if (it.details) out.push(it.details);
        }
      };

      if (value.requirements?.length) {
        out.push(t("header_requirements"));
        pushItems(value.requirements);
      }
      if (value.documents?.length) {
        out.push(t("header_documents"));
        pushItems(value.documents);
      }

      if (value.fees?.length) {
        out.push(t("header_fees"));
        for (const fee of value.fees) {
          const line = fee.amount ? `${fee.item}. ${fee.amount}` : fee.item;
          if (line) out.push(line);
        }
      }

      if (value.deadlines?.length) {
        out.push(t("header_deadlines"));
        for (const d of value.deadlines) {
          const line = d.date ? `${d.item}. ${d.date}` : d.item;
          if (line) out.push(line);
        }
      }

      if (value.actions?.length) {
        out.push(t("header_actions"));
        for (const act of value.actions) {
          if (act.item) out.push(act.item);
        }
      }

      if (value.common_mistakes?.length) {
        out.push(t("header_common_mistakes"));
        out.push(...value.common_mistakes);
      }

      return out.map((s) => s.trim()).filter(Boolean);
    };

    const collectStepByStepSpeech = (value: StepByStepGuide): string[] => {
      const out: string[] = [];
      out.push(t("mode_step_by_step"));
      if (value.goal) {
        out.push(t("header_goal"));
        out.push(value.goal);
      }

      if (value.steps?.length) out.push(t("header_steps"));
      for (let idx = 0; idx < (value.steps ?? []).length; idx += 1) {
        const s = value.steps[idx];
        const stepNum = s.step ?? idx + 1;
        const title = s.title ? `${stepNum}. ${s.title}` : `${stepNum}.`;
        if (title) out.push(title);
        if (s.what_to_do) out.push(s.what_to_do);
        if (s.where_to_click) out.push(s.where_to_click);
        if (s.tips?.length) out.push(...s.tips);
      }

      if (value.finish_check?.length) {
        out.push(t("header_finish_check"));
        out.push(...value.finish_check);
      }

      return out.map((s) => s.trim()).filter(Boolean);
    };

    let toSpeak: string[] = [];
    if (readingMode === "easy_read" && easyRead) {
      toSpeak = collectEasyReadSpeech(easyRead);
    } else if (readingMode === "checklist" && checklistGuide) {
      toSpeak = collectChecklistSpeech(checklistGuide);
    } else if (readingMode === "step_by_step" && stepByStepGuide) {
      toSpeak = collectStepByStepSpeech(stepByStepGuide);
    }

    if (!toSpeak.length) return;

    const ok = tts.speak(toSpeak, { lang: TTS_LANG[language] });
    if (ok) setTtsTarget({ kind: "summary" });
  };

  const startHeadingsSpeech = () => {
    if (!tts.isSupported) return;
    if (!headings.length) return;
    const ok = tts.speak(
      headings.map((h) => h.text),
      { lang: TTS_LANG[language] },
    );
    if (ok) setTtsTarget({ kind: "headings" });
  };

  const startChatMessageSpeech = (message: Message) => {
    if (!tts.isSupported) return;
    const content =
      typeof message.content === "string" ? message.content.trim() : "";
    if (!content) return;
    const ok = tts.speak(content, { lang: TTS_LANG[language] });
    if (ok) setTtsTarget({ kind: "chat", id: message.id });
  };

  const maybeAutoReadAssistantReply = (message: Message) => {
    if (!autoReadAssistantReplies) return;
    if (!tts.isSupported) return;
    if (activeTab !== "chat") return;
    if (message.role !== "assistant") return;
    if (tts.status !== "idle") return; // Don't interrupt manual playback.
    const content =
      typeof message.content === "string" ? message.content.trim() : "";
    if (!content) return;
    const ok = tts.speak(content, { lang: TTS_LANG[language] });
    if (ok) setTtsTarget({ kind: "chat", id: message.id });
  };

  const renderTopSpeakerControls = (kind: "summary" | "headings") => {
    const isActive = ttsTarget?.kind === kind && tts.status !== "idle";
    const canStart =
      kind === "summary"
        ? readingMode === "easy_read"
          ? !!easyRead
          : readingMode === "checklist"
            ? !!checklistGuide
            : readingMode === "step_by_step"
              ? !!stepByStepGuide
              : false
        : headings.length > 0;

    const label = t("listen");

    const onStart =
      kind === "summary" ? startSummarySpeech : startHeadingsSpeech;

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
          onClick={() =>
            tts.status === "speaking" ? tts.pause() : tts.resume()
          }
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          title={tts.status === "speaking" ? t("pause") : t("play")}
          aria-label={tts.status === "speaking" ? t("pause") : t("play")}
        >
          {tts.status === "speaking" ? (
            <PauseIcon className="w-5 h-5" />
          ) : (
            <PlayIcon className="w-5 h-5" />
          )}
        </button>
        <button
          type="button"
          onClick={tts.stop}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          title={t("stop")}
          aria-label={t("stop")}
        >
          <StopIcon className="w-5 h-5" />
        </button>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col h-screen bg-yellow-50"
      style={{ fontFamily: "Lexend, sans-serif", fontSize: "16px" }}
    >
      {/* Header with Tabs */}
      <div className="bg-black text-yellow-400 shadow-lg relative group border-b-4 border-yellow-400">
        {/* Hidden Dev Icon - appears on hover */}
        <button
          onClick={() => setShowDevPanel(!showDevPanel)}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded bg-yellow-400 text-black text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-yellow-300 border-2 border-black"
          title="Developer Tools"
        >
          🔧
        </button>

        <div className="flex border-b-2 border-yellow-400">
          <button
            onClick={() => setActiveTab("summary")}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-base border-r-2 border-yellow-400 ${
              activeTab === "summary"
                ? "bg-yellow-400 text-black"
                : "text-yellow-400 hover:bg-yellow-900"
            }`}
          >
            <span className="text-2xl">📄</span> {t("tab_summary")}
          </button>
          <button
            onClick={() => setActiveTab("headings")}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-base border-r-2 border-yellow-400 ${
              activeTab === "headings"
                ? "bg-yellow-400 text-black"
                : "text-yellow-400 hover:bg-yellow-900"
            }`}
          >
            <span className="text-2xl">📋</span> {t("tab_headings")}
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex-1 px-4 py-4 font-semibold transition-colors text-base ${
              activeTab === "chat"
                ? "bg-yellow-400 text-black"
                : "text-yellow-400 hover:bg-yellow-900"
            }`}
          >
            <span className="text-2xl">💭</span> {t("tab_chat")}
          </button>
        </div>
      </div>

      {/* Dev Panel - Hidden by default */}
      {showDevPanel && (
        <div className="bg-black text-yellow-400 p-4 border-b-4 border-yellow-400">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold flex items-center gap-2">
              🔧 Developer Tools
            </h3>
            <button
              onClick={() => setShowDevPanel(false)}
              className="text-yellow-400 hover:text-yellow-300 text-lg"
              title="Close"
            >
              ×
            </button>
          </div>

          {/* Backend Status */}
          <div className="p-3 rounded-lg bg-yellow-400 border-2 border-black">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-black">
                  Backend:
                </span>
                {backendStatus === "connected" && (
                  <span className="text-base text-black flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-600 rounded-full"></span>
                    Connected
                  </span>
                )}
                {backendStatus === "disconnected" && (
                  <span className="text-base text-black flex items-center gap-1">
                    <span className="w-2 h-2 bg-red-600 rounded-full"></span>
                    Disconnected
                  </span>
                )}
                {backendStatus === "unknown" && (
                  <span className="text-base text-black flex items-center gap-1">
                    <span className="w-2 h-2 bg-gray-600 rounded-full"></span>
                    Testing...
                  </span>
                )}
              </div>
              <button
                onClick={testBackendConnection}
                className="px-3 py-1 text-base bg-black hover:bg-gray-800 text-yellow-400 rounded transition-colors border-2 border-black"
                title="Test backend connection"
              >
                <span className="text-xl">↻</span> Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "summary" ? (
        /* Summary Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6 bg-yellow-50">
            <div className="mb-4">
              <div className="inline-flex w-full rounded-xl border-2 border-black bg-yellow-100 p-1 shadow-sm">
                <button
                  onClick={() => void selectReadingMode("easy_read")}
                  className={`flex-1 px-3 py-2 rounded-lg text-base font-semibold transition-colors border-2 ${
                    readingMode === "easy_read"
                      ? "bg-black text-yellow-400 border-black"
                      : "text-black hover:bg-yellow-200 border-transparent"
                  }`}
                >
                  {t("mode_easy_read")}
                </button>
                <button
                  onClick={() => void selectReadingMode("checklist")}
                  className={`flex-1 px-3 py-2 rounded-lg text-base font-semibold transition-colors border-2 ${
                    readingMode === "checklist"
                      ? "bg-black text-yellow-400 border-black"
                      : "text-black hover:bg-yellow-200 border-transparent"
                  }`}
                >
                  {t("mode_checklist")}
                </button>
                <button
                  onClick={() => void selectReadingMode("step_by_step")}
                  className={`flex-1 px-3 py-2 rounded-lg text-base font-semibold transition-colors border-2 ${
                    readingMode === "step_by_step"
                      ? "bg-black text-yellow-400 border-black"
                      : "text-black hover:bg-yellow-200 border-transparent"
                  }`}
                >
                  {t("mode_step_by_step")}
                </button>
              </div>
            </div>

            {!actionAssistDismissed &&
              readingMode === "easy_read" &&
              /\b(login|log in|sign in|sign up|checkout|pay|apply|register|subscribe|password|account)\b/i.test(
                `${pageTitle} ${currentUrl}`,
              ) && (
                <div className="mb-4 rounded-xl border-2 border-black bg-yellow-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-black">
                        Action Assist
                      </p>
                      <p className="mt-1 text-base text-black">
                        This page looks like it might require decisions and
                        actions. Want a checklist or step-by-step guide?
                      </p>
                    </div>
                    <button
                      onClick={() => setActionAssistDismissed(true)}
                      className="flex-none text-base px-2 py-1 rounded bg-yellow-400 hover:bg-yellow-300 border-2 border-black"
                    >
                      Not now
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        setActionAssistDismissed(true);
                        void selectReadingMode("checklist");
                      }}
                      className="flex-1 px-3 py-2 text-base font-semibold rounded-lg bg-black text-yellow-400 hover:bg-gray-800 transition-colors border-2 border-black"
                    >
                      Show Checklist
                    </button>
                    <button
                      onClick={() => {
                        setActionAssistDismissed(true);
                        void selectReadingMode("step_by_step");
                      }}
                      className="flex-1 px-3 py-2 text-base font-semibold rounded-lg bg-yellow-400 text-black border-2 border-black hover:bg-yellow-300 transition-colors"
                    >
                      Show Steps
                    </button>
                  </div>
                </div>
              )}

            {readingMode === "easy_read" ? (
              <>
                {isSimplifying &&
                simplifyingMode === "easy_read" &&
                !easyRead ? (
                  <div className="space-y-3">
                    <div className="h-4 bg-yellow-300 rounded animate-pulse border-2 border-black"></div>
                    <div className="h-4 bg-yellow-300 rounded animate-pulse w-5/6 border-2 border-black"></div>
                    <div className="h-4 bg-yellow-300 rounded animate-pulse w-4/6 border-2 border-black"></div>
                  </div>
                ) : easyRead ? (
                  <div className="space-y-4">
                    {easyRead.about ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          {t("header_short_summary")}
                        </p>
                        <p className="mt-2 text-base leading-relaxed text-black">
                          {easyRead.about}
                        </p>
                      </div>
                    ) : null}

                    <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                      <p className="text-base font-semibold text-black uppercase tracking-wide">
                        {t("header_key_points")}
                      </p>
                      <ul className="mt-3 space-y-2">
                        {(easyRead.key_points || []).map((bullet, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <span className="mt-2 w-2 h-2 rounded-full bg-black flex-none"></span>
                            <span className="text-base leading-relaxed text-black">
                              {bullet}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {easyRead.warnings && easyRead.warnings.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-200 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          {t("header_warnings")}
                        </p>
                        <ul className="mt-3 space-y-2">
                          {easyRead.warnings.slice(0, 6).map((w, idx) => (
                            <li key={idx} className="flex items-start gap-3">
                              <span className="mt-2 w-2 h-2 rounded-full bg-black flex-none"></span>
                              <span className="text-base text-black leading-relaxed">
                                {w}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {easyRead.important_links &&
                    easyRead.important_links.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          {t("header_important_links")}
                        </p>
                        <div className="mt-3 space-y-2">
                          {easyRead.important_links
                            .slice(0, 6)
                            .map((l, idx) => (
                              <button
                                key={`${l.url}-${idx}`}
                                onClick={() =>
                                  browser.tabs.create({ url: l.url })
                                }
                                className="w-full text-left rounded-lg border-2 border-black bg-yellow-400 p-3 hover:bg-yellow-300 transition-colors"
                              >
                                <p className="text-base font-medium text-black">
                                  {l.label || l.url}
                                </p>
                                <p className="mt-1 text-base text-black break-all">
                                  {l.url}
                                </p>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {easyRead.glossary && easyRead.glossary.length > 0 ? (
                      <details className="rounded-xl border-2 border-black bg-yellow-100 shadow-sm">
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between">
                          <span className="text-base font-semibold text-black">
                            {t("header_glossary")}
                          </span>
                          <span className="text-base text-black">
                            {easyRead.glossary.length} terms
                          </span>
                        </summary>
                        <div className="px-4 pb-4 divide-y-2 divide-black">
                          {easyRead.glossary.map((entry, idx) => (
                            <div key={`${entry.term}-${idx}`} className="py-3">
                              <p className="text-base font-semibold text-black">
                                {entry.term}
                              </p>
                              <p className="mt-1 text-base text-black leading-relaxed">
                                {entry.simple}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {easyRead.sections && easyRead.sections.length > 0 ? (
                      <details className="rounded-xl border-2 border-black bg-yellow-100 shadow-sm">
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between">
                          <span className="text-base font-semibold text-black">
                            {t("header_more_details")}
                          </span>
                          <span className="text-base text-black">
                            {easyRead.sections.length} sections
                          </span>
                        </summary>
                        <div className="px-4 pb-4 space-y-4">
                          {easyRead.sections.map((section, idx) => (
                            <div
                              key={`${section.heading}-${idx}`}
                              className="pt-2"
                            >
                              <p className="text-base font-semibold text-black">
                                {section.heading}
                              </p>
                              <ul className="mt-2 space-y-1">
                                {(section.bullets || [])
                                  .slice(0, 8)
                                  .map((b, bIdx) => (
                                    <li
                                      key={bIdx}
                                      className="flex items-start gap-2"
                                    >
                                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-black flex-none"></span>
                                      <span className="text-base text-black leading-relaxed">
                                        {b}
                                      </span>
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
                  <div className="space-y-3">
                    <div className="h-4 bg-yellow-300 rounded animate-pulse border-2 border-black"></div>
                    <div className="h-4 bg-yellow-300 rounded animate-pulse w-5/6 border-2 border-black"></div>
                    <div className="h-4 bg-yellow-300 rounded animate-pulse w-4/6 border-2 border-black"></div>
                  </div>
                )}
              </>
            ) : readingMode === "checklist" ? (
              <div className="space-y-4">
                {!checklistGuide ? (
                  <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-black">
                          Checklist
                        </p>
                        <p className="mt-1 text-base text-black break-words">
                          {hasChecklist === false
                            ? "Checklist not available for this page."
                            : "Generate a checklist for this page."}
                        </p>
                      </div>
                      <button
                        onClick={() => void runSimplify("checklist")}
                        disabled={isSimplifying}
                        className={`flex-none text-base px-3 py-2 rounded transition-colors border-2 border-black disabled:opacity-50 disabled:cursor-not-allowed ${
                          hasChecklist === false
                            ? "bg-yellow-400 hover:bg-yellow-300 text-black"
                            : "bg-black text-yellow-400 hover:bg-gray-800"
                        }`}
                      >
                        {isSimplifying && simplifyingMode === "checklist"
                          ? "Generating..."
                          : hasChecklist === false
                            ? "Retry"
                            : "Generate"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-black">
                            Checklist
                          </p>
                          {checklistGuide.goal ? (
                            <p className="mt-1 text-base text-black break-words">
                              {checklistGuide.goal}
                            </p>
                          ) : null}
                        </div>
                        <button
                          onClick={() => setChecklistDone({})}
                          className="flex-none text-base px-2 py-1 rounded bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black transition-colors"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    {checklistGuide.requirements.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          Requirements
                        </p>
                        <div className="mt-3 space-y-2">
                          {checklistGuide.requirements.map((req) => (
                            <label
                              key={req.id}
                              className="flex items-start gap-3 rounded-lg border-2 border-black bg-yellow-400 p-3 hover:bg-yellow-300 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={!!checklistDone[req.id]}
                                onChange={(e) =>
                                  setChecklistDone((prev) => ({
                                    ...prev,
                                    [req.id]: e.target.checked,
                                  }))
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-base font-medium text-black break-words">
                                    {req.item}
                                  </p>
                                  {req.required ? (
                                    <span className="flex-none text-base px-2 py-0.5 rounded-full bg-black text-yellow-400 border-2 border-black whitespace-nowrap">
                                      Required
                                    </span>
                                  ) : null}
                                </div>
                                {req.details ? (
                                  <p className="mt-1 text-base text-black leading-relaxed break-words">
                                    {req.details}
                                  </p>
                                ) : null}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {checklistGuide.documents.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          Documents
                        </p>
                        <div className="mt-3 space-y-2">
                          {checklistGuide.documents.map((doc) => (
                            <label
                              key={doc.id}
                              className="flex items-start gap-3 rounded-lg border-2 border-black bg-yellow-400 p-3 hover:bg-yellow-300 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={!!checklistDone[doc.id]}
                                onChange={(e) =>
                                  setChecklistDone((prev) => ({
                                    ...prev,
                                    [doc.id]: e.target.checked,
                                  }))
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-base font-medium text-black break-words">
                                    {doc.item}
                                  </p>
                                  {doc.required ? (
                                    <span className="flex-none text-base px-2 py-0.5 rounded-full bg-black text-yellow-400 border-2 border-black whitespace-nowrap">
                                      Required
                                    </span>
                                  ) : null}
                                </div>
                                {doc.details ? (
                                  <p className="mt-1 text-base text-black leading-relaxed break-words">
                                    {doc.details}
                                  </p>
                                ) : null}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {checklistGuide.fees.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          Fees
                        </p>
                        <ul className="mt-3 space-y-2">
                          {checklistGuide.fees.map((fee) => (
                            <li
                              key={fee.id}
                              className="flex items-start justify-between gap-3 rounded-lg border-2 border-black bg-yellow-400 p-3"
                            >
                              <span className="text-base font-medium text-black break-words flex-1">
                                {fee.item}
                              </span>
                              {fee.amount ? (
                                <span className="flex-none text-base px-2 py-0.5 rounded-full bg-black text-yellow-400 border-2 border-black whitespace-nowrap">
                                  {fee.amount}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {checklistGuide.deadlines.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          Deadlines
                        </p>
                        <ul className="mt-3 space-y-2">
                          {checklistGuide.deadlines.map((d) => (
                            <li
                              key={d.id}
                              className="flex items-start justify-between gap-3 rounded-lg border-2 border-black bg-yellow-400 p-3"
                            >
                              <span className="text-base font-medium text-black break-words flex-1">
                                {d.item}
                              </span>
                              {d.date ? (
                                <span className="flex-none text-base px-2 py-0.5 rounded-full bg-black text-yellow-400 border-2 border-black whitespace-nowrap">
                                  {d.date}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {checklistGuide.actions.length > 0 ? (
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          Actions
                        </p>
                        <div className="mt-3 space-y-2">
                          {checklistGuide.actions.map((act) => (
                            <label
                              key={act.id}
                              className="flex items-start gap-3 rounded-lg border-2 border-black bg-yellow-400 p-3 hover:bg-yellow-300 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={!!checklistDone[act.id]}
                                onChange={(e) =>
                                  setChecklistDone((prev) => ({
                                    ...prev,
                                    [act.id]: e.target.checked,
                                  }))
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-base font-medium text-black break-words">
                                  {act.item}
                                </p>
                                {act.url ? (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      browser.tabs.create({ url: act.url });
                                    }}
                                    className="mt-2 text-base text-black hover:underline font-semibold"
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
                      <div className="rounded-xl border-2 border-black bg-yellow-200 p-4 shadow-sm">
                        <p className="text-base font-semibold text-black uppercase tracking-wide">
                          Common Mistakes
                        </p>
                        <ul className="mt-3 space-y-2">
                          {checklistGuide.common_mistakes.map((m, idx) => (
                            <li key={idx} className="flex items-start gap-3">
                              <span className="mt-2 w-2 h-2 rounded-full bg-black flex-none"></span>
                              <span className="text-base text-black leading-relaxed break-words flex-1">
                                {m}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-4">
                  <div className="h-4 bg-yellow-300 rounded animate-pulse border-2 border-black"></div>
                  <div className="h-4 bg-yellow-300 rounded animate-pulse w-5/6 border-2 border-black"></div>
                  <div className="h-4 bg-yellow-300 rounded animate-pulse w-4/6 border-2 border-black"></div>
                </div>
                <div className="space-y-4">
                  {!stepByStepGuide ? (
                    <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-black">
                            Step-by-step Guide
                          </p>
                          <p className="mt-1 text-base text-black">
                            {hasSteps === false
                              ? "Step-by-step guide not available for this page."
                              : "Generate a step-by-step guide for this page."}
                          </p>
                        </div>
                        <button
                          onClick={() => void runSimplify("step_by_step")}
                          disabled={isSimplifying}
                          className="flex-none text-sm px-3 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isSimplifying && simplifyingMode === "step_by_step"
                            ? "Generating..."
                            : hasSteps === false
                              ? "Retry"
                              : "Generate"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-base font-semibold text-black">
                              Step-by-step Guide
                            </p>
                            {stepByStepGuide.goal ? (
                              <p className="mt-1 text-base text-black">
                                {stepByStepGuide.goal}
                              </p>
                            ) : null}
                          </div>
                          <button
                            onClick={() => setStepsDone({})}
                            className="flex-none text-sm px-3 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black transition-colors font-semibold"
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border-2 border-black bg-yellow-50 p-4 shadow-sm">
                        <div className="space-y-3">
                          {stepByStepGuide.steps.map((s, idx) => (
                            <div
                              key={s.id}
                              className="rounded-lg border-2 border-black bg-yellow-100 p-3"
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-5 w-5 accent-black"
                                  checked={!!stepsDone[s.id]}
                                  onChange={(e) =>
                                    setStepsDone((prev) => ({
                                      ...prev,
                                      [s.id]: e.target.checked,
                                    }))
                                  }
                                />
                                <div className="min-w-0">
                                  <p className="text-base font-semibold text-black">
                                    {s.step ?? idx + 1}. {s.title}
                                  </p>
                                  {s.what_to_do ? (
                                    <p className="mt-1 text-base text-black leading-relaxed">
                                      {s.what_to_do}
                                    </p>
                                  ) : null}
                                  {s.where_to_click ? (
                                    <p className="mt-2 text-sm text-black">
                                      <span className="font-semibold text-black">
                                        Where to click:
                                      </span>{" "}
                                      {s.where_to_click}
                                    </p>
                                  ) : null}
                                  {s.url ? (
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        browser.tabs.create({ url: s.url });
                                      }}
                                      className="mt-2 text-sm text-black hover:underline font-semibold"
                                    >
                                      Open link
                                    </button>
                                  ) : null}
                                  {s.tips.length > 0 ? (
                                    <ul className="mt-2 space-y-1">
                                      {s.tips.slice(0, 3).map((t, tIdx) => (
                                        <li
                                          key={tIdx}
                                          className="text-sm text-black leading-relaxed"
                                        >
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
                        <div className="rounded-xl border-2 border-black bg-yellow-100 p-4 shadow-sm">
                          <p className="text-sm font-semibold text-black uppercase tracking-wide">
                            {t("header_finish_check")}
                          </p>
                          <ul className="mt-3 space-y-2">
                            {stepByStepGuide.finish_check.map((c, idx) => (
                              <li key={idx} className="flex items-start gap-3">
                                <span className="mt-2 w-2 h-2 rounded-full bg-black flex-none"></span>
                                <span className="text-base text-black leading-relaxed">
                                  {c}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Controls for Summary Tab */}
          <div className="bg-yellow-50 border-t-4 border-black p-4 shadow-lg">
            {/* Zoom + Refresh + TTS + Original Toggle + Settings */}
            <div className="mb-3 flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-black">
                    {t("zoom")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleZoomOut}
                    disabled={zoomLevel === 1}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-black hover:bg-yellow-400 text-yellow-400 hover:text-black border-2 border-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <button
                    onClick={handleZoomIn}
                    disabled={zoomLevel === 1.5}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-black hover:bg-yellow-400 text-yellow-400 hover:text-black border-2 border-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                  <button
                    onClick={requestPageSummary}
                    disabled={isSimplifying}
                    className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-black hover:bg-gray-800 text-yellow-400 border-2 border-black disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    title={t("refresh")}
                  >
                    <span className="text-2xl">↻</span>
                  </button>
                  {(() => {
                    const isActive =
                      ttsTarget?.kind === "summary" && tts.status !== "idle";
                    const canStart =
                      readingMode === "easy_read"
                        ? !!easyRead
                        : readingMode === "checklist"
                          ? !!checklistGuide
                          : readingMode === "step_by_step"
                            ? !!stepByStepGuide
                            : false;

                    if (!tts.isSupported) {
                      return (
                        <button
                          type="button"
                          disabled
                          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-yellow-200 text-gray-400 border-2 border-black shadow-sm cursor-not-allowed"
                          title="Text-to-speech is not supported"
                        >
                          <SpeakerWaveIcon className="w-5 h-5" />
                        </button>
                      );
                    }

                    if (!isActive) {
                      return (
                        <button
                          type="button"
                          onClick={startSummarySpeech}
                          disabled={!canStart}
                          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title={t("listen")}
                        >
                          <SpeakerWaveIcon className="w-5 h-5" />
                        </button>
                      );
                    }

                    return (
                      <button
                        type="button"
                        onClick={() =>
                          tts.status === "speaking" ? tts.pause() : tts.resume()
                        }
                        className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black shadow-sm transition-colors"
                        title={
                          tts.status === "speaking" ? t("pause") : t("play")
                        }
                      >
                        {tts.status === "speaking" ? (
                          <PauseIcon className="w-5 h-5" />
                        ) : (
                          <PlayIcon className="w-5 h-5" />
                        )}
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-black">
                    {t("page_language")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPageLanguageMode(
                        pageLanguageMode === "original"
                          ? "preferred"
                          : "original",
                      )
                    }
                    aria-pressed={pageLanguageMode === "original"}
                    title={
                      pageLanguageMode === "original"
                        ? t("original")
                        : LANGUAGE_BADGE[language]
                    }
                    className={`flex-1 py-3 text-base font-bold rounded-lg border-2 border-black transition-colors ${
                      pageLanguageMode === "original"
                        ? "bg-black text-yellow-400"
                        : "bg-yellow-400 text-black hover:bg-yellow-300"
                    }`}
                  >
                    {pageLanguageMode === "original"
                      ? t("original")
                      : LANGUAGE_BADGE[language]}
                  </button>
                  <button
                    onClick={openSettings}
                    className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black transition-colors border-2 border-black shadow-sm"
                    title={t("settings")}
                    aria-label={t("settings")}
                  >
                    <GearIcon className="w-6 h-6 text-black" />
                  </button>
                </div>
              </div>
            </div>

            {/* Selection Mode Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectionMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 rounded-lg transition-colors border-2 border-black ${
                  selectionMode
                    ? "bg-yellow-400 text-black ring-2 ring-black"
                    : "bg-black text-yellow-400 hover:bg-gray-800"
                }`}
              >
                <SelectionIcon className="w-5 h-5" />
                <span className="text-base font-medium">
                  {selectionMode ? t("selection_on") : t("selection_off")}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 rounded-lg transition-colors border-2 border-black ${
                  magnifyingMode
                    ? "bg-yellow-400 text-black ring-2 ring-black"
                    : "bg-black text-yellow-400 hover:bg-gray-800"
                }`}
              >
                <MagnifierIcon className="w-5 h-5" />
                <span className="text-base font-medium">
                  {magnifyingMode ? t("magnify_on") : t("magnify_off")}
                </span>
              </button>
            </div>
          </div>
        </>
      ) : activeTab === "headings" ? (
        /* Headings Tab */
        <>
          <div className="flex-1 overflow-y-auto p-6 bg-yellow-50">
            <div className="mb-4">
              {headings.length === 0 ? (
                <div className="text-black text-lg border-2 border-black bg-yellow-100 p-4 rounded-lg">
                  <p className="mb-2 font-semibold">{t("no_headings")}</p>
                  <p className="text-base">{t("try_refresh")}</p>
                </div>
              ) : (
                <nav className="space-y-1">
                  {headings.map((heading, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleHeadingClick(heading)}
                      className={`w-full text-left px-4 py-3 rounded-lg hover:bg-black hover:text-yellow-400 transition-colors border-2 border-black bg-yellow-100 ${
                        heading.level === 1
                          ? "font-bold text-lg"
                          : heading.level === 2
                            ? "font-semibold text-base"
                            : "text-base"
                      }`}
                      style={{
                        paddingLeft: `${heading.level * 0.75}rem`,
                      }}
                    >
                      <span className="mr-2">
                        {heading.level === 1
                          ? ">"
                          : heading.level === 2
                            ? "-"
                            : "."}
                      </span>
                      <span>{heading.text}</span>
                    </button>
                  ))}
                </nav>
              )}
            </div>
          </div>

          {/* Controls for Headings Tab */}
          <div className="bg-yellow-50 border-t-4 border-black p-4 shadow-lg">
            {/* Zoom + Refresh + TTS + Original Toggle + Settings */}
            <div className="mb-3 flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-black">
                    {t("zoom")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleZoomOut}
                    disabled={zoomLevel === 1}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-black hover:bg-yellow-400 text-yellow-400 hover:text-black border-2 border-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <button
                    onClick={handleZoomIn}
                    disabled={zoomLevel === 1.5}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-black hover:bg-yellow-400 text-yellow-400 hover:text-black border-2 border-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                  <button
                    onClick={requestPageSummary}
                    disabled={isSimplifying}
                    className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-black hover:bg-gray-800 text-yellow-400 border-2 border-black disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    title={t("refresh")}
                  >
                    <span className="text-2xl">↻</span>
                  </button>
                  {(() => {
                    const isActive =
                      ttsTarget?.kind === "headings" && tts.status !== "idle";
                    const canStart = headings.length > 0;

                    if (!tts.isSupported) {
                      return (
                        <button
                          type="button"
                          disabled
                          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-yellow-200 text-gray-400 border-2 border-black shadow-sm cursor-not-allowed"
                          title="Text-to-speech is not supported"
                        >
                          <SpeakerWaveIcon className="w-5 h-5" />
                        </button>
                      );
                    }

                    if (!isActive) {
                      return (
                        <button
                          type="button"
                          onClick={startHeadingsSpeech}
                          disabled={!canStart}
                          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title={t("listen")}
                        >
                          <SpeakerWaveIcon className="w-5 h-5" />
                        </button>
                      );
                    }

                    return (
                      <button
                        type="button"
                        onClick={() =>
                          tts.status === "speaking" ? tts.pause() : tts.resume()
                        }
                        className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-black shadow-sm transition-colors"
                        title={
                          tts.status === "speaking" ? t("pause") : t("play")
                        }
                      >
                        {tts.status === "speaking" ? (
                          <PauseIcon className="w-5 h-5" />
                        ) : (
                          <PlayIcon className="w-5 h-5" />
                        )}
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-black">
                    {t("page_language")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPageLanguageMode(
                        pageLanguageMode === "original"
                          ? "preferred"
                          : "original",
                      )
                    }
                    aria-pressed={pageLanguageMode === "original"}
                    title={
                      pageLanguageMode === "original"
                        ? t("original")
                        : LANGUAGE_BADGE[language]
                    }
                    className={`flex-1 py-3 text-base font-bold rounded-lg border-2 border-black transition-colors ${
                      pageLanguageMode === "original"
                        ? "bg-black text-yellow-400"
                        : "bg-yellow-400 text-black hover:bg-yellow-300"
                    }`}
                  >
                    {pageLanguageMode === "original"
                      ? t("original")
                      : LANGUAGE_BADGE[language]}
                  </button>
                  <button
                    onClick={openSettings}
                    className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black transition-colors border-2 border-black shadow-sm"
                    title={t("settings")}
                    aria-label={t("settings")}
                  >
                    <GearIcon className="w-6 h-6 text-black" />
                  </button>
                </div>
              </div>
            </div>

            {/* Selection Mode Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectionMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 rounded-lg transition-colors border-2 border-black ${
                  selectionMode
                    ? "bg-yellow-400 text-black ring-2 ring-black"
                    : "bg-black text-yellow-400 hover:bg-gray-800"
                }`}
              >
                <SelectionIcon className="w-5 h-5" />
                <span className="text-base font-medium">
                  {selectionMode ? t("selection_on") : t("selection_off")}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 rounded-lg transition-colors border-2 border-black ${
                  magnifyingMode
                    ? "bg-yellow-400 text-black ring-2 ring-black"
                    : "bg-black text-yellow-400 hover:bg-gray-800"
                }`}
              >
                <MagnifierIcon className="w-5 h-5" />
                <span className="text-base font-medium">
                  {magnifyingMode ? t("magnify_on") : t("magnify_off")}
                </span>
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Chat Tab */
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-0 bg-yellow-50">
            {messages.length === 0 ? (
              <div className="text-center text-black mt-8 border-2 border-black bg-yellow-100 p-6 rounded-lg">
                <svg
                  className="w-16 h-16 mx-auto mb-4 text-black"
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
                <p className="text-base font-medium mb-1">
                  {t("no_conversation")}
                </p>
                <p className="text-base">{t("click_to_start")}</p>
              </div>
            ) : (
              <>
                {messages.map((message) => {
                  const isActive =
                    ttsTarget?.kind === "chat" &&
                    ttsTarget.id === message.id &&
                    tts.status !== "idle";
                  const safeContent =
                    typeof message.content === "string"
                      ? message.content
                      : String((message as any)?.content ?? "");
                  const canSpeak = tts.isSupported && !!safeContent.trim();
                  const timeLabel = formatTimestamp(
                    (message as any)?.timestamp ?? message.timestamp,
                  );

                  const ttsButtonClass =
                    message.role === "user"
                      ? "border-2 border-black bg-yellow-400 text-black hover:bg-yellow-300 focus:ring-yellow-400"
                      : "border-2 border-black bg-yellow-400 text-black hover:bg-yellow-300 focus:ring-yellow-400";

                  const ttsButtonActiveClass =
                    message.role === "user"
                      ? "border-2 border-black bg-black text-yellow-400 hover:bg-gray-800 focus:ring-yellow-400"
                      : "border-2 border-black bg-black text-yellow-400 hover:bg-gray-800 focus:ring-yellow-400";

                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-4 py-3 relative border-2 border-black ${
                          message.role === "user"
                            ? "bg-black text-yellow-400"
                            : "bg-yellow-100 text-black shadow-md"
                        } ${canSpeak ? "pr-12" : ""}`}
                      >
                        <p className="text-base leading-relaxed break-words">
                          {message.content}
                        </p>
                        <p
                          className={`text-base mt-1 ${
                            message.role === "user"
                              ? "text-yellow-300"
                              : "text-black opacity-70"
                          }`}
                        >
                          {timeLabel}
                        </p>

                        {canSpeak && (
                          <div className="absolute top-2 right-2 flex flex-col items-center gap-2">
                            {!isActive ? (
                              <button
                                type="button"
                                onClick={() => startChatMessageSpeech(message)}
                                disabled={!canSpeak}
                                className={`p-2 rounded-lg shadow-sm focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${ttsButtonClass}`}
                                title={t("listen")}
                                aria-label={t("listen")}
                              >
                                <SpeakerWaveIcon className="w-5 h-5" />
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    tts.status === "speaking"
                                      ? tts.pause()
                                      : tts.resume()
                                  }
                                  className={`p-2 rounded-lg shadow-sm focus:outline-none focus:ring-2 transition-colors ${ttsButtonActiveClass}`}
                                  title={
                                    tts.status === "speaking"
                                      ? t("pause")
                                      : t("play")
                                  }
                                  aria-label={
                                    tts.status === "speaking"
                                      ? t("pause")
                                      : t("play")
                                  }
                                >
                                  {tts.status === "speaking" ? (
                                    <PauseIcon className="w-5 h-5" />
                                  ) : (
                                    <PlayIcon className="w-5 h-5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={tts.stop}
                                  className={`p-2 rounded-lg shadow-sm focus:outline-none focus:ring-2 transition-colors ${ttsButtonActiveClass}`}
                                  title={t("stop")}
                                  aria-label={t("stop")}
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
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-black border-2 border-yellow-400 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce delay-100"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce delay-200"></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Text Input Section */}
          <div className="border-t-4 border-black bg-yellow-50 p-4">
            <form onSubmit={handleSubmitMessage} className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={t("type_question")}
                disabled={isChatLoading}
                className="flex-1 px-4 py-2 border-2 border-black rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-black disabled:bg-yellow-200 disabled:cursor-not-allowed text-base bg-yellow-100 text-black"
              />
              <button
                type="submit"
                disabled={isChatLoading || !inputText.trim()}
                className="px-6 py-2 bg-black text-yellow-400 font-medium rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-2 border-black text-base"
              >
                {t("send")}
              </button>
            </form>
          </div>

          {/* Controls for Chat Tab */}
          <div className="bg-yellow-50 border-t-4 border-black p-4 shadow-lg">
            {/* Zoom + Original Toggle + Settings */}
            <div className="mb-3 flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-black">
                    {t("zoom")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleZoomOut}
                    disabled={zoomLevel === 1}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-black hover:bg-yellow-400 text-yellow-400 hover:text-black border-2 border-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <button
                    onClick={handleZoomIn}
                    disabled={zoomLevel === 1.5}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold bg-black hover:bg-yellow-400 text-yellow-400 hover:text-black border-2 border-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-black">
                    {t("page_language")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPageLanguageMode(
                        pageLanguageMode === "original"
                          ? "preferred"
                          : "original",
                      )
                    }
                    aria-pressed={pageLanguageMode === "original"}
                    title={
                      pageLanguageMode === "original"
                        ? t("original")
                        : LANGUAGE_BADGE[language]
                    }
                    className={`flex-1 py-3 text-base font-bold rounded-lg border-2 border-black transition-colors ${
                      pageLanguageMode === "original"
                        ? "bg-black text-yellow-400"
                        : "bg-yellow-400 text-black hover:bg-yellow-300"
                    }`}
                  >
                    {pageLanguageMode === "original"
                      ? t("original")
                      : LANGUAGE_BADGE[language]}
                  </button>
                  <button
                    onClick={openSettings}
                    className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black transition-colors border-2 border-black shadow-sm"
                    title={t("settings")}
                    aria-label={t("settings")}
                  >
                    <GearIcon className="w-6 h-6 text-black" />
                  </button>
                </div>
              </div>
            </div>

            {/* Selection Mode Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectionMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 rounded-lg transition-colors border-2 border-black ${
                  selectionMode
                    ? "bg-yellow-400 text-black ring-2 ring-black"
                    : "bg-black text-yellow-400 hover:bg-gray-800"
                }`}
              >
                <SelectionIcon className="w-5 h-5" />
                <span className="text-base font-medium">
                  {selectionMode ? t("selection_on") : t("selection_off")}
                </span>
              </button>
              <button
                onClick={toggleMagnifyingMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 rounded-lg transition-colors border-2 border-black ${
                  magnifyingMode
                    ? "bg-yellow-400 text-black ring-2 ring-black"
                    : "bg-black text-yellow-400 hover:bg-gray-800"
                }`}
              >
                <MagnifierIcon className="w-5 h-5" />
                <span className="text-base font-medium">
                  {magnifyingMode ? t("magnify_on") : t("magnify_off")}
                </span>
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

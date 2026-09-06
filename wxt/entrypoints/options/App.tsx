import { useState, useEffect, useRef } from "react";
import { storage } from "@wxt-dev/storage";

type OnboardingStep = "welcome" | "visual" | "cognitive" | "success";

type LanguageCode = "en" | "zh" | "ms" | "ta";

interface UserPreferences {
  // Default language for extension + page translation
  language: LanguageCode;
  // Font size settings
  fontSize: "standard" | "large" | "extra-large";
  // Link styling
  linkStyle: "default" | "underline" | "highlight" | "border";
  // Contrast mode
  contrastMode: "standard" | "high-contrast-yellow";
  // Magnifying glass zoom
  magnifyingZoomLevel: 1.5 | 2 | 2.5 | 3;
  // Other features
  hideAds: boolean;
  simplifyLanguage: boolean;
  showBreadcrumbs: boolean;
  // Audio (Text-to-Speech)
  ttsRate: number;
  autoReadAssistant: boolean;
  profileName: string;
}

type LanguageOption = {
  value: LanguageCode;
  native: string;
  labelKey: "lang_english" | "lang_chinese" | "lang_malay" | "lang_tamil";
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en", native: "English", labelKey: "lang_english" },
  { value: "zh", native: "中文", labelKey: "lang_chinese" },
  // Force a clean line-break so it never wraps mid-word on narrow widths.
  { value: "ms", native: "Bahasa\nMelayu", labelKey: "lang_malay" },
  { value: "ta", native: "தமிழ்", labelKey: "lang_tamil" },
];

const TTS_RATE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1, label: "1x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];

const DEFAULT_PREFERENCES: UserPreferences = {
  language: "en",
  fontSize: "standard",
  linkStyle: "default",
  contrastMode: "standard",
  magnifyingZoomLevel: 2,
  hideAds: false,
  simplifyLanguage: false,
  showBreadcrumbs: false,
  ttsRate: 1,
  autoReadAssistant: false,
  profileName: "My Profile",
};

type UiStrings = typeof UI_STRINGS.en;

const UI_STRINGS = {
  en: {
    welcome_title: "Welcome to ClearWeb",
    welcome_subtitle: "Let's personalize your web browsing experience",
    language: "Language",
    language_helper: "You can change this later during setup.",
    start_setup: "Start Setup",
    start_setup_aria: "Start setup process",
    setup_duration: "This will take about 2 minutes",

    step_1_of_2: "Step 1 of 2",
    step_2_of_2: "Step 2 of 2",

    back: "← Back",
    next: "Next →",
    complete_setup: "Complete Setup ✓",

    visual_preferences: "Visual Preferences",
    visual_preferences_desc: "Customize how text and links appear on web pages",

    browsing_preferences: "Browsing Preferences",
    browsing_preferences_desc: "Choose features to simplify your experience",

    font_size: "Font Size",
    font_standard: "Standard",
    font_standard_desc: "Default text size",
    font_large: "Large",
    font_large_desc: "125% larger text",
    font_extra_large: "Extra Large",
    font_extra_large_desc: "150% larger text",

    link_style: "Link Style",
    link_default: "Default",
    link_default_desc: "Standard link appearance",
    link_underline: "Underline",
    link_underline_desc: "Underline all links",
    link_highlight: "Highlight",
    link_highlight_desc: "Yellow highlight behind links",
    link_bordered: "Bordered",
    link_bordered_desc: "Thick border around links",

    contrast_mode: "Contrast Mode",
    contrast_standard: "Standard",
    contrast_standard_desc: "Normal colors",
    contrast_high: "High Contrast (Yellow/Black)",
    contrast_high_desc: "Yellow text on black background",

    current: "Current:",

    language_card_desc: "Sets the extension and main webpage language",

    hide_ads: "Hide Ads",
    hide_ads_desc: "Remove distracting advertisements",
    simplify_language: "Translate Page",
    simplify_language_desc: "Translate webpage text into your selected language",
    show_breadcrumbs: "Show Breadcrumbs",
    show_breadcrumbs_desc: "Display navigation paths on pages",

    read_aloud: "Read Aloud",
    read_aloud_desc: "Listen to summaries, headings, and chat replies",
    preview: "Preview",
    preview_utterance: "Preview: ClearWeb can read text out loud for you.",
    read_aloud_unsupported: "Read aloud is not supported in this browser.",
    speed: "Speed",

    auto_read_assistant: "Auto-read assistant replies (optional)",
    auto_read_assistant_desc:
      "When ClearWeb answers in Chat, it reads the reply automatically.",
    on: "On",
    off: "Off",

    success_title: "You're All Set!",
    success_profile_active: 'Your profile "{name}" is now active',
    success_auto_close: "This window will close automatically...",
    your_settings: "Your Settings:",

    label_font_size: "Font Size",
    label_link_style: "Link Style",
    label_contrast: "Contrast",
    label_language: "Language",
    label_read_aloud_speed: "Read Aloud Speed",
    label_auto_read: "Auto-read assistant replies",

    hide_ads_enabled: "Hide Ads enabled",
    simplify_language_enabled: "Page translation enabled",
    show_breadcrumbs_enabled: "Show Breadcrumbs enabled",

    live_preview: "Live Preview",
    sample_webpage: "Sample Webpage",
    preview_text_1: "This is how text will appear with your current settings.",
    preview_link_before: "Here is a",
    preview_sample_link: "sample link",
    preview_link_after: "to show link styling.",
    advertisement: "[Advertisement]",
    breadcrumb_home: "Home",
    breadcrumb_settings: "Settings",
    breadcrumb_accessibility: "Accessibility",
    preview_easy_words: "Page translation is enabled for your selected language.",
    preview_complex_words: "Page translation is off; original text is preserved.",
    current_settings: "Current Settings:",
    ads: "Ads",
    ads_hidden: "Hidden",
    ads_visible: "Visible",
    breadcrumbs: "Breadcrumbs",
    auto_read_replies: "Auto-read replies",

    lang_english: "English",
    lang_chinese: "Chinese",
    lang_malay: "Malay",
    lang_tamil: "Tamil",
  },
  zh: {
    welcome_title: "欢迎使用 ClearWeb",
    welcome_subtitle: "让我们为你个性化网页浏览体验",
    language: "语言",
    language_helper: "你可以在设置过程中随时更改。",
    start_setup: "开始设置",
    start_setup_aria: "开始设置流程",
    setup_duration: "大约需要 2 分钟",

    step_1_of_2: "第 1 步（共 2 步）",
    step_2_of_2: "第 2 步（共 2 步）",

    back: "← 返回",
    next: "下一步 →",
    complete_setup: "完成设置 ✓",

    visual_preferences: "视觉偏好",
    visual_preferences_desc: "自定义网页中文字与链接的显示方式",

    browsing_preferences: "浏览偏好",
    browsing_preferences_desc: "选择功能以简化你的体验",

    font_size: "字号",
    font_standard: "标准",
    font_standard_desc: "默认字号",
    font_large: "大",
    font_large_desc: "文字放大 125%",
    font_extra_large: "特大",
    font_extra_large_desc: "文字放大 150%",

    link_style: "链接样式",
    link_default: "默认",
    link_default_desc: "标准链接外观",
    link_underline: "下划线",
    link_underline_desc: "为所有链接添加下划线",
    link_highlight: "高亮",
    link_highlight_desc: "为链接添加黄色高亮背景",
    link_bordered: "边框",
    link_bordered_desc: "为链接添加粗边框",

    contrast_mode: "对比模式",
    contrast_standard: "标准",
    contrast_standard_desc: "正常颜色",
    contrast_high: "高对比（黄/黑）",
    contrast_high_desc: "黑底黄字",

    current: "当前：",

    language_card_desc: "设置扩展与网页的默认语言",

    hide_ads: "隐藏广告",
    hide_ads_desc: "移除分散注意力的广告",
    simplify_language: "翻译网页",
    simplify_language_desc: "将网页文字翻译成您选择的语言",
    show_breadcrumbs: "显示面包屑导航",
    show_breadcrumbs_desc: "在页面上显示导航路径",

    read_aloud: "朗读",
    read_aloud_desc: "朗读摘要、目录与聊天回复",
    preview: "试听",
    preview_utterance: "试听：ClearWeb 可以为你朗读文字内容。",
    read_aloud_unsupported: "当前浏览器不支持朗读功能。",
    speed: "语速",

    auto_read_assistant: "自动朗读助手回复（可选）",
    auto_read_assistant_desc: "当 ClearWeb 在聊天中回复时，会自动朗读内容。",
    on: "开",
    off: "关",

    success_title: "设置完成！",
    success_profile_active: "你的配置 “{name}” 已启用",
    success_auto_close: "此窗口将自动关闭...",
    your_settings: "你的设置：",

    label_font_size: "字号",
    label_link_style: "链接样式",
    label_contrast: "对比",
    label_language: "语言",
    label_read_aloud_speed: "朗读语速",
    label_auto_read: "自动朗读助手回复",

    hide_ads_enabled: "已开启隐藏广告",
    simplify_language_enabled: "已开启网页翻译",
    show_breadcrumbs_enabled: "已开启面包屑导航",

    live_preview: "实时预览",
    sample_webpage: "示例网页",
    preview_text_1: "这是根据当前设置显示的文字效果。",
    preview_link_before: "这里有一个",
    preview_sample_link: "示例链接",
    preview_link_after: "用于展示链接样式。",
    advertisement: "[广告]",
    breadcrumb_home: "首页",
    breadcrumb_settings: "设置",
    breadcrumb_accessibility: "无障碍",
    preview_easy_words: "网页翻译已针对您选择的语言开启。",
    preview_complex_words: "网页翻译已关闭；保留原始文字。",
    current_settings: "当前设置：",
    ads: "广告",
    ads_hidden: "已隐藏",
    ads_visible: "可见",
    breadcrumbs: "面包屑导航",
    auto_read_replies: "自动朗读回复",

    lang_english: "英语",
    lang_chinese: "中文",
    lang_malay: "马来语",
    lang_tamil: "泰米尔语",
  },
  ms: {
    welcome_title: "Selamat datang ke ClearWeb",
    welcome_subtitle: "Mari peribadikan pengalaman melayar web anda",
    language: "Bahasa",
    language_helper: "Anda boleh ubah ini kemudian semasa tetapan.",
    start_setup: "Mula Tetapan",
    start_setup_aria: "Mulakan proses tetapan",
    setup_duration: "Ini mengambil kira-kira 2 minit",

    step_1_of_2: "Langkah 1 daripada 2",
    step_2_of_2: "Langkah 2 daripada 2",

    back: "← Kembali",
    next: "Seterusnya →",
    complete_setup: "Selesaikan Tetapan ✓",

    visual_preferences: "Keutamaan Visual",
    visual_preferences_desc: "Sesuaikan cara teks dan pautan dipaparkan",

    browsing_preferences: "Keutamaan Pelayaran",
    browsing_preferences_desc: "Pilih ciri untuk memudahkan pengalaman anda",

    font_size: "Saiz Fon",
    font_standard: "Standard",
    font_standard_desc: "Saiz teks lalai",
    font_large: "Besar",
    font_large_desc: "Teks 125% lebih besar",
    font_extra_large: "Sangat Besar",
    font_extra_large_desc: "Teks 150% lebih besar",

    link_style: "Gaya Pautan",
    link_default: "Lalai",
    link_default_desc: "Penampilan pautan biasa",
    link_underline: "Garis Bawah",
    link_underline_desc: "Garis bawah semua pautan",
    link_highlight: "Sorot",
    link_highlight_desc: "Sorotan kuning di belakang pautan",
    link_bordered: "Berbingkai",
    link_bordered_desc: "Bingkai tebal di sekeliling pautan",

    contrast_mode: "Mod Kontras",
    contrast_standard: "Standard",
    contrast_standard_desc: "Warna biasa",
    contrast_high: "Kontras Tinggi (Kuning/Hitam)",
    contrast_high_desc: "Teks kuning pada latar hitam",

    current: "Semasa:",

    language_card_desc: "Tetapkan bahasa untuk sambungan dan laman utama",

    hide_ads: "Sembunyi Iklan",
    hide_ads_desc: "Buang iklan yang mengganggu",
    simplify_language: "Terjemah Halaman",
    simplify_language_desc: "Terjemah teks laman ke bahasa pilihan anda",
    show_breadcrumbs: "Tunjuk Breadcrumbs",
    show_breadcrumbs_desc: "Paparkan laluan navigasi pada halaman",

    read_aloud: "Baca Kuat",
    read_aloud_desc: "Dengar ringkasan, tajuk, dan balasan chat",
    preview: "Pratonton",
    preview_utterance: "Pratonton: ClearWeb boleh membaca teks untuk anda.",
    read_aloud_unsupported: "Baca kuat tidak disokong dalam pelayar ini.",
    speed: "Kelajuan",

    auto_read_assistant: "Auto-baca balasan pembantu (pilihan)",
    auto_read_assistant_desc:
      "Apabila ClearWeb membalas dalam Chat, ia membaca balasan secara automatik.",
    on: "On",
    off: "Off",

    success_title: "Semua Sedia!",
    success_profile_active: 'Profil "{name}" kini aktif',
    success_auto_close: "Tetingkap ini akan ditutup secara automatik...",
    your_settings: "Tetapan Anda:",

    label_font_size: "Saiz Fon",
    label_link_style: "Gaya Pautan",
    label_contrast: "Kontras",
    label_language: "Bahasa",
    label_read_aloud_speed: "Kelajuan Baca Kuat",
    label_auto_read: "Auto-baca balasan pembantu",

    hide_ads_enabled: "Sembunyi Iklan diaktifkan",
    simplify_language_enabled: "Terjemahan halaman diaktifkan",
    show_breadcrumbs_enabled: "Breadcrumbs diaktifkan",

    live_preview: "Pratonton Langsung",
    sample_webpage: "Laman Contoh",
    preview_text_1: "Ini ialah cara teks dipaparkan mengikut tetapan semasa.",
    preview_link_before: "Ini ialah",
    preview_sample_link: "pautan contoh",
    preview_link_after: "untuk menunjukkan gaya pautan.",
    advertisement: "[Iklan]",
    breadcrumb_home: "Laman Utama",
    breadcrumb_settings: "Tetapan",
    breadcrumb_accessibility: "Kebolehcapaian",
    preview_easy_words: "Terjemahan halaman aktif untuk bahasa pilihan anda.",
    preview_complex_words: "Terjemahan dimatikan; teks asal dikekalkan.",
    current_settings: "Tetapan Semasa:",
    ads: "Iklan",
    ads_hidden: "Disembunyikan",
    ads_visible: "Kelihatan",
    breadcrumbs: "Breadcrumbs",
    auto_read_replies: "Auto-baca balasan",

    lang_english: "Inggeris",
    lang_chinese: "Cina",
    lang_malay: "Melayu",
    lang_tamil: "Tamil",
  },
  ta: {
    welcome_title: "ClearWeb க்கு வரவேற்கிறோம்",
    welcome_subtitle: "உங்கள் இணைய உலாவல் அனுபவத்தை தனிப்பயனாக்கலாம்",
    language: "மொழி",
    language_helper: "பின்னர் அமைப்புகளில் இதை மாற்றலாம்.",
    start_setup: "அமைப்பை தொடங்கு",
    start_setup_aria: "அமைப்பு செயல்முறையை தொடங்கு",
    setup_duration: "இதற்கு சுமார் 2 நிமிடங்கள் ஆகும்",

    step_1_of_2: "படி 1 / 2",
    step_2_of_2: "படி 2 / 2",

    back: "← பின்செல்",
    next: "அடுத்து →",
    complete_setup: "அமைப்பை முடி ✓",

    visual_preferences: "காட்சி முன்னுரிமைகள்",
    visual_preferences_desc:
      "உரை மற்றும் இணைப்புகள் எப்படி காட்டப்படுகின்றன என்பதை மாற்றவும்",

    browsing_preferences: "உலாவல் முன்னுரிமைகள்",
    browsing_preferences_desc:
      "உங்கள் அனுபவத்தை எளிமைப்படுத்த அம்சங்களை தேர்வு செய்யவும்",

    font_size: "எழுத்து அளவு",
    font_standard: "இயல்பான",
    font_standard_desc: "இயல்பான எழுத்து அளவு",
    font_large: "பெரியது",
    font_large_desc: "125% பெரிய எழுத்து",
    font_extra_large: "மிக பெரியது",
    font_extra_large_desc: "150% பெரிய எழுத்து",

    link_style: "இணைப்பு பாணி",
    link_default: "இயல்பு",
    link_default_desc: "இயல்பான இணைப்பு தோற்றம்",
    link_underline: "அடிக்கோடு",
    link_underline_desc: "அனைத்து இணைப்புகளுக்கும் அடிக்கோடு",
    link_highlight: "ஒளிப்படுத்தல்",
    link_highlight_desc: "இணைப்புகளுக்கு மஞ்சள் ஒளிப்படுத்தல்",
    link_bordered: "எல்லையுடன்",
    link_bordered_desc: "இணைப்புகளுக்கு தடிமன் எல்லை",

    contrast_mode: "மாறுபாடு முறை",
    contrast_standard: "இயல்பான",
    contrast_standard_desc: "சாதாரண நிறங்கள்",
    contrast_high: "உயர் மாறுபாடு (மஞ்சள்/கருப்பு)",
    contrast_high_desc: "கருப்பு பின்னணியில் மஞ்சள் எழுத்து",

    current: "தற்போது:",

    language_card_desc:
      "நீட்டிப்பு மற்றும் முக்கியப் பக்கத்திற்கான மொழியை அமைக்கிறது",

    hide_ads: "விளம்பரங்களை மறை",
    hide_ads_desc: "கவனச்சிதறலை ஏற்படுத்தும் விளம்பரங்களை நீக்கு",
    simplify_language: "பக்கத்தை மொழிபெயர்",
    simplify_language_desc: "இணையப் பக்க உரையை நீங்கள் தேர்ந்தெடுத்த மொழிக்கு மொழிபெயர்க்கவும்",
    show_breadcrumbs: "Breadcrumbs காண்பி",
    show_breadcrumbs_desc: "பக்கங்களில் வழிசெலுத்தல் பாதையை காண்பி",

    read_aloud: "சத்தமாக வாசி",
    read_aloud_desc:
      "சுருக்கங்கள், தலைப்புகள், மற்றும் அரட்டை பதில்களை கேளுங்கள்",
    preview: "முன்பார்வை",
    preview_utterance:
      "முன்பார்வை: ClearWeb உங்களுக்கு உரையை வாசித்துக் காட்டும்.",
    read_aloud_unsupported: "இந்த உலாவியில் வாசிப்பு ஆதரவு இல்லை.",
    speed: "வேகம்",

    auto_read_assistant: "உதவியாளர் பதில்களை தானாக வாசி (விருப்பம்)",
    auto_read_assistant_desc:
      "ClearWeb அரட்டையில் பதிலளிக்கும்போது, அது தானாக வாசிக்கும்.",
    on: "On",
    off: "Off",

    success_title: "அமைப்பு முடிந்தது!",
    success_profile_active: 'உங்கள் சுயவிவரம் "{name}" செயல்படுத்தப்பட்டது',
    success_auto_close: "இந்த சாளரம் தானாக மூடப்படும்...",
    your_settings: "உங்கள் அமைப்புகள்:",

    label_font_size: "எழுத்து அளவு",
    label_link_style: "இணைப்பு பாணி",
    label_contrast: "மாறுபாடு",
    label_language: "மொழி",
    label_read_aloud_speed: "வாசிப்பு வேகம்",
    label_auto_read: "உதவியாளர் பதில்கள் தானாக வாசிப்பு",

    hide_ads_enabled: "விளம்பரங்கள் மறை இயக்கு",
    simplify_language_enabled: "பக்க மொழிபெயர்ப்பு இயக்கப்பட்டது",
    show_breadcrumbs_enabled: "Breadcrumbs இயக்கு",

    live_preview: "நேரடி முன்பார்வை",
    sample_webpage: "மாதிரி வலைப்பக்கம்",
    preview_text_1: "தற்போதைய அமைப்புகளுடன் உரை இவ்வாறு தோன்றும்.",
    preview_link_before: "இது ஒரு",
    preview_sample_link: "மாதிரி இணைப்பு",
    preview_link_after: "இணைப்பு பாணியை காட்டுகிறது.",
    advertisement: "[விளம்பரம்]",
    breadcrumb_home: "முகப்பு",
    breadcrumb_settings: "அமைப்புகள்",
    breadcrumb_accessibility: "அணுகல்தன்மை",
    preview_easy_words: "நீங்கள் தேர்ந்தெடுத்த மொழிக்குப் பக்க மொழிபெயர்ப்பு இயக்கப்பட்டுள்ளது.",
    preview_complex_words: "மொழிபெயர்ப்பு முடக்கப்பட்டுள்ளது; அசல் உரை பாதுகாக்கப்படும்.",
    current_settings: "தற்போதைய அமைப்புகள்:",
    ads: "விளம்பரங்கள்",
    ads_hidden: "மறைக்கப்பட்டது",
    ads_visible: "காணப்படும்",
    breadcrumbs: "Breadcrumbs",
    auto_read_replies: "தானாக வாசிப்பு",

    lang_english: "ஆங்கிலம்",
    lang_chinese: "சீனம்",
    lang_malay: "மலாய்",
    lang_tamil: "தமிழ்",
  },
} as const satisfies Record<LanguageCode, Record<string, string>>;

function getUiStrings(language: LanguageCode): UiStrings {
  return (UI_STRINGS[language] ?? UI_STRINGS.en) as UiStrings;
}

function formatTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function labelFontSize(
  ui: UiStrings,
  value: UserPreferences["fontSize"],
): string {
  if (value === "large") return ui.font_large;
  if (value === "extra-large") return ui.font_extra_large;
  return ui.font_standard;
}

function labelLinkStyle(
  ui: UiStrings,
  value: UserPreferences["linkStyle"],
): string {
  if (value === "underline") return ui.link_underline;
  if (value === "highlight") return ui.link_highlight;
  if (value === "border") return ui.link_bordered;
  return ui.link_default;
}

function labelContrastMode(
  ui: UiStrings,
  value: UserPreferences["contrastMode"],
): string {
  if (value === "high-contrast-yellow") return ui.contrast_high;
  return ui.contrast_standard;
}

const SPEECH_LANG: Record<LanguageCode, string> = {
  en: "en-US",
  zh: "zh-CN",
  ms: "ms-MY",
  ta: "ta-IN",
};

function App() {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [preferences, setPreferences] =
    useState<UserPreferences>(DEFAULT_PREFERENCES);

  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const visualButtonRef = useRef<HTMLButtonElement | null>(null);
  const cognitiveButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Load existing preferences if the user re-opens the options page.
    const loadExistingPreferences = async () => {
      try {
        const stored = await storage.getItem<UserPreferences>(
          "sync:userPreferences",
        );
        if (stored) {
          setPreferences({ ...DEFAULT_PREFERENCES, ...stored });
        }
      } catch (error) {
        console.warn("[Options] Failed to load existing preferences:", error);
      }
    };
    loadExistingPreferences();
  }, []);

  // Auto-focus on mount and step changes
  useEffect(() => {
    if (step === "welcome" && startButtonRef.current) {
      startButtonRef.current.focus();
    } else if (step === "visual" && visualButtonRef.current) {
      visualButtonRef.current.focus();
    } else if (step === "cognitive" && cognitiveButtonRef.current) {
      cognitiveButtonRef.current.focus();
    }
  }, [step]);

  const handleStart = () => {
    setStep("visual");
  };

  const handleVisualNext = () => {
    setStep("cognitive");
  };

  const handleVisualBack = () => {
    setStep("welcome");
  };

  const handleCognitiveNext = async () => {
    // Save to storage using WXT's storage API
    try {
      await storage.setItem("sync:userPreferences", preferences);
      await storage.setItem("sync:onboardingComplete", true);
      console.log("[Options] Preferences saved:", preferences);
      setStep("success");

      // Close tab after 2 seconds
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      console.error("[Options] Failed to save preferences:", error);
    }
  };

  const handleCognitiveBack = () => {
    setStep("visual");
  };

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const showPreview = step === "visual" || step === "cognitive";

  return (
    <div className="min-h-screen bg-yellow-50 flex items-center justify-center p-4 sm:p-8">
      <div className="max-w-[min(68rem,calc(100vw-2rem))] w-full flex flex-row items-start gap-3 lg:gap-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {step === "welcome" && (
            <WelcomeScreen
              onStart={handleStart}
              buttonRef={startButtonRef}
              language={preferences.language}
              onLanguageChange={(lang) =>
                setPreferences((prev) => ({ ...prev, language: lang }))
              }
            />
          )}

          {step === "visual" && (
            <VisualNeedsScreen
              preferences={preferences}
              updatePreference={updatePreference}
              onBack={handleVisualBack}
              onNext={handleVisualNext}
              buttonRef={visualButtonRef}
            />
          )}

          {step === "cognitive" && (
            <CognitiveNeedsScreen
              preferences={preferences}
              updatePreference={updatePreference}
              onBack={handleCognitiveBack}
              onNext={handleCognitiveNext}
              buttonRef={cognitiveButtonRef}
            />
          )}

          {step === "success" && <SuccessScreen preferences={preferences} />}
        </div>

        {/* Preview Window - Only show during questionnaire */}
        {showPreview && <PreviewWindow preferences={preferences} />}
      </div>
    </div>
  );
}

// Screen 1: Welcome
function WelcomeScreen({
  onStart,
  buttonRef,
  language,
  onLanguageChange,
}: {
  onStart: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  language: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
}) {
  const ui = getUiStrings(language);

  return (
    <div className="bg-black rounded-2xl shadow-2xl p-16 text-center border-4 border-yellow-400">
      <div className="mb-8">
        <h1 className="text-6xl font-bold text-yellow-400 mb-4">
          {ui.welcome_title}
        </h1>
        <p className="text-2xl text-yellow-400">{ui.welcome_subtitle}</p>
      </div>

      <div className="max-w-xl mx-auto mb-10 text-left">
        <p className="text-sm font-semibold text-yellow-400 mb-3">
          {ui.language}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {LANGUAGE_OPTIONS.map((opt) => {
            const selected = language === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onLanguageChange(opt.value)}
                aria-pressed={selected}
                className={`p-3 sm:p-4 min-h-24 rounded-xl border-2 transition-all flex flex-col items-center justify-center text-center ${
                  selected
                    ? "border-yellow-400 bg-yellow-400 text-black"
                    : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
                }`}
              >
                <p className="text-base sm:text-lg font-bold leading-tight whitespace-pre-line break-normal">
                  {opt.native}
                </p>
                <p className="mt-1 text-xs sm:text-sm leading-tight max-w-full truncate">
                  {ui[opt.labelKey]}
                </p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-yellow-400">{ui.language_helper}</p>
      </div>

      <button
        ref={buttonRef}
        onClick={onStart}
        className="px-16 py-8 bg-yellow-400 text-black text-3xl font-bold rounded-2xl hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all transform hover:scale-105 border-2 border-black"
        aria-label={ui.start_setup_aria}
      >
        {ui.start_setup}
      </button>

      <p className="mt-8 text-yellow-400 text-lg">{ui.setup_duration}</p>
    </div>
  );
}

// Screen 2: Visual Needs
function VisualNeedsScreen({
  preferences,
  updatePreference,
  onBack,
  onNext,
  buttonRef,
}: {
  preferences: UserPreferences;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => void;
  onBack: () => void;
  onNext: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ui = getUiStrings(preferences.language);

  return (
    <div className="bg-black rounded-2xl shadow-2xl p-12 border-4 border-yellow-400">
      <div className="mb-8">
        <span className="text-yellow-400 font-semibold text-lg">
          {ui.step_1_of_2}
        </span>
        <h2 className="text-4xl font-bold text-yellow-400 mt-2 mb-4">
          {ui.visual_preferences}
        </h2>
        <p className="text-xl text-yellow-400">{ui.visual_preferences_desc}</p>
      </div>

      {/* Font Size Section */}
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-yellow-400 mb-4">
          {ui.font_size}
        </h3>
        <div className="space-y-3">
          <button
            ref={buttonRef}
            onClick={() => updatePreference("fontSize", "standard")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.fontSize === "standard"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.fontSize === "standard"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">Aa</div>
              <div>
                <h4 className="text-xl font-bold">{ui.font_standard}</h4>
                <p className="text-sm">{ui.font_standard_desc}</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference("fontSize", "large")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.fontSize === "large"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.fontSize === "large"}
          >
            <div className="flex items-center gap-3">
              <div className="text-4xl">Aa</div>
              <div>
                <h4 className="text-xl font-bold">{ui.font_large}</h4>
                <p className="text-sm">{ui.font_large_desc}</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference("fontSize", "extra-large")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.fontSize === "extra-large"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.fontSize === "extra-large"}
          >
            <div className="flex items-center gap-3">
              <div className="text-5xl">Aa</div>
              <div>
                <h4 className="text-xl font-bold">{ui.font_extra_large}</h4>
                <p className="text-sm">{ui.font_extra_large_desc}</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Link Style Section */}
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-yellow-400 mb-4">
          {ui.link_style}
        </h3>
        <div className="space-y-3">
          <button
            onClick={() => updatePreference("linkStyle", "default")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === "default"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.linkStyle === "default"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">🔗</div>
              <div>
                <h4 className="text-xl font-bold">{ui.link_default}</h4>
                <p className="text-sm">{ui.link_default_desc}</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference("linkStyle", "underline")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === "underline"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.linkStyle === "underline"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">📏</div>
              <div>
                <h4 className="text-xl font-bold">{ui.link_underline}</h4>
                <p className="text-sm">{ui.link_underline_desc}</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference("linkStyle", "highlight")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === "highlight"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.linkStyle === "highlight"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">✨</div>
              <div>
                <h4 className="text-xl font-bold">{ui.link_highlight}</h4>
                <p className="text-sm">{ui.link_highlight_desc}</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference("linkStyle", "border")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === "border"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.linkStyle === "border"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">⬜</div>
              <div>
                <h4 className="text-xl font-bold">{ui.link_bordered}</h4>
                <p className="text-sm">{ui.link_bordered_desc}</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Contrast Mode Section */}
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-yellow-400 mb-4">
          {ui.contrast_mode}
        </h3>
        <div className="space-y-3">
          <button
            onClick={() => updatePreference("contrastMode", "standard")}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.contrastMode === "standard"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.contrastMode === "standard"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">🌐</div>
              <div>
                <h4 className="text-xl font-bold">{ui.contrast_standard}</h4>
                <p className="text-sm">{ui.contrast_standard_desc}</p>
              </div>
            </div>
          </button>

          <button
            onClick={() =>
              updatePreference("contrastMode", "high-contrast-yellow")
            }
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.contrastMode === "high-contrast-yellow"
                ? "border-yellow-400 bg-yellow-400 text-black"
                : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
            }`}
            aria-pressed={preferences.contrastMode === "high-contrast-yellow"}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">🔆</div>
              <div>
                <h4 className="text-xl font-bold">{ui.contrast_high}</h4>
                <p className="text-sm">{ui.contrast_high_desc}</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full md:w-auto md:min-w-[10.5rem] shrink-0 px-6 py-4 bg-yellow-400 text-black text-lg sm:text-xl font-bold rounded-xl border-2 border-black hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all whitespace-nowrap"
        >
          {ui.back}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="w-full md:flex-1 min-w-0 px-6 sm:px-8 py-4 bg-yellow-400 text-black text-lg sm:text-xl font-bold rounded-xl border-2 border-black hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all whitespace-nowrap"
        >
          {ui.next}
        </button>
      </div>
    </div>
  );
}

// Screen 3: Cognitive Needs
function CognitiveNeedsScreen({
  preferences,
  updatePreference,
  onBack,
  onNext,
  buttonRef,
}: {
  preferences: UserPreferences;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => void;
  onBack: () => void;
  onNext: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ui = getUiStrings(preferences.language);

  const isTtsSupported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // ignore
      }
    };
  }, []);

  const playTtsPreview = () => {
    if (!isTtsSupported) return;
    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(ui.preview_utterance);
    utterance.lang = SPEECH_LANG[preferences.language] ?? "en-US";
    utterance.rate = preferences.ttsRate || 1;
    synth.speak(utterance);
  };

  return (
    <div className="bg-black rounded-2xl shadow-2xl p-12 border-4 border-yellow-400">
      <div className="mb-8">
        <span className="text-yellow-400 font-semibold text-lg">
          {ui.step_2_of_2}
        </span>
        <h2 className="text-4xl font-bold text-yellow-400 mt-2 mb-4">
          {ui.browsing_preferences}
        </h2>
        <p className="text-xl text-yellow-400">
          {ui.browsing_preferences_desc}
        </p>
      </div>

      <div className="space-y-4 mb-8">
        <div className="p-6 rounded-xl border-2 border-yellow-400 hover:border-yellow-300 transition-all bg-yellow-900">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="text-4xl">🌐</div>
              <div>
                <h3 className="text-xl sm:text-2xl font-bold text-yellow-400 whitespace-nowrap">
                  {ui.language}
                </h3>
                <p className="text-yellow-400">{ui.language_card_desc}</p>
              </div>
            </div>
            <div className="text-sm text-yellow-400 sm:text-right shrink-0 whitespace-nowrap">
              {ui.current}{" "}
              <span className="font-semibold">
                {preferences.language.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {LANGUAGE_OPTIONS.map((opt) => {
              const selected = preferences.language === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updatePreference("language", opt.value)}
                  aria-pressed={selected}
                  className={`p-3 sm:p-4 min-h-24 rounded-xl border-2 transition-all flex flex-col items-center justify-center text-center ${
                    selected
                      ? "border-yellow-400 bg-yellow-400 text-black"
                      : "border-yellow-400 text-yellow-400 hover:bg-yellow-900 bg-black"
                  }`}
                >
                  <p className="text-base sm:text-lg font-bold leading-tight whitespace-pre-line break-normal">
                    {opt.native}
                  </p>
                  <p className="mt-1 text-xs sm:text-sm leading-tight max-w-full truncate">
                    {ui[opt.labelKey]}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <label
          className={`flex items-center justify-between p-6 rounded-xl border-2 cursor-pointer transition-all focus-within:ring-4 focus-within:ring-yellow-300 ${
            preferences.hideAds
              ? "border-yellow-400 bg-yellow-400 text-black"
              : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">🚫</div>
            <div>
              <h3 className="text-2xl font-bold">{ui.hide_ads}</h3>
              <p>{ui.hide_ads_desc}</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={preferences.hideAds}
            onChange={(e) => updatePreference("hideAds", e.target.checked)}
            className="w-8 h-8 text-yellow-400 rounded outline-none focus:ring-0 focus:outline-none"
            aria-label={ui.hide_ads}
          />
        </label>

        <label
          className={`flex items-center justify-between p-6 rounded-xl border-2 cursor-pointer transition-all focus-within:ring-4 focus-within:ring-yellow-300 ${
            preferences.simplifyLanguage
              ? "border-yellow-400 bg-yellow-400 text-black"
              : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">📝</div>
            <div>
              <h3 className="text-2xl font-bold">{ui.simplify_language}</h3>
              <p>{ui.simplify_language_desc}</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={preferences.simplifyLanguage}
            onChange={(e) =>
              updatePreference("simplifyLanguage", e.target.checked)
            }
            className="w-8 h-8 text-yellow-400 rounded outline-none focus:ring-0 focus:outline-none"
            aria-label={ui.simplify_language}
          />
        </label>

        <label
          className={`flex items-center justify-between p-6 rounded-xl border-2 cursor-pointer transition-all focus-within:ring-4 focus-within:ring-yellow-300 ${
            preferences.showBreadcrumbs
              ? "border-yellow-400 bg-yellow-400 text-black"
              : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">🗺️</div>
            <div>
              <h3 className="text-2xl font-bold">{ui.show_breadcrumbs}</h3>
              <p>{ui.show_breadcrumbs_desc}</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={preferences.showBreadcrumbs}
            onChange={(e) =>
              updatePreference("showBreadcrumbs", e.target.checked)
            }
            className="w-8 h-8 text-yellow-400 rounded outline-none focus:ring-0 focus:outline-none"
            aria-label={ui.show_breadcrumbs}
          />
        </label>

        <div
          className={`p-6 rounded-xl border-2 transition-all ${
            preferences.ttsRate !== 1 || preferences.autoReadAssistant
              ? "border-yellow-400 bg-yellow-400 text-black"
              : "border-yellow-400 text-yellow-400 hover:bg-yellow-900"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="text-4xl">🔊</div>
              <div>
                <h3 className="text-2xl font-bold">{ui.read_aloud}</h3>
                <p>{ui.read_aloud_desc}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={playTtsPreview}
              disabled={!isTtsSupported}
              className="px-4 py-2 text-sm font-semibold bg-black border-2 border-black rounded-xl shadow-sm hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-yellow-400"
            >
              ▶ {ui.preview}
            </button>
          </div>

          {!isTtsSupported && (
            <p className="mt-2 text-sm">{ui.read_aloud_unsupported}</p>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">{ui.speed}</p>
              <p className="text-sm">
                {ui.current}{" "}
                <span className="font-semibold">{preferences.ttsRate}x</span>
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TTS_RATE_OPTIONS.map((opt) => {
                const selected = preferences.ttsRate === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updatePreference("ttsRate", opt.value)}
                    aria-pressed={selected}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                      selected
                        ? "bg-black text-yellow-400 border-black shadow-sm"
                        : "bg-yellow-900 text-yellow-400 border-yellow-400 hover:bg-yellow-800"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-yellow-400 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">{ui.auto_read_assistant}</p>
              <p className="text-sm">{ui.auto_read_assistant_desc}</p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">
                {preferences.autoReadAssistant ? ui.on : ui.off}
              </span>
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={preferences.autoReadAssistant}
                  onChange={(e) =>
                    updatePreference("autoReadAssistant", e.target.checked)
                  }
                  className="sr-only peer"
                  aria-label={ui.auto_read_assistant}
                />
                <div className="w-14 h-8 bg-black rounded-full peer peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-yellow-300 peer-checked:bg-yellow-400 transition-colors border-2 border-yellow-400"></div>
                <div className="absolute left-1 top-1 w-6 h-6 bg-yellow-400 rounded-full shadow-sm transition-transform peer-checked:translate-x-6 peer-checked:bg-black"></div>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full md:w-auto md:min-w-[10.5rem] shrink-0 px-6 py-4 bg-yellow-400 text-black text-lg sm:text-xl font-bold rounded-xl border-2 border-black hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all whitespace-nowrap"
        >
          {ui.back}
        </button>
        <button
          ref={buttonRef}
          type="button"
          onClick={onNext}
          className="w-full md:flex-1 min-w-0 px-6 sm:px-8 py-4 bg-yellow-400 text-black text-lg sm:text-xl font-bold rounded-xl border-2 border-black hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all whitespace-nowrap"
        >
          {ui.complete_setup}
        </button>
      </div>
    </div>
  );
}

// Screen 4: Success
function SuccessScreen({ preferences }: { preferences: UserPreferences }) {
  const ui = getUiStrings(preferences.language);

  return (
    <div className="bg-black rounded-2xl shadow-2xl p-16 text-center border-4 border-yellow-400">
      <div className="mb-8">
        <div className="text-8xl mb-6">✅</div>
        <h2 className="text-5xl font-bold text-yellow-400 mb-4">
          {ui.success_title}
        </h2>
        <p className="text-2xl text-yellow-400 mb-2">
          {formatTemplate(ui.success_profile_active, {
            name: preferences.profileName,
          })}
        </p>
        <p className="text-lg text-yellow-400">{ui.success_auto_close}</p>
      </div>

      <div className="bg-yellow-400 rounded-xl p-6 text-left border-2 border-black">
        <h3 className="text-xl font-bold text-black mb-3">
          {ui.your_settings}
        </h3>
        <ul className="space-y-2 text-black">
          <li className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
              ✓
            </span>
            {ui.label_font_size}:{" "}
            <strong>{labelFontSize(ui, preferences.fontSize)}</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
              ✓
            </span>
            {ui.label_link_style}:{" "}
            <strong>{labelLinkStyle(ui, preferences.linkStyle)}</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
              ✓
            </span>
            {ui.label_contrast}:{" "}
            <strong>{labelContrastMode(ui, preferences.contrastMode)}</strong>
          </li>
          {preferences.hideAds && (
            <li className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
                ✓
              </span>
              {ui.hide_ads_enabled}
            </li>
          )}
          {preferences.simplifyLanguage && (
            <li className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
                ✓
              </span>
              {ui.simplify_language_enabled}
            </li>
          )}
          {preferences.showBreadcrumbs && (
            <li className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
                ✓
              </span>
              {ui.show_breadcrumbs_enabled}
            </li>
          )}
          <li className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
              ✓
            </span>
            {ui.label_language}:{" "}
            <strong>{preferences.language.toUpperCase()}</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
              ✓
            </span>
            {ui.label_read_aloud_speed}: <strong>{preferences.ttsRate}x</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-black text-yellow-400 rounded-full text-sm font-bold">
              ✓
            </span>
            {ui.label_auto_read}:{" "}
            <strong>{preferences.autoReadAssistant ? ui.on : ui.off}</strong>
          </li>
        </ul>
      </div>
    </div>
  );
}

// Preview Window Component
function PreviewWindow({ preferences }: { preferences: UserPreferences }) {
  const ui = getUiStrings(preferences.language);

  const getPreviewStyles = () => {
    const styles: React.CSSProperties = {};

    // Zoom rate
    if (preferences.fontSize === "large") {
      styles.zoom = 1.25;
    } else if (preferences.fontSize === "extra-large") {
      styles.zoom = 1.5;
    }

    // Contrast mode
    if (preferences.contrastMode === "high-contrast-yellow") {
      styles.backgroundColor = "#000000";
      styles.color = "#FFFF00";
    }

    return styles;
  };

  const getLinkStyles = () => {
    const styles: React.CSSProperties = {
      color:
        preferences.contrastMode === "high-contrast-yellow"
          ? "#FFFF00"
          : "#2563eb",
    };

    if (preferences.linkStyle === "underline") {
      styles.textDecoration = "underline";
    } else if (preferences.linkStyle === "highlight") {
      styles.backgroundColor = "#FEF08A";
      styles.padding = "2px 4px";
    } else if (preferences.linkStyle === "border") {
      styles.border = "2px solid currentColor";
      styles.padding = "2px 4px";
      styles.borderRadius = "4px";
    }

    return styles;
  };

  return (
    <div className="w-[clamp(15rem,26vw,22rem)] bg-white rounded-2xl shadow-2xl p-6 sticky top-8 h-fit self-start border-4 border-yellow-400">
      <h3 className="text-xl font-bold text-gray-900 mb-4">
        {ui.live_preview}
      </h3>

      <div
        className="border-2 border-gray-200 rounded-lg p-4 bg-white"
        style={getPreviewStyles()}
      >
        <h4 className="font-bold mb-2">{ui.sample_webpage}</h4>
        <p className="mb-3">{ui.preview_text_1}</p>

        <p className="mb-3">
          {ui.preview_link_before}{" "}
          <span style={getLinkStyles()}>{ui.preview_sample_link}</span>{" "}
          {ui.preview_link_after}
        </p>

        {!preferences.hideAds && (
          <div
            className="bg-yellow-100 border border-yellow-300 rounded p-2 mb-3 text-xs text-center"
            style={{
              backgroundColor:
                preferences.contrastMode === "high-contrast-yellow"
                  ? "#333"
                  : undefined,
            }}
          >
            {ui.advertisement}
          </div>
        )}

        {preferences.showBreadcrumbs && (
          <div
            className="text-sm mb-2"
            style={{
              color:
                preferences.contrastMode === "high-contrast-yellow"
                  ? "#FFFF00"
                  : "#2563eb",
            }}
          >
            {ui.breadcrumb_home} &gt; {ui.breadcrumb_settings} &gt;{" "}
            {ui.breadcrumb_accessibility}
          </div>
        )}

        <p className="text-sm">
          {preferences.simplifyLanguage
            ? ui.preview_easy_words
            : ui.preview_complex_words}
        </p>
      </div>

      <div className="mt-4 text-sm text-gray-700">
        <p className="font-semibold mb-1 text-gray-900">
          {ui.current_settings}
        </p>
        <ul className="space-y-1">
          <li>
            • {ui.label_font_size}: {labelFontSize(ui, preferences.fontSize)}
          </li>
          <li>
            • {ui.label_link_style}: {labelLinkStyle(ui, preferences.linkStyle)}
          </li>
          <li>
            • {ui.label_contrast}:{" "}
            {labelContrastMode(ui, preferences.contrastMode)}
          </li>
          <li>
            • {ui.ads}: {preferences.hideAds ? ui.ads_hidden : ui.ads_visible}
          </li>
          <li>
            • {ui.simplify_language}:{" "}
            {preferences.simplifyLanguage ? ui.on : ui.off}
          </li>
          <li>
            • {ui.breadcrumbs}: {preferences.showBreadcrumbs ? ui.on : ui.off}
          </li>
          <li>
            • {ui.label_language}: {preferences.language.toUpperCase()}
          </li>
          <li>
            • {ui.label_read_aloud_speed}: {preferences.ttsRate}x
          </li>
          <li>
            • {ui.auto_read_replies}:{" "}
            {preferences.autoReadAssistant ? ui.on : ui.off}
          </li>
        </ul>
      </div>
    </div>
  );
}

export default App;

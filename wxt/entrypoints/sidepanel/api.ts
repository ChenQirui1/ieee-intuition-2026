/**
 * API service for connecting to the backend server
 */

// Production
const API_BASE_URL = "https://ieee-intuition-2026-production.up.railway.app";

//Local development (uncomment for local testing)
//const API_BASE_URL = 'http://127.0.0.1:8000';

export type LanguageCode = "en" | "zh" | "ms" | "ta";

export interface SimplifyResponse {
  ok: boolean;
  url: string;
  page_id: string;
  source_text_hash: string;
  language: LanguageCode;
  model: string;
  outputs: {
    easy_read?: {
      mode: string;
      about: string;
      key_points: string[];
      sections: Array<{
        heading: string;
        bullets: string[];
      }>;
      important_links: Array<{
        label: string;
        url: string;
      }>;
      warnings: string[];
      glossary: Array<{
        term: string;
        simple: string;
      }>;
    };
    checklist?: any;
    step_by_step?: any;
    // Future/backwards-compatible bundle (example: outputs.intelligent.summary/checklist)
    intelligent?: any;
    [key: string]: any;
  };
  simplification_ids: {
    easy_read?: string;
    checklist?: string;
    step_by_step?: string;
    intelligent?: string;
    [key: string]: string | undefined;
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResponse {
  ok: boolean;
  model: string;
  answer: string;
  page_id?: string;
  simplification_id?: string;
}

/**
 * Simplify a webpage URL
 */
export async function simplifyPage(
  url: string,
  mode:
    | "easy_read"
    | "checklist"
    | "step_by_step"
    | "all"
    | "intelligent" = "all",
  language: LanguageCode = "en",
  sessionId?: string,
  forceRegen: boolean = false,
): Promise<SimplifyResponse> {
  console.log("[API] Calling /simplify with:", {
    url,
    mode,
    language,
    sessionId,
  });

  const response = await fetch(`${API_BASE_URL}/simplify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      mode,
      language,
      session_id: sessionId,
      force_regen: forceRegen,
    }),
  });

  console.log("[API] /simplify response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[API] /simplify error:", errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log("[API] /simplify success:", {
    page_id: data.page_id,
    language: data.language,
    has_easy_read: !!data.outputs?.easy_read,
  });

  return data;
}

/**
 * Send a chat message
 */
export async function sendChatMessage(
  url: string,
  message: string,
  history: ChatMessage[] = [],
  options: {
    pageId?: string;
    mode?: "easy_read" | "checklist" | "step_by_step";
    language?: LanguageCode;
    simplificationId?: string;
    sectionId?: string;
    sectionText?: string;
    sessionId?: string;
  } = {},
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: url || undefined,
      page_id: options.pageId,
      mode: options.mode || "easy_read",
      language: options.language || "en",
      simplification_id: options.simplificationId,
      section_id: options.sectionId,
      section_text: options.sectionText,
      message,
      history,
      session_id: options.sessionId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Send a simple text message to text-completion endpoint
 */
export async function sendTextCompletion(
  text: string,
  options: { temperature?: number; language?: LanguageCode } = {},
): Promise<{ ok: boolean; model: string; response: string }> {
  const temperature = options.temperature ?? 0.7;
  const language = options.language;

  console.log(
    "[API] Calling /text-completion with text:",
    text.substring(0, 100),
  );

  const languageSystemPrompt = (() => {
    if (!language) return null;
    if (language === "en") {
      return "Reply in English.";
    }
    if (language === "zh") {
      return "Reply in Simplified Chinese only. Do not reply in English.";
    }
    if (language === "ms") {
      return "Reply in Malay (Bahasa Melayu) only. Do not reply in English.";
    }
    if (language === "ta") {
      return "Reply in Tamil only. Do not reply in English.";
    }
    return null;
  })();

  const response = await fetch(`${API_BASE_URL}/text-completion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(languageSystemPrompt
        ? {
            messages: [
              { role: "system", content: languageSystemPrompt },
              { role: "user", content: text },
            ],
          }
        : { text }),
      temperature,
    }),
  });

  console.log("[API] /text-completion response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[API] /text-completion error:", errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log("[API] /text-completion success");

  return data;
}

/**
 * Generate a short caption for an image URL
 */
export async function sendImageCaption(
  imageUrl: string,
  options: {
    altText?: string;
    language?: LanguageCode;
  } = {},
): Promise<{ ok: boolean; model: string; caption: string }> {
  const response = await fetch(`${API_BASE_URL}/image-caption`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      alt_text: options.altText,
      language: options.language || "en",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Test if the backend server is reachable
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/`, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    console.error("Backend connection test failed:", error);
    return false;
  }
}

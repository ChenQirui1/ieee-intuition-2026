/**
 * API service for connecting to the backend server
 */

export const API_BASE_URL = (
  import.meta.env.WXT_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");
const API_ACCESS_KEY = import.meta.env.WXT_API_ACCESS_KEY || "";

function apiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(API_ACCESS_KEY ? { "X-ClearWeb-Key": API_ACCESS_KEY } : {}),
  };
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(apiHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    // Keep cancellation and the deadline active while the body is read too.
    const body = await response.text();
    if (!response.ok) throw new Error(`API error: ${response.status} - ${body}`);
    return JSON.parse(body) as T;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

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
  signal?: AbortSignal,
): Promise<SimplifyResponse> {
  console.log("[API] Calling /simplify with:", {
    url,
    mode,
    language,
    sessionId,
  });

  const data = await apiFetch<SimplifyResponse>("/simplify", {
    method: "POST",
    signal,
    body: JSON.stringify({
      url,
      mode,
      language,
      session_id: sessionId,
      force_regen: forceRegen,
    }),
  }, 120_000);

  console.log("[API] /simplify success:", {
    page_id: data.page_id,
    language: data.language,
    has_easy_read: !!data.outputs?.easy_read,
  });

  return data;
}

/**
 * Send a simple text message to text-completion endpoint
 */
export async function sendTextCompletion(
  text: string,
  options: {
    temperature?: number;
    language?: LanguageCode;
    signal?: AbortSignal;
  } = {},
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

  const data = await apiFetch<{ ok: boolean; model: string; response: string }>("/text-completion", {
    method: "POST",
    signal: options.signal,
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
    signal?: AbortSignal;
  } = {},
): Promise<{ ok: boolean; model: string; caption: string }> {
  return apiFetch<{ ok: boolean; model: string; caption: string }>("/image-caption", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({
      image_url: imageUrl,
      alt_text: options.altText,
      language: options.language || "en",
    }),
  });


}

/**
 * Test if the backend server is reachable
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await apiFetch<{ ok: boolean }>("/healthz", {
      method: "GET",
    }, 5_000);
    return response.ok;
  } catch (error) {
    console.error("Backend connection test failed:", error);
    return false;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TtsStatus = 'idle' | 'speaking' | 'paused';
type TtsMode = 'speech' | 'audio';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeLang(lang: string): string {
  return (lang || '').trim().toLowerCase();
}

function isInterruptionError(error: unknown): boolean {
  const value = typeof error === 'string' ? error : (error as any)?.error;
  return value === 'canceled' || value === 'cancelled' || value === 'interrupted';
}

function pickBestVoice(voices: SpeechSynthesisVoice[], targetLang: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const normalizedTarget = normalizeLang(targetLang);
  if (!normalizedTarget) return null;

  const base = normalizedTarget.split('-')[0] ?? normalizedTarget;

  const preferLocalThenName = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) => {
    const localDiff = Number(b.localService) - Number(a.localService);
    if (localDiff) return localDiff;
    return a.name.localeCompare(b.name);
  };

  const exact = voices
    .filter((v) => normalizeLang(v.lang) === normalizedTarget)
    .sort(preferLocalThenName);
  if (exact.length) return exact[0] ?? null;

  const prefix = voices
    .filter((v) => normalizeLang(v.lang).startsWith(base))
    .sort(preferLocalThenName);
  if (prefix.length) return prefix[0] ?? null;

  const contains = voices
    .filter((v) => normalizeLang(v.lang).includes(base))
    .sort(preferLocalThenName);
  return contains[0] ?? null;
}

function splitLongText(value: string, maxChars: number): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const breakChars = [' ', '\n', '\t', ',', ';', ':', '，', '；', '：', '、'];
  const parts: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    let breakAt = -1;
    for (const ch of breakChars) {
      const idx = window.lastIndexOf(ch);
      if (idx > breakAt) breakAt = idx;
    }

    // Ensure progress even when there are no whitespace/punctuation breakpoints.
    if (breakAt < 1) breakAt = maxChars;

    const head = remaining.slice(0, breakAt).trim();
    if (head) parts.push(head);
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

function splitIntoChunks(text: string, maxChars: number = 220): string[] {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];

  // Include Chinese punctuation so zh text doesn't become a single huge "sentence".
  const sentenceRegex = /[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g;
  const sentences = cleaned.match(sentenceRegex)?.map((s) => s.trim()).filter(Boolean) ?? [cleaned];
  const units = sentences.flatMap((sentence) => splitLongText(sentence, maxChars));

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!unit) continue;

    const next = current ? `${current} ${unit}` : unit;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = unit;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function toQueue(input: string | string[], maxChars: number): string[] {
  const items = Array.isArray(input) ? input : [input];
  const queue: string[] = [];
  for (const item of items) {
    const cleaned = normalizeText(item);
    if (!cleaned) continue;
    queue.push(...splitIntoChunks(cleaned, maxChars));
  }
  return queue;
}

function buildGoogleTranslateTtsUrl(text: string, lang: string): string {
  const tl = (lang || '').trim() || 'en';
  const params = new URLSearchParams();
  params.set('client', 'gtx');
  params.set('ie', 'UTF-8');
  params.set('tl', tl);
  params.set('q', text);
  return `https://translate.googleapis.com/translate_tts?${params.toString()}`;
}

export function useTts(options: { defaultLang?: string } = {}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const isSupported = useMemo(
    () => !!synth && typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window,
    [synth]
  );

  const [status, setStatus] = useState<TtsStatus>('idle');
  const [rate, setRate] = useState<number>(1);

  const queueRef = useRef<string[]>([]);
  const indexRef = useRef<number>(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const modeRef = useRef<TtsMode>('speech');
  const playTokenRef = useRef<number>(0);
  const langRef = useRef<string>(options.defaultLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US'));
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const voiceLoadDeadlineRef = useRef<number | null>(null);
  const voiceWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isSupported || !synth) return;

    const loadVoices = () => {
      try {
        voicesRef.current = synth.getVoices() || [];
      } catch {
        voicesRef.current = [];
      }
    };

    loadVoices();
    try {
      synth.addEventListener('voiceschanged', loadVoices);
      return () => synth.removeEventListener('voiceschanged', loadVoices);
    } catch {
      // Fallback for browsers that only support the property handler.
      const prev = synth.onvoiceschanged;
      synth.onvoiceschanged = loadVoices;
      return () => {
        synth.onvoiceschanged = prev;
      };
    }
  }, [isSupported, synth]);

  const stop = useCallback(() => {
    if (!isSupported || !synth) return;
    playTokenRef.current += 1;
    if (voiceWaitTimerRef.current) {
      clearTimeout(voiceWaitTimerRef.current);
      voiceWaitTimerRef.current = null;
    }
    voiceLoadDeadlineRef.current = null;

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      try {
        audio.src = '';
        audio.currentTime = 0;
      } catch {
        // ignore
      }
    }

    synth.cancel();
    queueRef.current = [];
    indexRef.current = 0;
    utteranceRef.current = null;
    setStatus('idle');
  }, [isSupported, synth]);

  const speakNext = useCallback(() => {
    if (!isSupported || !synth) return;

    const queue = queueRef.current;
    const idx = indexRef.current;
    if (idx >= queue.length) {
      utteranceRef.current = null;
      setStatus('idle');
      return;
    }

    const requestedLang = langRef.current;
    const normalizedLang = normalizeLang(requestedLang);
    const wantsEnglish = normalizedLang.startsWith('en');
    const voicesNow = voicesRef.current.length ? voicesRef.current : synth.getVoices();
    const hasVoices = Array.isArray(voicesNow) && voicesNow.length > 0;
    const chunk = queue[idx] ?? '';
    const token = playTokenRef.current;

    if (modeRef.current === 'audio') {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      audio.preload = 'auto';
      audio.playbackRate = rate;
      audio.src = buildGoogleTranslateTtsUrl(chunk, requestedLang);

      audio.onended = () => {
        if (playTokenRef.current !== token) return;
        indexRef.current += 1;
        speakNext();
      };
      audio.onerror = () => {
        if (playTokenRef.current !== token) return;
        stop();
      };

      setStatus('speaking');

      void audio.play().catch(() => {
        // Autoplay can be blocked if this isn't triggered by a user gesture.
        if (playTokenRef.current !== token) return;
        stop();
      });
      return;
    }

    // Chrome can lazily load voices. If the user requested a non-English language,
    // wait briefly so we can select the correct voice instead of falling back to English.
    if (!wantsEnglish && !hasVoices) {
      const now = performance.now();
      if (voiceLoadDeadlineRef.current === null) {
        voiceLoadDeadlineRef.current = now + 900;
      }
      if (now < voiceLoadDeadlineRef.current) {
        if (voiceWaitTimerRef.current) clearTimeout(voiceWaitTimerRef.current);
        voiceWaitTimerRef.current = setTimeout(() => {
          voiceWaitTimerRef.current = null;
          speakNext();
        }, 80);
        return;
      }
      voiceLoadDeadlineRef.current = null;
    } else {
      voiceLoadDeadlineRef.current = null;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = requestedLang;
    utterance.rate = rate;

    // Pick a matching voice when available; this improves pronunciation for zh/ms/ta.
    const voices = voicesRef.current.length ? voicesRef.current : synth.getVoices();
    const voice = pickBestVoice(voices || [], requestedLang);

    // If we don't have a matching voice for a non-English language, fall back to Google TTS.
    if (!wantsEnglish && !voice) {
      modeRef.current = 'audio';
      synth.cancel();
      // Play immediately (don't wait for another render).
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      audio.preload = 'auto';
      audio.playbackRate = rate;
      audio.src = buildGoogleTranslateTtsUrl(chunk, requestedLang);

      audio.onended = () => {
        if (playTokenRef.current !== token) return;
        indexRef.current += 1;
        speakNext();
      };
      audio.onerror = () => {
        if (playTokenRef.current !== token) return;
        stop();
      };

      setStatus('speaking');
      void audio.play().catch(() => {
        if (playTokenRef.current !== token) return;
        stop();
      });
      return;
    }

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || requestedLang;
    }

    utterance.onend = () => {
      if (playTokenRef.current !== token) return;
      indexRef.current += 1;
      speakNext();
    };
    utterance.onerror = (event) => {
      if (playTokenRef.current !== token) return;
      // If speech synthesis fails for non-English, try the Google TTS fallback.
      if (isInterruptionError((event as any)?.error)) {
        stop();
        return;
      }
      if (!wantsEnglish) {
        modeRef.current = 'audio';
        synth.cancel();
        // Retry the same chunk via audio.
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;

        audio.preload = 'auto';
        audio.playbackRate = rate;
        audio.src = buildGoogleTranslateTtsUrl(chunk, requestedLang);

        audio.onended = () => {
          if (playTokenRef.current !== token) return;
          indexRef.current += 1;
          speakNext();
        };
        audio.onerror = () => {
          if (playTokenRef.current !== token) return;
          stop();
        };

        setStatus('speaking');
        void audio.play().catch(() => {
          if (playTokenRef.current !== token) return;
          stop();
        });
        return;
      }
      stop();
    };

    utteranceRef.current = utterance;
    setStatus('speaking');
    synth.speak(utterance);
  }, [isSupported, synth, rate, stop]);

  const speak = useCallback(
    (input: string | string[], opts: { lang?: string } = {}) => {
      if (!isSupported || !synth) return false;
      const requestedLang = opts.lang || langRef.current;
      const normalizedLang = normalizeLang(requestedLang);
      const wantsEnglish = normalizedLang.startsWith('en');
      const voices = voicesRef.current.length ? voicesRef.current : synth.getVoices();
      const voice = pickBestVoice(voices || [], requestedLang);

      // Google Translate TTS tends to reject long queries; keep audio chunks smaller.
      const maxChars = !wantsEnglish && !voice ? 180 : 220;
      const queue = toQueue(input, maxChars);
      if (queue.length === 0) return false;

      // Start fresh so repeated clicks behave predictably.
      stop();

      modeRef.current = !wantsEnglish && !voice ? 'audio' : 'speech';

      queueRef.current = queue;
      indexRef.current = 0;
      langRef.current = requestedLang;
      voiceLoadDeadlineRef.current = null;

      speakNext();
      return true;
    },
    [isSupported, synth, speakNext, stop]
  );

  const setLang = useCallback((lang: string) => {
    if (!lang || !lang.trim()) return;
    langRef.current = lang;
  }, []);

  const pause = useCallback(() => {
    if (!isSupported || !synth) return;
    if (status !== 'speaking') return;
    if (modeRef.current === 'audio') {
      try {
        audioRef.current?.pause();
        setStatus('paused');
      } catch {
        // ignore
      }
      return;
    }
    synth.pause();
    setStatus('paused');
  }, [isSupported, synth, status]);

  const resume = useCallback(() => {
    if (!isSupported || !synth) return;
    if (status !== 'paused') return;
    if (modeRef.current === 'audio') {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.playbackRate = rate;
      } catch {
        // ignore
      }
      void audio.play().then(
        () => setStatus('speaking'),
        () => stop()
      );
      return;
    }
    synth.resume();
    setStatus('speaking');
  }, [isSupported, synth, status, rate, stop]);

  useEffect(() => {
    // Keep audio playback rate in sync when the user changes speed.
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.playbackRate = rate;
    } catch {
      // ignore
    }
  }, [rate]);

  useEffect(() => {
    return () => {
      try {
        synth?.cancel();
      } catch {
        // ignore
      }
    };
  }, [synth]);

  return {
    isSupported,
    status,
    rate,
    setRate,
    setLang,
    speak,
    pause,
    resume,
    stop,
  } as const;
}


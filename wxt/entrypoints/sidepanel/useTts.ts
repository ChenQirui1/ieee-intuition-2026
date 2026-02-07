import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TtsStatus = 'idle' | 'speaking' | 'paused';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitIntoChunks(text: string, maxChars: number = 220): string[] {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];

  const sentenceRegex = /[^.!?]+[.!?]+|[^.!?]+$/g;
  const sentences = cleaned.match(sentenceRegex)?.map((s) => s.trim()).filter(Boolean) ?? [cleaned];

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!sentence) continue;

    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = sentence;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function toQueue(input: string | string[]): string[] {
  const items = Array.isArray(input) ? input : [input];
  const queue: string[] = [];
  for (const item of items) {
    const cleaned = normalizeText(item);
    if (!cleaned) continue;
    queue.push(...splitIntoChunks(cleaned));
  }
  return queue;
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
  const langRef = useRef<string>(options.defaultLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US'));

  const stop = useCallback(() => {
    if (!isSupported || !synth) return;
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

    const chunk = queue[idx];
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = langRef.current;
    utterance.rate = rate;

    utterance.onend = () => {
      indexRef.current += 1;
      speakNext();
    };
    utterance.onerror = () => {
      stop();
    };

    utteranceRef.current = utterance;
    setStatus('speaking');
    synth.speak(utterance);
  }, [isSupported, synth, rate, stop]);

  const speak = useCallback(
    (input: string | string[], opts: { lang?: string } = {}) => {
      if (!isSupported || !synth) return false;
      const queue = toQueue(input);
      if (queue.length === 0) return false;

      // Start fresh so repeated clicks behave predictably.
      synth.cancel();

      queueRef.current = queue;
      indexRef.current = 0;
      langRef.current = opts.lang || langRef.current;

      speakNext();
      return true;
    },
    [isSupported, synth, speakNext]
  );

  const pause = useCallback(() => {
    if (!isSupported || !synth) return;
    if (status !== 'speaking') return;
    synth.pause();
    setStatus('paused');
  }, [isSupported, synth, status]);

  const resume = useCallback(() => {
    if (!isSupported || !synth) return;
    if (status !== 'paused') return;
    synth.resume();
    setStatus('speaking');
  }, [isSupported, synth, status]);

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
    speak,
    pause,
    resume,
    stop,
  } as const;
}


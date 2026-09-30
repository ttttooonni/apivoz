import { foldEs } from "./voice-parse";

type SpeechCtor = new () => SpeechRecognitionLike;

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
    length: number;
  }>;
}

export type MicStatus = "ok" | "missing" | "iframe" | "insecure";

function recognitionCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function inEmbeddedFrame(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getMicStatus(): MicStatus {
  if (typeof window === "undefined") return "missing";
  if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return "insecure";
  }
  if (!recognitionCtor()) return "missing";
  if (inEmbeddedFrame()) return "iframe";
  return "ok";
}

export function speechSupported(): boolean {
  return Boolean(recognitionCtor());
}

function readTranscript(event: SpeechResultEvent): { text: string; final: boolean } {
  let text = "";
  let allFinal = true;
  for (let i = 0; i < event.results.length; i += 1) {
    const piece = event.results[i];
    text += `${piece?.[0]?.transcript ?? ""} `;
    if (!piece?.isFinal) allFinal = false;
  }
  return { text: text.replace(/\s+/g, " ").trim(), final: allFinal };
}

export async function unlockMicrophone(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch {
    return "Sin permiso de micrófono.";
  }
}

export function primeSpeech(): void {
  if (typeof window === "undefined") return;
  try {
    const dummy = new SpeechSynthesisUtterance(".");
    dummy.volume = 0;
    dummy.lang = "es-ES";
    window.speechSynthesis.speak(dummy);
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

export function isEcho(heard: string, lastSpoken: string): boolean {
  const a = foldEs(heard);
  if (a.length < 4) return true;
  const b = foldEs(lastSpoken);
  if (!b) return false;
  if (b.includes(a) || a.includes(b.slice(0, Math.min(24, b.length)))) return true;
  if (/\b(no te he oido|di el nombre|di el numero|di la accion|di guarda|modo voz)\b/.test(a)) {
    return true;
  }
  const words = a.split(" ").filter((w) => w.length > 3);
  if (words.length === 0) return true;
  const hits = words.filter((w) => b.includes(w)).length;
  return hits >= Math.ceil(words.length * 0.7);
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Sin permiso de micrófono. Puedes escribir el comando abajo.",
  "service-not-allowed": "Sin permiso de micrófono. Puedes escribir el comando abajo.",
  network: "El dictado necesita conexión. Escribe el comando abajo.",
  "audio-capture": "No encuentro el micrófono. Escribe el comando abajo.",
  "language-not-supported": "Este aparato no dicta en español. Escribe el comando.",
};

export function startDictation(handlers: {
  onTranscript: (text: string, final: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
  lastSpoken?: () => string;
  hold?: boolean;
}): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError("Este navegador no dicta. Escribe el comando abajo.");
    handlers.onEnd();
    return () => {};
  }

  let stopped = false;
  let rec: SpeechRecognitionLike | null = null;
  let lastEmitted = "";

  const stop = () => {
    stopped = true;
    if (!rec) return;
    rec.onend = null;
    rec.onerror = null;
    rec.onresult = null;
    try {
      rec.abort();
    } catch {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    rec = null;
  };

  const attach = () => {
    if (stopped) return;
    rec = new Ctor();
    rec.lang = "es-ES";
    rec.continuous = Boolean(handlers.hold);
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      const { text, final } = readTranscript(event);
      if (!text) return;
      const spoken = handlers.lastSpoken?.() ?? "";
      if (isEcho(text, spoken)) return;
      lastEmitted = text;
      handlers.onTranscript(text, final);
    };

    rec.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "aborted" || stopped) return;
      if (code === "no-speech") return;
      handlers.onError(ERRORS[code] ?? "No se oyó bien. Prueba otra vez o escribe el comando.");
    };

    rec.onend = () => {
      rec = null;
      if (stopped) {
        handlers.onEnd();
        return;
      }
      if (handlers.hold) {
        window.setTimeout(() => {
          if (!stopped) attach();
        }, 160);
        return;
      }
      handlers.onEnd();
    };

    try {
      rec.start();
    } catch {
      if (handlers.hold && !stopped) {
        window.setTimeout(() => {
          if (!stopped) attach();
        }, 400);
        return;
      }
      handlers.onError("No se pudo abrir el micrófono.");
      handlers.onEnd();
    }
  };

  attach();
  return stop;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

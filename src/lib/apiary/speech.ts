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
}

export interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

function recognitionCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return Boolean(recognitionCtor());
}

export function startDictation(handlers: {
  onTranscript: (text: string, final: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError("Este navegador no entiende el dictado. Escribe la frase o usa el micrófono del teclado.");
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = "es-ES";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (event) => {
    let finalText = "";
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i];
      const said = piece?.[0]?.transcript ?? "";
      if (piece?.isFinal) finalText += said;
      else interim += said;
    }
    const text = `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
    if (text) handlers.onTranscript(text, Boolean(finalText) && !interim);
  };

  rec.onerror = (event) => {
    const code = event.error ?? "";
    if (code === "aborted" || code === "no-speech") return;
    if (code === "not-allowed" || code === "service-not-allowed") {
      handlers.onError("Sin permiso de micrófono. En iPhone puedes dictar con el teclado.");
      return;
    }
    handlers.onError("No se oyó bien. Prueba otra vez o escribe la frase.");
  };

  rec.onend = () => handlers.onEnd();

  try {
    rec.start();
  } catch {
    handlers.onError("No se pudo abrir el micrófono.");
    return () => {};
  }

  return () => {
    try {
      rec.onend = null;
      rec.stop();
    } catch {
      /* already stopped */
    }
  };
}

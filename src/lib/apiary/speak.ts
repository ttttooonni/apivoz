export function cancelSpeech(): void {
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const es = voices.filter((item) => item.lang.toLowerCase().startsWith("es"));
  return (
    es.find((item) => /es-ES/i.test(item.lang)) ??
    es[0] ??
    null
  );
}

function waitVoices(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    window.setTimeout(done, 400);
  });
}

export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined" || !text.trim()) return;
  cancelSpeech();
  await waitVoices();
  const line = text.trim();
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.lang = "es-ES";
  utterance.rate = 0.96;
  utterance.pitch = 1;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(keepAlive);
      window.clearTimeout(failsafe);
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    const keepAlive = window.setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        finish();
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 7000);
    const failsafe = window.setTimeout(finish, Math.min(12000, 1400 + line.length * 90));
    window.speechSynthesis.speak(utterance);
  });
}

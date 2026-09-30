import { Mic, Square } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelSpeech,
  newId,
  nowIso,
  primeSpeech,
  reduceSession,
  speak,
  startDictation,
  startSession,
  suggestLot,
  unlockMicrophone,
  useAppMutations,
  useNotebook,
  wait,
  type ColonyAction,
  type HealthRecord,
  type VoiceDraft,
  type VoiceSession,
} from "@/lib/apiary";
import { cn } from "@/lib/utils";

type VoiceModeValue = {
  start: () => void;
};

const VoiceModeContext = createContext<VoiceModeValue>({ start: () => {} });

export function useVoiceMode() {
  return useContext(VoiceModeContext);
}

export function VoiceModeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const start = useCallback(() => {
    void (async () => {
      primeSpeech();
      await unlockMicrophone();
      setOpen(true);
    })();
  }, []);
  return (
    <VoiceModeContext.Provider value={{ start }}>
      {children}
      {open ? <VoiceModeScreen onClose={() => setOpen(false)} /> : null}
    </VoiceModeContext.Provider>
  );
}

export function VoiceModeButton({ className }: { className?: string }) {
  const { start } = useVoiceMode();
  return (
    <Button type="button" size="sm" className={className} onClick={start}>
      <Mic />
      Modo voz
    </Button>
  );
}

export function VoiceModeFab() {
  const { start } = useVoiceMode();
  return (
    <Button
      type="button"
      size="icon"
      aria-label="Modo voz, inspección a manos libres"
      onClick={start}
      className="fixed right-4 z-40 size-14 rounded-full shadow-[var(--shadow-border)] md:hidden bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
    >
      <Mic className="size-6" />
    </Button>
  );
}

function VoiceModeScreen({ onClose }: { onClose: () => void }) {
  const { data } = useNotebook();
  const mutations = useAppMutations();
  const [session, setSession] = useState<VoiceSession>(() => startSession(data));
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const genRef = useRef(0);
  const sessionRef = useRef(session);
  const dataRef = useRef(data);
  const spokenRef = useRef("");
  const stopListen = useRef<(() => void) | null>(null);
  const turnRef = useRef<(said: string) => void>(() => {});
  const listenRef = useRef<() => void>(() => {});
  sessionRef.current = session;
  dataRef.current = data;

  const haltListen = () => {
    stopListen.current?.();
    stopListen.current = null;
    setListening(false);
  };

  const halt = useCallback(() => {
    genRef.current += 1;
    haltListen();
    cancelSpeech();
    setSpeaking(false);
  }, []);

  const persist = useCallback(
    async (draft: Exclude<VoiceDraft, { kind: "unknown" }>) => {
      if (draft.kind === "health") {
        const rows: HealthRecord[] = draft.colonyIds.map((colonyId) => ({
          id: newId(),
          colonyId,
          topic: draft.topic,
          kind: draft.healthKind,
          date: draft.date,
          product: draft.product,
          notes: draft.notes,
          createdAt: nowIso(),
        }));
        await mutations.saveHealthMany.mutateAsync(rows);
      } else if (draft.kind === "action") {
        const action: ColonyAction = {
          id: newId(),
          colonyId: draft.colonyId,
          type: draft.type,
          date: draft.date,
          notes: draft.notes,
          framesKind: draft.framesKind,
          framesQty: draft.framesQty,
          supersQty: draft.supersQty,
          harvestQty: draft.harvestQty,
          moveToApiaryId: draft.moveToApiaryId,
          queenIntroducedAt: draft.type === "change_queen" ? draft.date : undefined,
          queenOrigin: draft.queenOrigin,
          queenRetireReason: draft.queenRetireReason,
          treatmentProduct: draft.treatmentProduct,
          createdAt: nowIso(),
        };
        await mutations.saveAction.mutateAsync(action);
      } else {
        const lot = suggestLot(
          draft.product,
          draft.date,
          dataRef.current.production.map((item) => item.lot),
        );
        await mutations.saveProduction.mutateAsync({
          id: newId(),
          product: draft.product,
          date: draft.date,
          quantity: draft.quantity,
          lot,
          notes: draft.notes,
          createdAt: nowIso(),
        });
      }
    },
    [mutations.saveAction, mutations.saveHealthMany, mutations.saveProduction],
  );

  useEffect(() => {
    const generation = ++genRef.current;
    let lock: WakeLockSentinel | null = null;
    void navigator.wakeLock
      ?.request("screen")
      .then((sent) => {
        if (generation !== genRef.current) {
          void sent.release();
          return;
        }
        lock = sent;
      })
      .catch(() => {});

    const listen = () => {
      if (generation !== genRef.current) return;
      haltListen();
      setListening(true);
      let lastFinal = "";
      stopListen.current = startDictation({
        hold: true,
        lastSpoken: () => spokenRef.current,
        onTranscript: (text, final) => {
          setHeard(text);
          if (!final) return;
          if (text === lastFinal) return;
          lastFinal = text;
          haltListen();
          void handleTurn(text);
        },
        onError: (message) => {
          if (generation !== genRef.current) return;
          setMicNote(message);
          setListening(false);
        },
        onEnd: () => {
          if (generation !== genRef.current) return;
          setListening(false);
        },
      });
    };

    const handleTurn = async (said: string) => {
      if (generation !== genRef.current) return;
      const next = reduceSession(dataRef.current, sessionRef.current, said);
      if (next.persist) {
        try {
          await persist(next.persist);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "No se pudo guardar");
        }
      }
      const shown: VoiceSession = { ...next, persist: undefined };
      sessionRef.current = shown;
      setSession(shown);
      if (generation !== genRef.current) return;
      haltListen();
      setSpeaking(true);
      spokenRef.current = shown.prompt;
      await speak(shown.prompt);
      await wait(500);
      setSpeaking(false);
      if (generation !== genRef.current) return;
      if (shown.done) {
        onClose();
        return;
      }
      listen();
    };

    turnRef.current = (said) => {
      void handleTurn(said);
    };
    listenRef.current = listen;

    const boot = async () => {
      const initial = startSession(dataRef.current);
      sessionRef.current = initial;
      setSession(initial);
      setSpeaking(true);
      spokenRef.current = initial.prompt;
      await speak(initial.prompt);
      await wait(500);
      setSpeaking(false);
      if (generation !== genRef.current) return;
      listen();
    };

    void boot();

    return () => {
      halt();
      void lock?.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    const said = typed.trim();
    if (!said) return;
    setTyped("");
    setHeard(said);
    turnRef.current(said);
  }

  const colony = data.colonies.find((item) => item.id === session.colonyId);
  const apiary = data.apiaries.find((item) => item.id === session.apiaryId);
  const phaseLabel =
    session.phase === "apiary"
      ? "Apiario"
      : session.phase === "colony"
        ? "Colmena"
        : session.phase === "confirm"
          ? "Confirmar"
          : "Acción";

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-background px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Modo voz · {phaseLabel}
      </p>
      {colony ? (
        <p className="mt-4 font-display text-6xl font-medium leading-none tracking-tight">
          {colony.kind === "nuc" ? "N" : ""}
          {colony.number}
        </p>
      ) : (
        <p className="mt-4 font-display text-4xl font-medium tracking-tight">
          {apiary?.name ?? "Inspección"}
        </p>
      )}
      {apiary && colony ? (
        <p className="mt-2 text-lg text-muted-foreground">{apiary.name}</p>
      ) : null}

      <p className="mt-8 max-w-xl text-xl leading-snug text-foreground">{session.prompt}</p>

      <p className="mt-6 min-h-8 text-base text-muted-foreground" aria-live="polite">
        {heard ? `Oí: ${heard}` : listening ? "Escuchando…" : speaking ? "Hablando…" : "Micrófono parado"}
      </p>
      {micNote ? <p className="text-sm text-destructive">{micNote}</p> : null}

      <form onSubmit={submitTyped} className="mt-4">
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Si no oye: escribe y pulsa intro"
          className="h-12 text-base"
          lang="es"
          autoComplete="off"
        />
      </form>

      <div className="mt-auto grid gap-3">
        <div
          className={cn(
            "mx-auto size-4 rounded-full bg-primary transition-opacity duration-200",
            listening ? "opacity-100" : "opacity-20",
          )}
          aria-hidden
        />
        <Button
          type="button"
          variant={listening ? "secondary" : "default"}
          className="h-14 text-base"
          onClick={() => {
            primeSpeech();
            void unlockMicrophone().then(() => listenRef.current());
          }}
        >
          <Mic />
          {listening ? "Escuchando" : "Escuchar"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-14 text-base"
          onClick={() => {
            halt();
            onClose();
          }}
        >
          <Square className="size-5" />
          Salir
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Di «guarda», «siguiente», «cancela» o «salir».
        </p>
      </div>
    </div>
  );
}

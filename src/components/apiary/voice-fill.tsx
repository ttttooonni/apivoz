import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  newId,
  nowIso,
  parseVoice,
  speechSupported,
  startDictation,
  suggestLot,
  useAppMutations,
  useNotebook,
  type ColonyAction,
  type HealthRecord,
  type VoiceDraft,
} from "@/lib/apiary";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Tratamiento de varroa en la colmena 12 con oxálico",
  "Revisé la colmena 4, cría compacta",
  "Coseché 25 kilos de miel",
];

export function VoiceFillButton({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        className={className}
        aria-label={compact ? "Rellenar por voz" : undefined}
        onClick={() => setOpen(true)}
      >
        <Mic />
        {compact ? <span className="sr-only">Dictar</span> : "Dictar"}
      </Button>
      <VoiceFillDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function VoiceFillFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="icon"
        aria-label="Rellenar el cuaderno por voz"
        onClick={() => setOpen(true)}
        className="fixed right-4 z-40 size-12 rounded-full shadow-[var(--shadow-border)] md:hidden bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
      >
        <Mic className="size-5" />
      </Button>
      <VoiceFillDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function VoiceFillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useNotebook();
  const { saveHealthMany, saveAction, saveProduction } = useAppMutations();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const canHear = speechSupported();
  const draft: VoiceDraft | null = transcript.trim() ? parseVoice(transcript, data) : null;

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      setTranscript("");
      setError(null);
      setBusy(false);
    }
  }, [open, stop]);

  function listen() {
    setError(null);
    if (listening) {
      stop();
      return;
    }
    setListening(true);
    stopRef.current = startDictation({
      onTranscript: (text) => setTranscript(text),
      onError: (message) => {
        setError(message);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
  }

  async function confirm() {
    if (!draft || draft.kind === "unknown") return;
    setBusy(true);
    try {
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
        await saveHealthMany.mutateAsync(rows);
        toast.success(rows.length > 1 ? `${rows.length} registros sanitarios` : "Registro sanitario guardado");
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
          queenIntroducedAt: draft.type === "change_queen" ? draft.date : undefined,
          queenOrigin: draft.queenOrigin,
          createdAt: nowIso(),
        };
        await saveAction.mutateAsync(action);
        toast.success("Acción guardada");
      } else {
        const lot = suggestLot(
          draft.product,
          draft.date,
          data.production.map((item) => item.lot),
        );
        await saveProduction.mutateAsync({
          id: newId(),
          product: draft.product,
          date: draft.date,
          quantity: draft.quantity,
          lot,
          notes: draft.notes,
          createdAt: nowIso(),
        });
        toast.success(`Lote ${lot} guardado`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rellenar por voz</DialogTitle>
          <DialogDescription>
            Di el registro como en el colmenar. Se propone el asiento y no se guarda hasta que
            confirmes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Button
            type="button"
            variant={listening ? "destructive" : "default"}
            onClick={listen}
            disabled={!canHear}
            className="h-12"
          >
            {listening ? <Square className="size-4" /> : <Mic className="size-4" />}
            {listening ? "Parar" : canHear ? "Hablar" : "Micrófono no disponible"}
          </Button>
          {!canHear ? (
            <p className="text-sm text-muted-foreground">
              En este visor o en iPhone, escribe la frase o usa el micrófono del teclado.
            </p>
          ) : (
            <p
              className={cn(
                "text-sm",
                listening ? "text-foreground" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {listening ? "Escuchando…" : "Pulsa Hablar. Español."}
            </p>
          )}

          <Textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Tratamiento de varroa en la colmena 12 con oxálico"
            rows={3}
            lang="es"
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {draft?.kind === "unknown" ? (
            <p className="text-sm text-muted-foreground">{draft.hint}</p>
          ) : draft ? (
            <div className="rounded-xl bg-secondary px-4 py-3">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Se va a anotar</p>
              <p className="mt-1 text-sm font-medium">{draft.summary}</p>
            </div>
          ) : (
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {EXAMPLES.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="text-left hover:text-foreground"
                    onClick={() => setTranscript(item)}
                  >
                    «{item}»
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!draft || draft.kind === "unknown" || busy}
            onClick={() => void confirm()}
          >
            {busy ? "Guardando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

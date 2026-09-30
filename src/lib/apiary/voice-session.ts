import { COLONY_KIND_LABEL } from "./labels";
import { coloniesOf, sortColonies } from "./selectors";
import type { Apiary, AppState, Colony } from "./types";
import { foldEs, parseVoice, type VoiceDraft } from "./voice-parse";

export type VoicePhase = "apiary" | "colony" | "action" | "confirm";

export type VoiceControl = "save" | "cancel" | "next" | "prev" | "repeat" | "exit";

export interface VoiceSession {
  phase: VoicePhase;
  apiaryId?: string;
  colonyId?: string;
  draft?: Exclude<VoiceDraft, { kind: "unknown" }>;
  prompt: string;
  persist?: Exclude<VoiceDraft, { kind: "unknown" }>;
  done?: boolean;
}

export function detectControl(raw: string): VoiceControl | null {
  const t = foldEs(raw).replace(/\bpor favor\b/g, "").trim();
  if (!t) return null;
  if (/^(salir|terminar|termina|cierra|cerrar|adios|basta|para modo voz|modo off)$/.test(t)) return "exit";
  if (/^(guarda|guardar|guardalo|anota|anotar|anotalo|si|vale|correcto)$/.test(t)) {
    return "save";
  }
  if (/^(no|cancela|cancelar|espera|olvidalo)$/.test(t)) return "cancel";
  if (/^(siguiente|sigue|pasa|otra|adelante colmena)$/.test(t) || /\bsiguiente colmena\b/.test(t)) {
    return "next";
  }
  if (/^(anterior|atras|vuelve)$/.test(t)) return "prev";
  if (/^(repite|repetir|que has dicho|como)$/.test(t)) return "repeat";
  return null;
}

export function matchApiary(state: AppState, raw: string): Apiary | undefined {
  const t = foldEs(raw);
  const listed = [...state.apiaries].sort((a, b) => foldEs(b.name).length - foldEs(a.name).length);
  return listed.find((item) => {
    const name = foldEs(item.name);
    if (name.length < 3) return false;
    return t.includes(name) || name.includes(t.replace(/^(apiario|el|la|de)\s+/g, "").trim());
  });
}

function onlyColonySwitch(raw: string): boolean {
  const t = foldEs(raw)
    .replace(/\bbarroa\b/g, "varroa")
    .replace(/\b(colmena|nucleo|numero|nº|la|el|apiario)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^\d{1,3}$/.test(t) || /^n\d{1,3}$/.test(t);
}

function coloniesIn(state: AppState, apiaryId?: string): Colony[] {
  if (apiaryId) return coloniesOf(state, apiaryId);
  return sortColonies(state.colonies);
}

function neighbor(state: AppState, apiaryId: string | undefined, colonyId: string | undefined, dir: 1 | -1): Colony | undefined {
  const list = coloniesIn(state, apiaryId);
  if (list.length === 0) return undefined;
  const index = Math.max(0, list.findIndex((item) => item.id === colonyId));
  const next = list[(index + dir + list.length) % list.length];
  return next;
}

export function colonySpoken(colony: Colony): string {
  const kind = COLONY_KIND_LABEL[colony.kind];
  return `${kind} ${colony.number}`;
}

export function apiarySpoken(apiary: Apiary): string {
  return `Apiario ${apiary.name}`;
}

function askColony(apiary: Apiary, count: number): string {
  return `${apiarySpoken(apiary)}, ${count} colonias. Di el número de colmena.`;
}

function askAction(colony: Colony): string {
  return `${colonySpoken(colony)}. Di la acción.`;
}

export function startSession(state: AppState): VoiceSession {
  if (state.apiaries.length === 0) {
    return {
      phase: "apiary",
      prompt: "No hay apiarios. Di salir, o crea uno en la pantalla.",
    };
  }
  if (state.apiaries.length === 1) {
    const apiary = state.apiaries[0];
    const count = coloniesOf(state, apiary.id).length;
    if (count === 0) {
      return {
        phase: "apiary",
        apiaryId: apiary.id,
        prompt: `${apiarySpoken(apiary)}, sin colonias. Di salir, o crea una colmena.`,
      };
    }
    return {
      phase: "colony",
      apiaryId: apiary.id,
      prompt: askColony(apiary, count),
    };
  }
  return {
    phase: "apiary",
    prompt: "Modo voz. Di el nombre del apiario.",
  };
}

export function reduceSession(state: AppState, session: VoiceSession, raw: string): VoiceSession {
  const control = detectControl(raw);

  if (control === "exit") {
    return { ...session, prompt: "Modo voz cerrado.", done: true, persist: undefined };
  }
  if (control === "repeat") {
    return { ...session, persist: undefined };
  }

  if (session.phase === "confirm" && session.draft) {
    if (control === "save") {
      return afterSave(state, session, session.draft);
    }
    if (control === "cancel") {
      const colony = state.colonies.find((item) => item.id === session.colonyId);
      return {
        ...session,
        phase: "action",
        draft: undefined,
        persist: undefined,
        prompt: colony ? `Cancelado. ${askAction(colony)}` : "Cancelado. Di la acción.",
      };
    }
  }

  if (control === "next" || control === "prev") {
    const colony = neighbor(state, session.apiaryId, session.colonyId, control === "next" ? 1 : -1);
    if (!colony) {
      return { ...session, prompt: "No hay más colonias. Di un número o salir.", persist: undefined };
    }
    return {
      phase: "action",
      apiaryId: colony.apiaryId,
      colonyId: colony.id,
      prompt: askAction(colony),
    };
  }

  const ctx = { apiaryId: session.apiaryId, colonyId: session.colonyId };
  const draft = parseVoice(raw, state, ctx);

  if (draft.kind !== "unknown" && !onlyColonySwitch(raw)) {
    if (draft.kind === "production" || hasActionWords(raw) || draft.kind === "health") {
      const colonyId =
        draft.kind === "action" ? draft.colonyId : draft.kind === "health" ? draft.colonyIds[0] : session.colonyId;
      const colony = state.colonies.find((item) => item.id === colonyId);
      return {
        phase: "confirm",
        apiaryId: colony?.apiaryId ?? session.apiaryId,
        colonyId,
        draft,
        prompt: `${draft.summary}. Di guarda o cancela.`,
      };
    }
  }

  const namedApiary = matchApiary(state, raw);
  if (namedApiary && (session.phase === "apiary" || foldEs(raw).includes("apiario"))) {
    const count = coloniesOf(state, namedApiary.id).length;
    if (count === 0) {
      return {
        phase: "colony",
        apiaryId: namedApiary.id,
        prompt: `${apiarySpoken(namedApiary)}, sin colonias. Di otro apiario o salir.`,
      };
    }
    return {
      phase: "colony",
      apiaryId: namedApiary.id,
      prompt: askColony(namedApiary, count),
    };
  }

  if (session.phase === "apiary") {
    return { ...session, prompt: "No reconozco el apiario. Di el nombre.", persist: undefined };
  }

  if (onlyColonySwitch(raw) || session.phase === "colony") {
    if (draft.kind === "unknown") {
      return {
        ...session,
        prompt: draft.hint.replace(/^Di el número.*/, "Di el número de colmena.") || "Di el número de colmena.",
        persist: undefined,
      };
    }
    const colonyId = draft.kind === "action" ? draft.colonyId : draft.kind === "health" ? draft.colonyIds[0] : session.colonyId;
    const colony = state.colonies.find((item) => item.id === colonyId);
    if (session.phase === "colony" && colony && (onlyColonySwitch(raw) || draft.kind === "action" && !hasActionWords(raw))) {
      return {
        phase: "action",
        apiaryId: colony.apiaryId,
        colonyId: colony.id,
        prompt: askAction(colony),
      };
    }
  }

  if (draft.kind === "unknown") {
    return {
      ...session,
      phase: session.colonyId ? "action" : session.phase,
      prompt: draft.hint,
      persist: undefined,
    };
  }

  if (draft.kind === "production") {
    return {
      ...session,
      phase: "confirm",
      draft,
      prompt: `${draft.summary}. Di guarda o cancela.`,
    };
  }

  const colonyId = draft.kind === "action" ? draft.colonyId : draft.colonyIds[0];
  const colony = state.colonies.find((item) => item.id === colonyId);
  return {
    phase: "confirm",
    apiaryId: colony?.apiaryId ?? session.apiaryId,
    colonyId,
    draft,
    prompt: `${draft.summary}. Di guarda o cancela.`,
  };
}

function hasActionWords(raw: string): boolean {
  const t = foldEs(raw);
  return /\b(inspeccion|revise|tratamiento|trate|varroa|nosema|loque|escayolado|velutina|avispa|vigilancia|muestreo|observacion|cuadros|alza|reina|nota|cosech|oxalic|amitraz|formic|dividir|nucleo nuevo|crear nucleo|mover|traslad)\b/.test(
    t,
  );
}

function afterSave(
  state: AppState,
  session: VoiceSession,
  draft: Exclude<VoiceDraft, { kind: "unknown" }>,
): VoiceSession {
  const colonyId = draft.kind === "action" ? draft.colonyId : draft.kind === "health" ? draft.colonyIds[0] : session.colonyId;
  const next = neighbor(state, session.apiaryId, colonyId, 1);
  if (!next || next.id === colonyId) {
    return {
      phase: "colony",
      apiaryId: session.apiaryId,
      persist: draft,
      prompt: "Guardado. Era la última. Di otra colmena o salir.",
    };
  }
  return {
    phase: "action",
    apiaryId: next.apiaryId,
    colonyId: next.id,
    persist: draft,
    prompt: `Guardado. ${askAction(next)}`,
  };
}

import { todayISO } from "./dates";
import { COLONY_KIND_LABEL, formatKg, PRODUCT_LABEL } from "./labels";
import { HEALTH_KIND_LABEL, HEALTH_TOPIC_LABEL } from "./health";
import { sortColonies } from "./selectors";
import type {
  ActionType,
  AppState,
  Colony,
  FrameKind,
  HealthKind,
  HealthTopic,
  ProductKind,
} from "./types";

export type VoiceContext = {
  apiaryId?: string;
  colonyId?: string;
};

export type VoiceDraft =
  | {
      kind: "health";
      colonyIds: string[];
      topic: HealthTopic;
      healthKind: HealthKind;
      product?: string;
      date: string;
      notes?: string;
      summary: string;
    }
  | {
      kind: "action";
      colonyId: string;
      type: ActionType;
      date: string;
      notes?: string;
      framesKind?: FrameKind;
      framesQty?: number;
      supersQty?: number;
      harvestQty?: number;
      queenOrigin?: string;
      queenRetireReason?: string;
      moveToApiaryId?: string;
      treatmentProduct?: string;
      summary: string;
    }
  | {
      kind: "production";
      product: ProductKind;
      quantity: number;
      date: string;
      notes?: string;
      summary: string;
    }
  | {
      kind: "unknown";
      hint: string;
    };

const NUMBER_WORDS: Record<string, string> = {
  un: "1",
  una: "1",
  uno: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
  once: "11",
  doce: "12",
  trece: "13",
  catorce: "14",
  quince: "15",
  dieciseis: "16",
  diecisiete: "17",
  dieciocho: "18",
  diecinueve: "19",
  veinte: "20",
  veintiuno: "21",
  veintiuna: "21",
  veintidos: "22",
  veintitres: "23",
  veinticuatro: "24",
  veinticinco: "25",
  veintiseis: "26",
  veintisiete: "27",
  veintiocho: "28",
  veintinueve: "29",
  treinta: "30",
};

const MONTHS: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

export function foldEs(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,;:()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceNumberWords(text: string): string {
  let out = ` ${text} `;
  const keys = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
  for (const word of keys) {
    out = out.replace(new RegExp(` ${word} `, "g"), ` ${NUMBER_WORDS[word]} `);
  }
  return out.replace(/\s+/g, " ").trim();
}

function parseDate(text: string): string {
  if (/\banteayer\b/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return toISODate(d);
  }
  if (/\bayer\b/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  }
  const named = text.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/,
  );
  if (named) {
    const day = named[1].padStart(2, "0");
    const month = MONTHS[named[2]];
    const year = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }
  return todayISO();
}

function toISODate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function stripNoise(text: string): string {
  return text
    .replace(
      /\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/g,
      " ",
    )
    .replace(/\b(hoy|ayer|anteayer)\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|kilos?|kilogramos?|cuadros?|alzas?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findApiary(state: AppState, text: string) {
  return state.apiaries.find((item) => {
    const name = foldEs(item.name);
    return name.length >= 3 && text.includes(name);
  });
}

function collectNumbers(text: string): string[] {
  const found: string[] = [];
  const re = /\b(?:n|nucleo\s+n?)?(\d{1,3})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    found.push(match[1]);
  }
  const nCodes = text.match(/\bn\s*(\d{1,3})\b/g) ?? [];
  for (const code of nCodes) {
    const num = code.replace(/\D/g, "");
    if (num) found.push(`N${num}`);
  }
  return [...new Set(found)];
}

function matchColonies(
  state: AppState,
  text: string,
  ctx?: VoiceContext,
): { colonies: Colony[]; hint?: string } {
  const named = findApiary(state, text);
  const apiary =
    named ?? (ctx?.apiaryId ? state.apiaries.find((item) => item.id === ctx.apiaryId) : undefined);
  const pool = apiary
    ? state.colonies.filter((item) => item.apiaryId === apiary.id)
    : state.colonies;

  if (/\b(todas|todos|todo el apiario|todo el patio)\b/.test(text)) {
    if (apiary) return { colonies: sortColonies(pool) };
    if (state.apiaries.length === 1) {
      return {
        colonies: sortColonies(state.colonies.filter((item) => item.apiaryId === state.apiaries[0].id)),
      };
    }
    return { colonies: [], hint: "Di el apiario: «todas las de La Dehesa»." };
  }

  const preferNuc = /\bnucleo/.test(text);
  const preferHive = /\bcolmena/.test(text);
  const tokens = collectNumbers(stripNoise(text));
  if (tokens.length === 0) {
    if (ctx?.colonyId) {
      const current = pool.find((item) => item.id === ctx.colonyId) ?? state.colonies.find((item) => item.id === ctx.colonyId);
      if (current) return { colonies: [current] };
    }
    return { colonies: [], hint: "Di el número: «colmena 12» o «núcleo N1»." };
  }

  const matched: Colony[] = [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    const candidates = pool.filter((item) => {
      const num = item.number.replace(/\s+/g, "").toUpperCase();
      if (num === upper || num === `N${token}`) return true;
      if (num.replace(/^N/, "") === token && (preferNuc || item.kind === "nuc")) return true;
      if (num === token) return true;
      return false;
    });
    const narrowed = preferNuc
      ? candidates.filter((item) => item.kind === "nuc")
      : preferHive
        ? candidates.filter((item) => item.kind === "hive")
        : candidates;
    const list = narrowed.length ? narrowed : candidates;
    if (list.length === 1) matched.push(list[0]);
    else if (list.length > 1 && !apiary) {
      return {
        colonies: [],
        hint: `Hay más de una colonia ${token}. Di también el apiario.`,
      };
    } else if (list.length > 0) {
      matched.push(...list);
    }
  }

  const unique = [...new Map(matched.map((item) => [item.id, item])).values()];
  if (unique.length === 0) {
    return {
      colonies: [],
      hint: "No encuentro esa colonia. Di el número tal como está en el cuaderno.",
    };
  }
  return { colonies: unique };
}

function detectProduct(text: string): string | undefined {
  const rules: { re: RegExp; value: string }[] = [
    { re: /oxalic\w*.*(sublim|humo|vapor)/, value: "Ácido oxálico sublimado" },
    { re: /(sublim|humo|vapor).*\boxalic/, value: "Ácido oxálico sublimado" },
    { re: /oxalic\w*.*(gote|jarabe|goteado)/, value: "Ácido oxálico goteado" },
    { re: /oxalic/, value: "Ácido oxálico sublimado" },
    { re: /formic/, value: "Ácido fórmico" },
    { re: /amitraz|apivar/, value: "Amitraz (tiras)" },
    { re: /flumetrin|bayvarol/, value: "Flumetrina (tiras)" },
    { re: /timol|apiguard|thymovar/, value: "Timol" },
    { re: /fluvalinat|apistan/, value: "Tau-fluvalinato" },
  ];
  for (const rule of rules) {
    if (rule.re.test(text)) return rule.value;
  }
  return undefined;
}

function detectTopic(text: string): { topic: HealthTopic; healthKind: HealthKind } | null {
  const sampling = /\b(muestreo|muestra|analisis)\b/.test(text);
  const observation = /\b(observacion|sintoma)\b/.test(text);
  const kind: HealthKind = sampling ? "sampling" : observation ? "observation" : "treatment";
  if (/\bvarroa\b/.test(text)) {
    const asTreatment = /\btratamiento|trate|aplique\b/.test(text) || Boolean(detectProduct(text));
    return { topic: "varroa", healthKind: asTreatment ? "treatment" : kind === "treatment" ? "observation" : kind };
  }
  if (/\bnosema\b/.test(text)) return { topic: "nosema", healthKind: kind };
  if (/\bloque|loque americana|loque europea\b/.test(text)) return { topic: "foulbrood", healthKind: kind };
  if (/\bpollo escayolado|ascosfera|ascosferosis\b/.test(text)) {
    return { topic: "chalkbrood", healthKind: kind };
  }
  if (/\bvelutina|avispa|avispon\b/.test(text)) return { topic: "hornet", healthKind: kind };
  if (/\bvigilancia\b/.test(text)) return { topic: "surveillance", healthKind: "observation" };
  if (/\botro\b/.test(text) && /\b(sanidad|sanitario|tema|incidencia)\b/.test(text)) {
    return { topic: "other", healthKind: kind };
  }
  if (/\btratamiento|trate|aplique|oxalic|amitraz|formic|timol|flumetrin\b/.test(text)) {
    return { topic: "varroa", healthKind: "treatment" };
  }
  return null;
}

function detectProductKind(text: string): ProductKind | null {
  if (/\bmiel\b/.test(text)) return "honey";
  if (/\bpropoleo\b/.test(text)) return "propolis";
  if (/\bpolen\b/.test(text)) return "pollen";
  if (/\bcera\b/.test(text)) return "wax";
  if (/\bjalea\b/.test(text)) return "royal_jelly";
  return null;
}

function parseQuantity(text: string): number | undefined {
  const kg = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|kilogramos?)\b/);
  if (kg) return Number(kg[1].replace(",", "."));
  const plain = text.match(/\b(\d+(?:[.,]\d+)?)\b/);
  if (plain && /\b(cosech|miel|polen|cera|jalea|propole)\b/.test(text)) {
    return Number(plain[1].replace(",", "."));
  }
  return undefined;
}

function colonyLabel(state: AppState, colony: Colony): string {
  const apiary = state.apiaries.find((item) => item.id === colony.apiaryId);
  return `${COLONY_KIND_LABEL[colony.kind]} ${colony.number}${apiary ? ` · ${apiary.name}` : ""}`;
}

function leftoverNotes(original: string): string | undefined {
  const trimmed = original.trim();
  return trimmed ? trimmed : undefined;
}

export function parseVoice(raw: string, state: AppState, ctx?: VoiceContext): VoiceDraft {
  const original = raw.trim();
  if (!original) {
    return {
      kind: "unknown",
      hint: "Di algo como «tratamiento de varroa en la colmena 12 con oxálico».",
    };
  }
  if (state.colonies.length === 0 && state.apiaries.length === 0) {
    return { kind: "unknown", hint: "Primero crea un apiario y una colmena." };
  }

  const text = replaceNumberWords(foldEs(original))
    .replace(/\bbarroa\b/g, "varroa")
    .replace(/\bn[uú]?mero\b/g, " ")
    .replace(/\bnº\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const date = parseDate(text);
  const productKind = detectProductKind(text);
  const qty = parseQuantity(text);
  const wantsHarvest =
    /\b(cosech|extraccion|sala de extraccion)\b/.test(text) ||
    (Boolean(productKind) && qty != null && !/\bcolmena|nucleo\b/.test(text));

  if (wantsHarvest && productKind && qty != null && qty > 0) {
    return {
      kind: "production",
      product: productKind,
      quantity: qty,
      date,
      notes: leftoverNotes(original),
      summary: `${PRODUCT_LABEL[productKind]} · ${formatKg(qty)} · ${date}`,
    };
  }

  const topic = detectTopic(text);
  const { colonies, hint } = matchColonies(state, text, ctx);

  if (topic) {
    if (colonies.length === 0) {
      return { kind: "unknown", hint: hint ?? "Di la colmena para el registro sanitario." };
    }
    const product = detectProduct(text);
    const labels = colonies.map((item) => colonyLabel(state, item)).join(", ");
    return {
      kind: "health",
      colonyIds: colonies.map((item) => item.id),
      topic: topic.topic,
      healthKind: topic.healthKind,
      product,
      date,
      notes: leftoverNotes(original),
      summary: `${HEALTH_TOPIC_LABEL[topic.topic]} · ${HEALTH_KIND_LABEL[topic.healthKind]}${product ? ` · ${product}` : ""} · ${labels} · ${date}`,
    };
  }

  if (colonies.length === 0) {
    return {
      kind: "unknown",
      hint: hint ?? "Prueba: «revisé la colmena 4» o «tratamiento de varroa en la 12 con oxálico».",
    };
  }
  if (colonies.length > 1) {
    return { kind: "unknown", hint: "Para una acción de colonia, di una sola: «inspección en la colmena 4»." };
  }

  const colony = colonies[0];
  const label = colonyLabel(state, colony);

  if (/\bcambio de reina|cambie la reina|reina nueva\b/.test(text)) {
    const origin = text.match(/\borigen\s+([a-z0-9 ]{2,40})/)?.[1]?.trim();
    const reason = text.match(/\bmotivo\s+([a-z0-9 ]{2,40})/)?.[1]?.trim();
    return {
      kind: "action",
      colonyId: colony.id,
      type: "change_queen",
      date,
      notes: leftoverNotes(original),
      queenOrigin: origin,
      queenRetireReason: reason,
      summary: `Cambio de reina · ${label} · ${date}`,
    };
  }

  if (/\b(dividir|division|parti la colmena|particion)\b/.test(text)) {
    return {
      kind: "action",
      colonyId: colony.id,
      type: "split",
      date,
      notes: leftoverNotes(original),
      summary: `Dividir colmena · ${label} · ${date}`,
    };
  }

  if (/\b(crear nucleo|nucleo nuevo|saque un nucleo|hice un nucleo)\b/.test(text)) {
    return {
      kind: "action",
      colonyId: colony.id,
      type: "create_nuc",
      date,
      notes: leftoverNotes(original),
      summary: `Crear núcleo · ${label} · ${date}`,
    };
  }

  if (/\b(mover|traslad|cambio de apiario|la pase)\b/.test(text)) {
    const dest = [...state.apiaries]
      .sort((a, b) => foldEs(b.name).length - foldEs(a.name).length)
      .find((item) => item.id !== colony.apiaryId && foldEs(item.name).length >= 3 && text.includes(foldEs(item.name)));
    return {
      kind: "action",
      colonyId: colony.id,
      type: "move",
      date,
      moveToApiaryId: dest?.id,
      notes: leftoverNotes(original),
      summary: dest
        ? `Mover colmena · ${label} → ${dest.name} · ${date}`
        : `Mover colmena · ${label} · ${date}`,
    };
  }

  const frameMatch = text.match(/\b(\d{1,2})\s+cuadros?\b/);
  if (frameMatch && /\b(anadi|añadi|poner|puse|retir)\b/.test(text)) {
    const qtyFrames = Number(frameMatch[1]);
    const framesKind: FrameKind = /media alza/.test(text) ? "medium" : "standard";
    const type: ActionType = /\bretir/.test(text) ? "remove_frames" : "add_frames";
    return {
      kind: "action",
      colonyId: colony.id,
      type,
      date,
      framesKind,
      framesQty: qtyFrames,
      notes: leftoverNotes(original),
      summary: `${type === "add_frames" ? "Añadir" : "Retirar"} ${qtyFrames} cuadros · ${label} · ${date}`,
    };
  }

  if (/\balza/.test(text)) {
    const n = text.match(/\b(\d{1,2})\s+alzas?\b/);
    const supersQty = n ? Number(n[1]) : 1;
    const type: ActionType = /\bretir/.test(text) ? "remove_super" : "add_super";
    return {
      kind: "action",
      colonyId: colony.id,
      type,
      date,
      supersQty,
      notes: leftoverNotes(original),
      summary: `${type === "add_super" ? "Añadir" : "Retirar"} alza · ${label} · ${date}`,
    };
  }

  if (/\bcosech/.test(text) && qty != null) {
    return {
      kind: "action",
      colonyId: colony.id,
      type: "harvest",
      date,
      harvestQty: qty,
      notes: leftoverNotes(original),
      summary: `Cosecha ${formatKg(qty)} · ${label} · ${date}`,
    };
  }

  const type: ActionType = /\bnota|apunta|recuerda\b/.test(text) ? "note" : "inspection";
  return {
    kind: "action",
    colonyId: colony.id,
    type,
    date,
    notes: leftoverNotes(original),
    summary: `${type === "note" ? "Nota" : "Inspección"} · ${label} · ${date}`,
  };
}

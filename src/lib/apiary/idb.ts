import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type {
  Apiary,
  AppState,
  Colony,
  ColonyAction,
  HealthRecord,
  ProductionRecord,
  Queen,
  YearClose,
} from "./types";
import { APP_ID } from "./types";

/** localStorage key used by the previous fake-IDB layer — keep for migration. */
export const LS_KEY = "mi-apiario:v1";
/** Set after a verified migration; original LS payload is left intact. */
export const LS_MIGRATED_FLAG = "mi-apiario:v1:migrated-to-idb";

/** IndexedDB database name — aligned with APP_ID, not the ZIP scaffold. */
export const DB_NAME = APP_ID;
export const DB_VERSION = 1;

/** Soft warn when usage crosses this fraction of quota (IDB) or byte soft limit (LS). */
const QUOTA_SOFT_RATIO = 0.7;
const LS_SOFT_LIMIT_BYTES = 3_500_000;
const LS_HARD_HINT_BYTES = 5_000_000;

export const STORE_NAMES = [
  "apiaries",
  "colonies",
  "queens",
  "actions",
  "health",
  "production",
  "yearCloses",
] as const;

type StoreName = (typeof STORE_NAMES)[number];

const STORE_KEYS: Record<StoreName, keyof AppState> = {
  apiaries: "apiaries",
  colonies: "colonies",
  queens: "queens",
  actions: "actions",
  health: "health",
  production: "production",
  yearCloses: "yearCloses",
};

interface MiApiarioDB extends DBSchema {
  apiaries: { key: string; value: Apiary };
  colonies: { key: string; value: Colony; indexes: { "by-apiary": string } };
  queens: { key: string; value: Queen; indexes: { "by-colony": string } };
  actions: { key: string; value: ColonyAction; indexes: { "by-colony": string } };
  health: { key: string; value: HealthRecord; indexes: { "by-colony": string } };
  production: { key: string; value: ProductionRecord };
  yearCloses: { key: number; value: YearClose };
}

export type PersistStatus = {
  ok: boolean;
  bytes: number;
  limit: number;
  nearLimit: boolean;
  failed: boolean;
};

export type StoreCounts = Record<StoreName, number>;

let cache: AppState = emptyClone();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let writeDepth = 0;
let persistDirty = false;
let lastBytes = 0;
let lastLimit = LS_HARD_HINT_BYTES;
let lastFailed = false;
let idbOk = false;
let dbPromise: Promise<IDBPDatabase<MiApiarioDB>> | null = null;
let dbInstance: IDBPDatabase<MiApiarioDB> | null = null;
/** Serializes flushes so voice/hive switches always await a settled write. */
let flushChain: Promise<boolean> = Promise.resolve(true);

function emptyClone(): AppState {
  return {
    apiaries: [],
    colonies: [],
    queens: [],
    actions: [],
    health: [],
    production: [],
    yearCloses: [],
  };
}

function cloneState(state: AppState): AppState {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(state);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Normalize a partial/unknown payload into a full AppState (arrays only). */
export function normalizeAppState(parsed: Partial<AppState> | null | undefined): AppState {
  return {
    apiaries: Array.isArray(parsed?.apiaries) ? parsed!.apiaries : [],
    colonies: Array.isArray(parsed?.colonies) ? parsed!.colonies : [],
    queens: Array.isArray(parsed?.queens) ? parsed!.queens : [],
    actions: Array.isArray(parsed?.actions) ? parsed!.actions : [],
    health: Array.isArray(parsed?.health) ? parsed!.health : [],
    production: Array.isArray(parsed?.production) ? parsed!.production : [],
    yearCloses: Array.isArray(parsed?.yearCloses) ? parsed!.yearCloses : [],
  };
}

export function countState(state: AppState): StoreCounts {
  return {
    apiaries: state.apiaries.length,
    colonies: state.colonies.length,
    queens: state.queens.length,
    actions: state.actions.length,
    health: state.health.length,
    production: state.production.length,
    yearCloses: state.yearCloses.length,
  };
}

export function totalCount(counts: StoreCounts): number {
  return STORE_NAMES.reduce((sum, name) => sum + counts[name], 0);
}

export function countsMatch(a: StoreCounts, b: StoreCounts): boolean {
  return STORE_NAMES.every((name) => a[name] === b[name]);
}

export function isEmptyState(state: AppState): boolean {
  return totalCount(countState(state)) === 0;
}

/** Parse the legacy localStorage JSON blob into AppState (pure, testable). */
export function parseLocalStoragePayload(raw: string | null): AppState {
  if (!raw) return emptyClone();
  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return normalizeAppState(parsed);
  } catch {
    return emptyClone();
  }
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && typeof window !== "undefined";
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

async function refreshQuotaEstimate(fallbackBytes: number): Promise<void> {
  lastBytes = fallbackBytes;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === "number") lastBytes = estimate.usage;
      if (typeof estimate.quota === "number" && estimate.quota > 0) {
        lastLimit = estimate.quota;
        return;
      }
    } catch {
      /* keep fallbacks */
    }
  }
  if (!idbOk) {
    lastLimit = LS_HARD_HINT_BYTES;
  }
}

function openDatabase(): Promise<IDBPDatabase<MiApiarioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MiApiarioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("apiaries")) {
          db.createObjectStore("apiaries", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("colonies")) {
          const s = db.createObjectStore("colonies", { keyPath: "id" });
          s.createIndex("by-apiary", "apiaryId");
        }
        if (!db.objectStoreNames.contains("queens")) {
          const s = db.createObjectStore("queens", { keyPath: "id" });
          s.createIndex("by-colony", "colonyId");
        }
        if (!db.objectStoreNames.contains("actions")) {
          const s = db.createObjectStore("actions", { keyPath: "id" });
          s.createIndex("by-colony", "colonyId");
        }
        if (!db.objectStoreNames.contains("health")) {
          const s = db.createObjectStore("health", { keyPath: "id" });
          s.createIndex("by-colony", "colonyId");
        }
        if (!db.objectStoreNames.contains("production")) {
          db.createObjectStore("production", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("yearCloses")) {
          db.createObjectStore("yearCloses", { keyPath: "year" });
        }
      },
    }).then((db) => {
      dbInstance = db;
      return db;
    });
  }
  return dbPromise;
}

async function readAllFromDb(db: IDBPDatabase<MiApiarioDB>): Promise<AppState> {
  const [apiaries, colonies, queens, actions, health, production, yearCloses] = await Promise.all([
    db.getAll("apiaries"),
    db.getAll("colonies"),
    db.getAll("queens"),
    db.getAll("actions"),
    db.getAll("health"),
    db.getAll("production"),
    db.getAll("yearCloses"),
  ]);
  return { apiaries, colonies, queens, actions, health, production, yearCloses };
}

async function clearAndPut<Name extends StoreName>(
  tx: IDBPTransaction<MiApiarioDB, StoreName[], "readwrite">,
  store: Name,
  rows: MiApiarioDB[Name]["value"][],
): Promise<void> {
  const objectStore = tx.objectStore(store);
  await objectStore.clear();
  await Promise.all(rows.map((row) => objectStore.put(row)));
}

async function writeAllToDb(db: IDBPDatabase<MiApiarioDB>, state: AppState): Promise<void> {
  const tx = db.transaction([...STORE_NAMES], "readwrite");
  await clearAndPut(tx, "apiaries", state.apiaries);
  await clearAndPut(tx, "colonies", state.colonies);
  await clearAndPut(tx, "queens", state.queens);
  await clearAndPut(tx, "actions", state.actions);
  await clearAndPut(tx, "health", state.health);
  await clearAndPut(tx, "production", state.production);
  await clearAndPut(tx, "yearCloses", state.yearCloses);
  await tx.done;
}

function loadFromLocalStorage(): AppState {
  if (typeof window === "undefined") return emptyClone();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) lastBytes = byteLength(raw);
    return parseLocalStoragePayload(raw);
  } catch {
    return emptyClone();
  }
}

function persistLocalStorage(state: AppState): boolean {
  if (typeof window === "undefined") {
    lastFailed = false;
    return true;
  }
  try {
    const raw = JSON.stringify(state);
    lastBytes = byteLength(raw);
    lastLimit = LS_HARD_HINT_BYTES;
    window.localStorage.setItem(LS_KEY, raw);
    lastFailed = false;
    return true;
  } catch {
    lastFailed = true;
    return false;
  }
}

function markMigrated(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_MIGRATED_FLAG, new Date().toISOString());
  } catch {
    /* ignore — migration already verified in IDB */
  }
}

/**
 * If IndexedDB is empty and localStorage still has AppState, copy everything
 * into IDB, verify counts, then leave LS untouched (only set a migrated flag).
 * Never deletes LS before verify.
 */
export async function migrateLocalStorageToIdb(
  db: IDBPDatabase<MiApiarioDB>,
  lsState: AppState,
): Promise<{ migrated: boolean; state: AppState }> {
  const existing = await readAllFromDb(db);
  if (!isEmptyState(existing)) {
    return { migrated: false, state: existing };
  }
  if (isEmptyState(lsState)) {
    return { migrated: false, state: existing };
  }

  await writeAllToDb(db, lsState);
  const verified = await readAllFromDb(db);
  if (!countsMatch(countState(lsState), countState(verified))) {
    throw new Error("La migración a IndexedDB no verificó los mismos conteos.");
  }
  markMigrated();
  return { migrated: true, state: verified };
}

async function persistIdb(state: AppState): Promise<boolean> {
  try {
    const db = await openDatabase();
    await writeAllToDb(db, state);
    lastFailed = false;
    idbOk = true;
    await refreshQuotaEstimate(byteLength(JSON.stringify(state)));
    return true;
  } catch {
    lastFailed = true;
    return false;
  }
}

/**
 * Flush cache to IndexedDB (or LS fallback). Queued so voice/hive switches
 * can `await` a settled write before moving on.
 */
async function persistNow(): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    persistDirty = false;
    if (typeof window === "undefined") {
      lastFailed = false;
      return true;
    }
    if (idbOk) {
      const ok = await persistIdb(cache);
      if (ok) return true;
      return persistLocalStorage(cache);
    }
    return persistLocalStorage(cache);
  };
  flushChain = flushChain.then(run, run);
  return flushChain;
}

async function ensureHydrated(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) {
    await hydratePromise;
    return;
  }
  hydratePromise = (async () => {
    if (typeof window === "undefined") {
      cache = emptyClone();
      hydrated = true;
      return;
    }

    const lsState = loadFromLocalStorage();

    if (canUseIndexedDb()) {
      try {
        const db = await openDatabase();
        idbOk = true;
        void requestPersistentStorage();

        const { state } = await migrateLocalStorageToIdb(db, lsState);
        cache = cloneState(state);

        if (isEmptyState(cache) && !isEmptyState(lsState)) {
          const retry = await migrateLocalStorageToIdb(db, lsState);
          cache = cloneState(retry.state);
        }

        await refreshQuotaEstimate(byteLength(JSON.stringify(cache)));
        hydrated = true;
        return;
      } catch {
        idbOk = false;
        dbPromise = null;
      }
    }

    cache = cloneState(lsState);
    lastLimit = LS_HARD_HINT_BYTES;
    hydrated = true;
  })();

  try {
    await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export function isIndexedDbAvailable(): boolean {
  if (!canUseIndexedDb()) return false;
  return idbOk || !hydrated;
}

export function getPersistStatus(): PersistStatus {
  const nearLimit = idbOk
    ? lastLimit > 0 && lastBytes / lastLimit >= QUOTA_SOFT_RATIO
    : lastBytes >= LS_SOFT_LIMIT_BYTES;
  return {
    ok: !lastFailed,
    bytes: lastBytes,
    limit: lastLimit,
    nearLimit,
    failed: lastFailed,
  };
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}

/** Coalesce several writes into a single IndexedDB (or LS fallback) flush. */
export async function runWrite<T>(fn: () => Promise<T> | T): Promise<T> {
  await ensureHydrated();
  writeDepth += 1;
  try {
    return await fn();
  } finally {
    writeDepth -= 1;
    if (writeDepth === 0 && persistDirty) {
      await persistNow();
    }
  }
}

export async function loadState(): Promise<AppState> {
  await ensureHydrated();
  return cloneState(cache);
}

export async function replaceAll(state: AppState): Promise<void> {
  await ensureHydrated();
  cache = cloneState(state);
  await persistNow();
}

export async function putRecord<T>(store: StoreName, row: T): Promise<void> {
  await ensureHydrated();
  const keyName = store === "yearCloses" ? "year" : "id";
  const list = cache[STORE_KEYS[store]] as unknown as Array<Record<string, unknown>>;
  const key = (row as Record<string, unknown>)[keyName];
  const index = list.findIndex((item) => item[keyName] === key);
  if (index >= 0) list[index] = row as Record<string, unknown>;
  else list.push(row as Record<string, unknown>);
  persistDirty = true;
  if (writeDepth === 0) {
    await persistNow();
  }
}

export async function deleteRecord(store: StoreName, id: IDBValidKey): Promise<void> {
  await ensureHydrated();
  switch (store) {
    case "apiaries":
      cache.apiaries = cache.apiaries.filter((item) => item.id !== id);
      break;
    case "colonies":
      cache.colonies = cache.colonies.filter((item) => item.id !== id);
      break;
    case "queens":
      cache.queens = cache.queens.filter((item) => item.id !== id);
      break;
    case "actions":
      cache.actions = cache.actions.filter((item) => item.id !== id);
      break;
    case "health":
      cache.health = cache.health.filter((item) => item.id !== id);
      break;
    case "production":
      cache.production = cache.production.filter((item) => item.id !== id);
      break;
    case "yearCloses":
      cache.yearCloses = cache.yearCloses.filter((item) => item.year !== id);
      break;
  }
  persistDirty = true;
  if (writeDepth === 0) {
    await persistNow();
  }
}

export async function deleteApiaryCascade(_state: AppState, apiaryId: string): Promise<void> {
  await runWrite(() => {
    const colonyIds = new Set(
      cache.colonies.filter((item) => item.apiaryId === apiaryId).map((item) => item.id),
    );
    cache.apiaries = cache.apiaries.filter((item) => item.id !== apiaryId);
    cache.colonies = cache.colonies.filter((item) => item.apiaryId !== apiaryId);
    cache.queens = cache.queens.filter((item) => !colonyIds.has(item.colonyId));
    cache.actions = cache.actions.filter((item) => !colonyIds.has(item.colonyId));
    cache.health = cache.health.filter((item) => !colonyIds.has(item.colonyId));
    persistDirty = true;
  });
}

export async function deleteColonyCascade(_state: AppState, colonyId: string): Promise<void> {
  await runWrite(() => {
    cache.colonies = cache.colonies.filter((item) => item.id !== colonyId);
    cache.queens = cache.queens.filter((item) => item.colonyId !== colonyId);
    cache.actions = cache.actions.filter((item) => item.colonyId !== colonyId);
    cache.health = cache.health.filter((item) => item.colonyId !== colonyId);
    persistDirty = true;
  });
}

export async function upsertYearClose(row: YearClose): Promise<void> {
  await putRecord("yearCloses", row);
}

/** Test helper: reset module singletons (node tests only). */
export async function __resetIdbForTests(): Promise<void> {
  cache = emptyClone();
  hydrated = false;
  hydratePromise = null;
  writeDepth = 0;
  persistDirty = false;
  lastBytes = 0;
  lastLimit = LS_HARD_HINT_BYTES;
  lastFailed = false;
  idbOk = false;
  flushChain = Promise.resolve(true);
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  dbPromise = null;
}

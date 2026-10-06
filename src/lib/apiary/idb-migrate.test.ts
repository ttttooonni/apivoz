import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __resetIdbForTests,
  countState,
  countsMatch,
  DB_NAME,
  isEmptyState,
  isIndexedDbAvailable,
  loadState,
  LS_KEY,
  LS_MIGRATED_FLAG,
  parseLocalStoragePayload,
  putRecord,
  replaceAll,
  runWrite,
} from "./idb.ts";
import type { AppState } from "./types.ts";

function sampleState(): AppState {
  return {
    apiaries: [
      {
        id: "a1",
        name: "Campo",
        location: "Sur",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    colonies: [
      {
        id: "c1",
        apiaryId: "a1",
        kind: "hive",
        number: "1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "c2",
        apiaryId: "a1",
        kind: "nuc",
        number: "2",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    queens: [
      {
        id: "q1",
        colonyId: "c1",
        introducedAt: "2026-01-01",
      },
    ],
    actions: [
      {
        id: "act1",
        colonyId: "c1",
        type: "inspection",
        date: "2026-01-02",
        createdAt: "2026-01-02T10:00:00.000Z",
      },
    ],
    health: [],
    production: [
      {
        id: "p1",
        product: "honey",
        date: "2026-01-03",
        quantity: 12,
        lot: "L1",
        createdAt: "2026-01-03T10:00:00.000Z",
      },
    ],
    yearCloses: [{ year: 2025, hives: 10, nucs: 2, closedAt: "2025-12-31" }],
  };
}

function installLocalStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown; localStorage?: Storage }).window = globalThis;
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("deleteDatabase failed"));
    req.onblocked = () => resolve();
  });
}

afterEach(async () => {
  await __resetIdbForTests();
  await deleteDb();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("parseLocalStoragePayload", () => {
  it("returns empty state for null or invalid JSON", () => {
    assert.equal(isEmptyState(parseLocalStoragePayload(null)), true);
    assert.equal(isEmptyState(parseLocalStoragePayload("{not-json")), true);
  });

  it("fills missing arrays", () => {
    const state = parseLocalStoragePayload(JSON.stringify({ apiaries: [{ id: "a" }] }));
    assert.equal(state.apiaries.length, 1);
    assert.equal(state.colonies.length, 0);
    assert.equal(state.yearCloses.length, 0);
  });
});

describe("countsMatch", () => {
  it("compares store lengths", () => {
    const a = countState(sampleState());
    const b = countState(sampleState());
    assert.equal(countsMatch(a, b), true);
    b.colonies = 0;
    assert.equal(countsMatch(a, b), false);
  });
});

describe("IndexedDB migration from localStorage", () => {
  it("migrates LS data into IDB, verifies counts, leaves LS intact", async () => {
    installLocalStorage();
    const source = sampleState();
    localStorage.setItem(LS_KEY, JSON.stringify(source));

    const loaded = await loadState();
    assert.equal(countsMatch(countState(source), countState(loaded)), true);
    assert.equal(isIndexedDbAvailable(), true);

    // LS payload must still be present after verified migration.
    const raw = localStorage.getItem(LS_KEY);
    assert.ok(raw);
    assert.equal(countsMatch(countState(source), countState(parseLocalStoragePayload(raw))), true);
    assert.ok(localStorage.getItem(LS_MIGRATED_FLAG));

    // Second load uses IDB (still matches).
    await __resetIdbForTests();
    const again = await loadState();
    assert.equal(countsMatch(countState(source), countState(again)), true);
  });

  it("awaits flush so a voice write settles before the next hive switch", async () => {
    installLocalStorage();
    await replaceAll(sampleState());

    await runWrite(async () => {
      await putRecord("actions", {
        id: "act-voice",
        colonyId: "c1",
        type: "note",
        date: "2026-01-04",
        notes: "siguiente colmena",
        createdAt: "2026-01-04T10:00:00.000Z",
      });
    });

    await __resetIdbForTests();
    const loaded = await loadState();
    assert.ok(loaded.actions.some((row) => row.id === "act-voice"));
  });
});

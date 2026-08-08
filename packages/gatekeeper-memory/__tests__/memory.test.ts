import { describe, expect, it } from "vitest";
import {
  MemorySessionImpl,
  MemoryStore,
  describeMemoryAccount,
  describeMemoryVendor,
  parseBankUrl,
  type KvLike,
  type MemoryActionRecord,
} from "../src/memory.js";

function makeKv(): KvLike {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: (key, value) => void map.set(key, structuredClone(value)),
    delete: (key) => void map.delete(key),
    list: function* <T>({ prefix }: { prefix: string }): Iterable<[string, T]> {
      for (const [key, value] of map) {
        if (key.startsWith(prefix)) yield [key, value as T];
      }
    },
  };
}

type SubmittedAction = { id: number; title: string; description: string; autoApprovable?: boolean; tag?: string };

function makeSession(kv: KvLike = makeKv()) {
  const observations: { title: string }[] = [];
  const submitted: SubmittedAction[] = [];
  let disposed = false;
  let time = Date.parse("2026-08-08T10:00:00Z");
  let nextId = 1;
  const store = new MemoryStore(kv);
  const session = new MemorySessionImpl({
    store,
    approvalQueue: {
      authorizeObservation(value: { title: string; description: string }) {
        observations.push(value);
        return Promise.resolve();
      },
      submitAction(id: number, description) {
        submitted.push({
          id,
          title: description.title,
          description: description.description,
          autoApprovable: description.autoApprovable,
          tag: description.actionKind?.tag,
        });
        return Promise.resolve();
      },
      [Symbol.dispose]() {
        disposed = true;
      },
    },
    now: () => (time += 1000),
    randomId: () => `id-${nextId++}`,
  });
  return { session, store, observations, submitted, isDisposed: () => disposed };
}

/** Simulates the DO's applyAction against the same kv. */
function apply(store: MemoryStore, actionId: number) {
  const record = store.getAction(actionId);
  if (!record || record.state !== "pending") throw new Error(`not pending: ${actionId}`);
  if (record.action.type === "remember") {
    store.putEntry(record.action.entry);
  } else {
    store.deleteEntry(record.action.entryId);
  }
  store.putAction({ ...record, state: "applied" } as MemoryActionRecord);
}

describe("gatekeeper-memory", () => {
  it("describes an auto-provisioned, non-singleton vendor", () => {
    expect(describeMemoryVendor()).toMatchObject({
      displayName: "Agent Memory",
      autoProvisionsAccount: true,
      providesAuth: false,
    });
    // No singleton: memory banks must never be ambient-folded into every chat.
    expect(describeMemoryAccount()).not.toHaveProperty("singleton");
  });

  it("parses bank URLs and rejects everything else", () => {
    expect(parseBankUrl("memory://bank/main")).toBe("main");
    expect(parseBankUrl("memory://bank/mascot-1/")).toBe("mascot-1");
    expect(() => parseBankUrl("memory://other/main")).toThrow("Not a memory bank URL");
    expect(() => parseBankUrl("memory://bank/UPPER")).toThrow("Not a memory bank URL");
    expect(() => parseBankUrl("memory://bank/a/b")).toThrow("Not a memory bank URL");
    expect(() => parseBankUrl("https://bank/main")).toThrow("Not a memory bank URL");
    expect(() => parseBankUrl("not a url")).toThrow("Not a valid URL");
  });

  it("remember submits an auto-approvable memory-write action and simulates the write", async () => {
    const { session, store, submitted } = makeSession();
    const entry = await session.remember({ topic: " Circle-Members ", content: "Alice is treasurer" });
    expect(entry).toMatchObject({ id: "id-1", topic: "circle-members", content: "Alice is treasurer" });

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ autoApprovable: true, tag: "memory-write" });
    expect(submitted[0].description).toContain("Alice is treasurer");

    // Simulated: visible via recall before apply, but not committed to entry storage.
    expect(store.getEntry("id-1")).toBeUndefined();
    await expect(session.recall()).resolves.toMatchObject([{ id: "id-1" }]);

    apply(store, submitted[0].id);
    expect(store.getEntry("id-1")).toMatchObject({ content: "Alice is treasurer" });
  });

  it("rejecting an action makes the write disappear from reads", async () => {
    const { session, store, submitted } = makeSession();
    await session.remember({ topic: "t", content: "draft" });
    store.deleteAction(submitted[0].id); // what the DO's rejectAction does
    await expect(session.recall()).resolves.toEqual([]);
  });

  it("remember with id updates, forget deletes, and both record the previous entry", async () => {
    const { session, store, submitted } = makeSession();
    const first = await session.remember({ topic: "t", content: "v1" });
    apply(store, submitted[0].id);

    const updated = await session.remember({ topic: "t", content: "v2", id: first.id });
    expect(updated).toMatchObject({ id: first.id, createdAt: first.createdAt });
    expect(updated.updatedAt > first.updatedAt).toBe(true);
    apply(store, submitted[1].id);
    expect(store.getEntry(first.id)).toMatchObject({ content: "v2" });

    await session.forget(first.id);
    const forgetRecord = store.getAction(submitted[2].id);
    expect(forgetRecord?.action).toMatchObject({ type: "forget", previous: { content: "v2" } });
    apply(store, submitted[2].id);
    expect(store.getEntry(first.id)).toBeUndefined();

    await expect(session.remember({ topic: "t", content: "x", id: "missing" })).rejects.toThrow(
      'No memory entry with id "missing"',
    );
    await expect(session.forget("missing")).rejects.toThrow('No memory entry with id "missing"');
  });

  it("recall filters by topic and query, newest first, and records an observation", async () => {
    const { session, store, submitted, observations } = makeSession();
    await session.remember({ topic: "people", content: "Alice likes Rust" });
    await session.remember({ topic: "people", content: "Bob likes Go" });
    await session.remember({ topic: "plans", content: "September festival" });
    for (const action of submitted) apply(store, action.id);

    await expect(session.recall({ topic: "people" })).resolves.toMatchObject([
      { content: "Bob likes Go" },
      { content: "Alice likes Rust" },
    ]);
    await expect(session.recall({ query: "ALICE" })).resolves.toMatchObject([
      { content: "Alice likes Rust" },
    ]);
    await expect(session.recall({ limit: 1 })).resolves.toHaveLength(1);
    expect(observations.at(-1)?.title).toContain("Recall memories (1 entries)");

    await expect(session.listTopics()).resolves.toMatchObject([
      { topic: "plans", count: 1 },
      { topic: "people", count: 2 },
    ]);
  });

  it("enforces content size and entry count limits", async () => {
    const kv = makeKv();
    const { session, store } = makeSession(kv);
    await expect(
      session.remember({ topic: "t", content: "あ".repeat(3000) }), // 9000 bytes UTF-8
    ).rejects.toThrow("at most 8192 bytes");
    await expect(session.remember({ topic: "t", content: "" })).rejects.toThrow("non-empty");
    await expect(session.remember({ topic: "  ", content: "x" })).rejects.toThrow("must not be empty");

    for (let i = 0; i < 1000; i++) {
      store.putEntry({
        id: `e${i}`,
        topic: "bulk",
        content: "x",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    }
    await expect(session.remember({ topic: "t", content: "one more" })).rejects.toThrow(
      "Memory bank is full",
    );
    // Updating an existing entry is still allowed at the cap.
    await expect(session.remember({ topic: "bulk", content: "updated", id: "e0" })).resolves.toMatchObject(
      { id: "e0" },
    );
  });

  it("disposes the approval queue with the session", () => {
    const { session, isDisposed } = makeSession();
    session[Symbol.dispose]();
    expect(isDisposed()).toBe(true);
  });
});

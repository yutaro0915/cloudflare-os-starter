import {
  DurableObject,
  RpcStub,
  RpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  ActionKind,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ResourceConfiguratorFrame,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type { MemoryEntry, MemorySession } from "./types.js";
import TYPES_CODE from "./types-code.js";

const MEMORY_ICON = {
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='none' stroke='currentColor' stroke-width='20'><path d='M128 40a56 56 0 0 0-56 56v8a40 40 0 0 0 0 72v8a40 40 0 0 0 40 40h16'/><path d='M128 40a56 56 0 0 1 56 56v8a40 40 0 0 1 0 72v8a40 40 0 0 1-40 40h-16'/><path d='M128 40v184'/></svg>",
    ),
};

const MAX_ENTRIES = 1000;
const MAX_CONTENT_BYTES = 8192;
const MAX_TOPIC_LENGTH = 64;

// All writes share one kind so a single auto-approval rule governs the whole bank.
const MEMORY_WRITE_KIND: ActionKind = { tag: "memory-write", label: "Memory writes" };

const MEMORY_RESOURCE: SupportedResource = {
  // grantable deliberately omitted: banks are wired up through Agent definitions
  // only, never offered in the resource picker.
  urlPattern: "memory://bank/*",
  title: "Memory bank",
  description: "A private long-term memory bank for one agent.",
  icon: MEMORY_ICON,
};

export type MemoryAccountProps = {
  accountId: string;
};

export type MemoryBankProps = {
  accountId: string;
  bankId: string;
};

export function describeMemoryVendor(): VendorDescription {
  return {
    displayName: "Agent Memory",
    url: "https://github.com/cloudflare/cloudflare-os-starter",
    logo: MEMORY_ICON,
    color: "#f3eefc",
    tagline: "Private long-term memory banks for agents",
    description:
      "Gives an agent a persistent memory bank it can read and write across chats. " +
      "Each bank is private to its owner; writes are logged as auto-approvable actions.",
    autoProvisionsAccount: true,
    providesAuth: false,
  };
}

export function describeMemoryAccount(): AccountDescription {
  return {
    displayName: "Agent Memory",
    avatar: MEMORY_ICON,
  };
}

// ---------------------------------------------------------------------------------------------
// Storage (backed by the gatekeeper DO's KV; abstracted so tests can use a Map)

export type MemoryAction =
  | { type: "remember"; entry: MemoryEntry; previous?: MemoryEntry }
  | { type: "forget"; entryId: string; previous: MemoryEntry };

export type MemoryActionRecord = {
  id: number;
  action: MemoryAction;
  state: "pending" | "applied" | "reverted";
};

/** The subset of DurableObjectStorage["kv"] this gatekeeper uses. */
export interface KvLike {
  get<T = unknown>(key: string): T | undefined;
  put(key: string, value: unknown): void;
  delete(key: string): void;
  list<T = unknown>(options: { prefix: string }): Iterable<[string, T]>;
}

export class MemoryStore {
  #kv: KvLike;

  constructor(kv: KvLike) {
    this.#kv = kv;
  }

  nextActionId(): number {
    const id = this.#kv.get<number>("seq:action") ?? 1;
    this.#kv.put("seq:action", id + 1);
    return id;
  }

  putAction(record: MemoryActionRecord): void {
    this.#kv.put(`action:${record.id}`, record);
  }

  getAction(id: number): MemoryActionRecord | undefined {
    return this.#kv.get<MemoryActionRecord>(`action:${id}`);
  }

  deleteAction(id: number): void {
    this.#kv.delete(`action:${id}`);
  }

  listActions(): MemoryActionRecord[] {
    return [...this.#kv.list<MemoryActionRecord>({ prefix: "action:" })]
      .map(([, record]) => record)
      .sort((a, b) => a.id - b.id);
  }

  putEntry(entry: MemoryEntry): void {
    this.#kv.put(`entry:${entry.id}`, entry);
  }

  getEntry(id: string): MemoryEntry | undefined {
    return this.#kv.get<MemoryEntry>(`entry:${id}`);
  }

  deleteEntry(id: string): void {
    this.#kv.delete(`entry:${id}`);
  }

  listEntries(): MemoryEntry[] {
    return [...this.#kv.list<MemoryEntry>({ prefix: "entry:" })].map(([, entry]) => entry);
  }

  /**
   * Committed entries with pending (submitted-but-unapplied) actions overlaid, so the
   * session's reads reflect its own writes immediately even though the real mutation
   * only happens in applyAction().
   */
  overlayEntries(): Map<string, MemoryEntry> {
    const entries = new Map<string, MemoryEntry>();
    for (const entry of this.listEntries()) entries.set(entry.id, entry);
    for (const record of this.listActions()) {
      if (record.state !== "pending") continue;
      if (record.action.type === "remember") {
        entries.set(record.action.entry.id, record.action.entry);
      } else {
        entries.delete(record.action.entryId);
      }
    }
    return entries;
  }
}

// ---------------------------------------------------------------------------------------------
// Session

type SessionQueue = Pick<ApprovalQueue, "authorizeObservation" | "submitAction"> &
  Partial<{ [Symbol.dispose](): void }>;

export type MemorySessionDependencies = {
  store: MemoryStore;
  approvalQueue: SessionQueue;
  now?: () => number;
  randomId?: () => string;
};

function normalizeTopic(topic: string): string {
  const normalized = topic.trim().toLowerCase();
  if (!normalized) throw new Error("topic must not be empty.");
  if (normalized.length > MAX_TOPIC_LENGTH) {
    throw new Error(`topic must be at most ${MAX_TOPIC_LENGTH} characters.`);
  }
  return normalized;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

@validateRpc()
export class MemorySessionImpl extends RpcTarget implements MemorySession {
  readonly #store: MemoryStore;
  readonly #approvalQueue: SessionQueue;
  readonly #now: () => number;
  readonly #randomId: () => string;

  constructor(dependencies: MemorySessionDependencies) {
    super();
    this.#store = dependencies.store;
    this.#approvalQueue = dependencies.approvalQueue;
    this.#now = dependencies.now ?? Date.now;
    this.#randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  }

  async #submitWrite(action: MemoryAction, title: string, description: string): Promise<void> {
    const record: MemoryActionRecord = {
      id: this.#store.nextActionId(),
      action,
      state: "pending",
    };
    this.#store.putAction(record);
    try {
      await this.#approvalQueue.submitAction(record.id, {
        title,
        description,
        implementsRevert: true,
        // Writes are simulated (reads overlay pending actions), so the agent can keep
        // working without awaiting the decision. Safe to auto-apply: additive/own-data.
        autoApprovable: true,
        actionKind: MEMORY_WRITE_KIND,
      });
    } catch (error) {
      this.#store.deleteAction(record.id);
      throw error;
    }
  }

  async remember(input: { topic: string; content: string; id?: string }): Promise<MemoryEntry> {
    const topic = normalizeTopic(input.topic);
    const content = input.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("content must be a non-empty string.");
    }
    if (new TextEncoder().encode(content).byteLength > MAX_CONTENT_BYTES) {
      throw new Error(`content must be at most ${MAX_CONTENT_BYTES} bytes.`);
    }

    const entries = this.#store.overlayEntries();
    const previous = input.id !== undefined ? entries.get(input.id) : undefined;
    if (input.id !== undefined && !previous) {
      throw new Error(`No memory entry with id "${input.id}". Omit id to create a new entry.`);
    }
    if (!previous && entries.size >= MAX_ENTRIES) {
      throw new Error(
        `Memory bank is full (${MAX_ENTRIES} entries). forget() something before remembering more.`,
      );
    }

    const nowIso = new Date(this.#now()).toISOString();
    const entry: MemoryEntry = {
      id: previous?.id ?? this.#randomId(),
      topic,
      content,
      createdAt: previous?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    await this.#submitWrite(
      { type: "remember", entry, previous },
      previous ? `Update memory "${topic}"` : `Remember "${topic}"`,
      (previous
        ? `Update memory entry \`${entry.id}\` (topic "${topic}") to:`
        : `Store a new memory entry (topic "${topic}"):`) +
        `\n\n\`\`\`\n${content}\n\`\`\``,
    );
    return entry;
  }

  async recall(options?: {
    query?: string;
    topic?: string;
    limit?: number;
  }): Promise<MemoryEntry[]> {
    const limit = clampLimit(options?.limit);
    const query = options?.query?.trim().toLowerCase();
    const topic = options?.topic === undefined ? undefined : normalizeTopic(options.topic);

    let entries = [...this.#store.overlayEntries().values()];
    if (topic !== undefined) entries = entries.filter((entry) => entry.topic === topic);
    if (query) {
      entries = entries.filter(
        (entry) =>
          entry.topic.toLowerCase().includes(query) || entry.content.toLowerCase().includes(query),
      );
    }
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    entries = entries.slice(0, limit);

    const scope = [
      topic !== undefined ? `topic "${topic}"` : null,
      query ? `query "${query}"` : null,
    ]
      .filter(Boolean)
      .join(", ");
    await this.#approvalQueue.authorizeObservation({
      title: `Recall memories (${entries.length} entries)`,
      description: `Read ${entries.length} memory entries${scope ? ` matching ${scope}` : ""}.`,
    });
    return entries;
  }

  async forget(id: string): Promise<void> {
    const previous = this.#store.overlayEntries().get(id);
    if (!previous) throw new Error(`No memory entry with id "${id}".`);
    await this.#submitWrite(
      { type: "forget", entryId: id, previous },
      `Forget memory "${previous.topic}"`,
      `Delete memory entry \`${id}\` (topic "${previous.topic}"):\n\n\`\`\`\n${previous.content}\n\`\`\``,
    );
  }

  async listTopics(): Promise<{ topic: string; count: number; updatedAt: string }[]> {
    const topics = new Map<string, { topic: string; count: number; updatedAt: string }>();
    for (const entry of this.#store.overlayEntries().values()) {
      const existing = topics.get(entry.topic);
      if (existing) {
        existing.count += 1;
        if (entry.updatedAt > existing.updatedAt) existing.updatedAt = entry.updatedAt;
      } else {
        topics.set(entry.topic, { topic: entry.topic, count: 1, updatedAt: entry.updatedAt });
      }
    }
    const result = [...topics.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.#approvalQueue.authorizeObservation({
      title: `List memory topics (${result.length} topics)`,
      description: `Read the list of memory topics with entry counts.`,
    });
    return result;
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}

// ---------------------------------------------------------------------------------------------
// Gatekeeper DO (one per memory bank)

/** Non-standard verifier method addObserver() calls back on verifiers this vendor minted. */
export interface MemoryVerifierApi extends GatekeeperUserVerifier {
  getMemoryAccountId(): Promise<string>;
}

@validateRpc()
export class MemoryBankDO
  extends DurableObject<Cloudflare.Env, MemoryBankProps>
  implements Gatekeeper<MemorySession>
{
  #store(): MemoryStore {
    return new MemoryStore(this.ctx.storage.kv);
  }

  async describe(): Promise<ResourceDescription> {
    return {
      url: `memory://bank/${this.ctx.props.bankId}`,
      title: `Memory bank (${this.ctx.props.bankId})`,
      snippet: "Private long-term memory this agent can read and write across chats.",
      suggestedBindingName: "MEMORY",
      tsType: "MemorySession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<ActionKind[]> {
    return [MEMORY_WRITE_KIND];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<MemorySession> {
    return new MemorySessionImpl({ store: this.#store(), approvalQueue: approvalQueue.dup() });
  }

  // Observer strategy B: the bank is private to its owning account, so only verifiers
  // minted from the same account may observe reads. Anyone else is rejected outright
  // (v1 has no sharing).
  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as unknown as Fetcher<MemoryVerifierApi>;
    const accountId = await verifier.getMemoryAccountId();
    if (accountId !== this.ctx.props.accountId) {
      throw new Error("This memory bank is private to its owner and cannot be shared.");
    }
  }

  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number): Promise<void> {
    const store = this.#store();
    const record = store.getAction(action);
    if (!record || record.state !== "pending") {
      throw new Error(`No pending memory action ${action}.`);
    }
    if (record.action.type === "remember") {
      store.putEntry(record.action.entry);
    } else {
      store.deleteEntry(record.action.entryId);
    }
    store.putAction({ ...record, state: "applied" });
  }

  async rejectAction(action: number): Promise<void> {
    this.#store().deleteAction(action);
  }

  async revertAction(action: number): Promise<void> {
    const store = this.#store();
    const record = store.getAction(action);
    if (!record || record.state !== "applied") {
      throw new Error(`No applied memory action ${action} to revert.`);
    }
    if (record.action.type === "remember") {
      if (record.action.previous) {
        store.putEntry(record.action.previous);
      } else {
        store.deleteEntry(record.action.entry.id);
      }
    } else {
      store.putEntry(record.action.previous);
    }
    store.putAction({ ...record, state: "reverted" });
  }
}

// ---------------------------------------------------------------------------------------------
// Account / verifier / vendor entrypoints

const BANK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Parses a memory bank URL ("memory://bank/<bankId>") to its bankId. */
export function parseBankUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  const bankId = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (parsed.protocol !== "memory:" || parsed.hostname !== "bank" || !BANK_ID_PATTERN.test(bankId)) {
    throw new Error(
      `Not a memory bank URL: ${url} (expected memory://bank/<bankId>, ` +
        `where <bankId> matches ${BANK_ID_PATTERN}).`,
    );
  }
  return bankId;
}

@validateRpc()
export class MemoryAccount
  extends WorkerEntrypoint<Cloudflare.Env, MemoryAccountProps>
  implements GatekeeperUser
{
  async describe(): Promise<AccountDescription> {
    return describeMemoryAccount();
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [MEMORY_RESOURCE];
  }

  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<MemorySession>>;
    resource: SupportedResource;
  }> {
    const bankId = parseBankUrl(url);
    const props: MemoryBankProps = { accountId: this.ctx.props.accountId, bankId };
    return { class: this.ctx.exports.MemoryBankDO({ props }), resource: MEMORY_RESOURCE };
  }

  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("Memory banks have no configurator; bind them through an Agent definition.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  async revoke(): Promise<void> {}

  reconnect(): Promise<{ url: string }> {
    throw new Error("The memory gatekeeper has no credentials to reconnect.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.MemoryVerifier({
      props: { accountId: this.ctx.props.accountId },
    });
  }
}

@validateRpc()
export class MemoryVerifier
  extends WorkerEntrypoint<Cloudflare.Env, MemoryAccountProps>
  implements GatekeeperUserVerifier, MemoryVerifierApi
{
  async getMemoryAccountId(): Promise<string> {
    return this.ctx.props.accountId;
  }
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env> {
  async describe(): Promise<VendorDescription> {
    return describeMemoryVendor();
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    // Each auto-provisioned account gets a fresh id, baked into the persistent stub;
    // it scopes bank ownership (DO props + verifier) to this user.
    return this.ctx.exports.MemoryAccount({ props: { accountId: crypto.randomUUID() } });
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("The memory gatekeeper is auto-provisioned and has no connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [MEMORY_RESOURCE];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

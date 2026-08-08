const TYPES_CODE = `/** A single remembered item in the agent's memory bank. */
export interface MemoryEntry {
  /** Stable identifier. Pass to forget() to delete this entry. */
  id: string;
  /**
   * Short lowercase topic key, e.g. "circle-members", "event-2026-09".
   * Used to group and filter entries.
   */
  topic: string;
  /** The remembered content. Plain text, up to 8 KB. */
  content: string;
  /** When the entry was created, ISO 8601. */
  createdAt: string;
  /** When the entry was last updated, ISO 8601. */
  updatedAt: string;
}

/**
 * Long-term memory bank private to this agent. Contents persist across chats:
 * anything remembered here can be recalled in future conversations.
 * Prefer recall() at the start of a task and remember() when you learn
 * something worth keeping (facts about people, decisions, preferences,
 * ongoing plans). Keep entries short and factual; update instead of
 * duplicating.
 */
export interface MemorySession {
  /**
   * Save or update a memory. If id is given, overwrites that entry;
   * otherwise creates a new one. Returns the stored entry.
   * content is plain text up to 8 KB; the bank holds at most 1000 entries.
   */
  remember(input: { topic: string; content: string; id?: string }): Promise<MemoryEntry>;

  /**
   * Search memories. Returns entries whose topic or content contains the
   * query (case-insensitive), newest first. Omit query to get the newest
   * entries overall. limit is 1-100, default 20.
   */
  recall(options?: { query?: string; topic?: string; limit?: number }): Promise<MemoryEntry[]>;

  /** Delete one entry by id. Throws if the id does not exist. */
  forget(id: string): Promise<void>;

  /**
   * List the topics in use, with entry counts, most recently updated first.
   * Use this to get an overview before recalling.
   */
  listTopics(): Promise<{ topic: string; count: number; updatedAt: string }[]>;
}
`;

export default TYPES_CODE;

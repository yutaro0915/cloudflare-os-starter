import {
  DurableObject,
  RpcStub,
  RpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
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
import type { NewsArticle, NewsHeadline, NewsSession } from "./types.js";
import TYPES_CODE from "./types-code.js";

const NEWS_ICON = {
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='none' stroke='currentColor' stroke-width='20'><path d='M52 56h120v144H72a20 20 0 0 1-20-20z'/><path d='M172 96h32v84a20 20 0 0 1-20 20'/><path d='M76 92h72M76 124h72M76 156h44'/></svg>",
    ),
};

type NewsSite = "zenn" | "qiita";

type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> &
  Partial<{ [Symbol.dispose](): void }>;

/** fetch()-compatible function, injectable for tests. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function describeNewsVendor(): VendorDescription {
  return {
    displayName: "Tech News",
    url: "https://github.com/cloudflare/cloudflare-os-starter",
    logo: NEWS_ICON,
    color: "#e8f2ff",
    tagline: "Zenn & Qiita headlines and articles",
    description:
      "Read-only Japanese tech news: trending, per-topic, and per-author articles from zenn.dev and qiita.com.",
    autoProvisionsAccount: true,
    providesAuth: false,
  };
}

export function describeNewsAccount(): AccountDescription {
  return {
    displayName: "Tech News",
    avatar: NEWS_ICON,
    singleton: { tsType: "NewsSession" },
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.floor(limit)));
}

async function fetchJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const response = await fetchFn(url, {
    headers: { accept: "application/json", "user-agent": "cloudflare-os-news-gatekeeper" },
  });
  if (!response.ok) {
    throw new Error(`News source request failed (${response.status}): ${url}`);
  }
  return await response.json();
}

/** Minimal tag stripper for Zenn's body_html. Good enough for agent reading. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|pre|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- Zenn (unofficial JSON API, https://zenn.dev/api) ----

type ZennArticle = {
  title: string;
  path: string;
  published_at: string;
  user: { username: string };
};

async function listZenn(fetchFn: FetchFn, query: string, limit: number): Promise<NewsHeadline[]> {
  const data = (await fetchJson(
    fetchFn,
    `https://zenn.dev/api/articles?${query}&count=${limit}`,
  )) as { articles?: ZennArticle[] };
  return (data.articles ?? []).slice(0, limit).map((a) => ({
    source: "zenn" as const,
    title: a.title,
    url: `https://zenn.dev${a.path}`,
    author: a.user.username,
    publishedAt: a.published_at,
  }));
}

// ---- Qiita (official API v2 for tag/author, Atom feed for trending) ----

type QiitaItem = {
  title: string;
  url: string;
  created_at: string;
  body?: string;
  user: { id: string };
};

async function listQiitaApi(fetchFn: FetchFn, query: string, limit: number): Promise<NewsHeadline[]> {
  const data = (await fetchJson(
    fetchFn,
    `https://qiita.com/api/v2/items?query=${encodeURIComponent(query)}&per_page=${limit}`,
  )) as QiitaItem[];
  return data.slice(0, limit).map((item) => ({
    source: "qiita" as const,
    title: item.title,
    url: item.url,
    author: item.user.id,
    publishedAt: item.created_at,
  }));
}

/** Qiita's trending list has no public JSON API; parse its Atom feed. */
export function parseQiitaAtom(xml: string, limit: number): NewsHeadline[] {
  const headlines: NewsHeadline[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const url = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    const author = entry.match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1];
    const publishedAt = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1];
    if (!title || !url || !publishedAt) continue;
    headlines.push({
      source: "qiita",
      title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(),
      url,
      author: author?.trim() ?? "",
      publishedAt,
    });
    if (headlines.length >= limit) break;
  }
  return headlines;
}

async function listQiitaTrending(fetchFn: FetchFn, limit: number): Promise<NewsHeadline[]> {
  const response = await fetchFn("https://qiita.com/popular-items/feed", {
    headers: { "user-agent": "cloudflare-os-news-gatekeeper" },
  });
  if (!response.ok) {
    throw new Error(`Qiita trending feed request failed (${response.status}).`);
  }
  return parseQiitaAtom(await response.text(), limit);
}

@validateRpc()
export class NewsSessionImpl extends RpcTarget implements NewsSession {
  readonly #approvalQueue: ObservationQueue;
  readonly #fetch: FetchFn;

  constructor(approvalQueue: ObservationQueue, fetchFn: FetchFn = (url, init) => fetch(url, init)) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#fetch = fetchFn;
  }

  async #observe(title: string, description: string): Promise<void> {
    await this.#approvalQueue.authorizeObservation({ title, description });
  }

  async listTrending(options?: { site?: NewsSite; limit?: number }): Promise<NewsHeadline[]> {
    const limit = clampLimit(options?.limit);
    const site = options?.site;
    let headlines: NewsHeadline[];
    if (site === "zenn") {
      headlines = await listZenn(this.#fetch, "order=daily", limit);
    } else if (site === "qiita") {
      headlines = await listQiitaTrending(this.#fetch, limit);
    } else {
      const [zenn, qiita] = await Promise.all([
        listZenn(this.#fetch, "order=daily", limit),
        listQiitaTrending(this.#fetch, limit),
      ]);
      headlines = [];
      for (let i = 0; i < Math.max(zenn.length, qiita.length); i++) {
        if (zenn[i]) headlines.push(zenn[i]);
        if (qiita[i]) headlines.push(qiita[i]);
      }
    }
    await this.#observe(
      `Read trending tech news (${headlines.length} articles)`,
      `Read the current ${site ?? "Zenn + Qiita"} trending article list (titles, authors, URLs).`,
    );
    return headlines;
  }

  async listTopic(site: NewsSite, topic: string, options?: { limit?: number }): Promise<NewsHeadline[]> {
    const limit = clampLimit(options?.limit);
    const headlines =
      site === "zenn"
        ? await listZenn(this.#fetch, `topicname=${encodeURIComponent(topic)}&order=latest`, limit)
        : await listQiitaApi(this.#fetch, `tag:${topic}`, limit);
    await this.#observe(
      `Read ${site} topic "${topic}" (${headlines.length} articles)`,
      `Read the latest article list for topic "${topic}" on ${site} (titles, authors, URLs).`,
    );
    return headlines;
  }

  async listAuthor(site: NewsSite, username: string, options?: { limit?: number }): Promise<NewsHeadline[]> {
    const limit = clampLimit(options?.limit);
    const headlines =
      site === "zenn"
        ? await listZenn(this.#fetch, `username=${encodeURIComponent(username)}`, limit)
        : await listQiitaApi(this.#fetch, `user:${username}`, limit);
    await this.#observe(
      `Read ${site} author "${username}" (${headlines.length} articles)`,
      `Read the latest article list by ${site} user "${username}" (titles, URLs).`,
    );
    return headlines;
  }

  async readArticle(url: string): Promise<NewsArticle> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Not a valid URL: ${url}`);
    }

    let article: NewsArticle;
    if (parsed.hostname === "zenn.dev") {
      // Article pages look like /:username/articles/:slug
      const match = parsed.pathname.match(/^\/([^/]+)\/articles\/([^/]+)\/?$/);
      if (!match) throw new Error(`Not a Zenn article URL: ${url}`);
      const data = (await fetchJson(
        this.#fetch,
        `https://zenn.dev/api/articles/${encodeURIComponent(match[2])}`,
      )) as {
        article?: {
          title: string;
          body_html?: string;
          published_at?: string;
          user?: { username?: string };
        };
      };
      if (!data.article) throw new Error(`Zenn article not found: ${url}`);
      article = {
        title: data.article.title,
        url,
        author: data.article.user?.username ?? match[1],
        publishedAt: data.article.published_at,
        body: htmlToText(data.article.body_html ?? ""),
      };
    } else if (parsed.hostname === "qiita.com") {
      // Article pages look like /:username/items/:itemId
      const match = parsed.pathname.match(/^\/[^/]+\/items\/([0-9a-f]+)\/?$/);
      if (!match) throw new Error(`Not a Qiita article URL: ${url}`);
      const item = (await fetchJson(
        this.#fetch,
        `https://qiita.com/api/v2/items/${match[1]}`,
      )) as QiitaItem;
      article = {
        title: item.title,
        url: item.url,
        author: item.user.id,
        publishedAt: item.created_at,
        body: item.body ?? "",
      };
    } else {
      throw new Error(`Unsupported article host: ${parsed.hostname} (only zenn.dev and qiita.com).`);
    }

    await this.#observe(
      `Read article: ${article.title}`,
      `Read the full text of ${article.url} (${article.body.length} characters).`,
    );
    return article;
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}

@validateRpc()
export class CustomGatekeeper extends DurableObject<Cloudflare.Env> implements Gatekeeper<NewsSession> {
  async describe(): Promise<ResourceDescription> {
    return {
      url: "news://zenn-qiita",
      title: "Tech News (Zenn & Qiita)",
      snippet: "Read-only trending, per-topic, and per-author Japanese tech news.",
      suggestedBindingName: "NEWS",
      tsType: "NewsSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<[]> {
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<NewsSession> {
    return new NewsSessionImpl(approvalQueue.dup());
  }

  // All data served here is public (zenn.dev / qiita.com), so every observer is
  // acceptable and observer tracking can be a no-op (observer strategy D).
  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {}
  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number): Promise<void> {
    throw new Error(`Tech News gatekeeper has no actions (${action}).`);
  }

  async rejectAction(_action: number): Promise<void> {}

  async revertAction(_action: number): Promise<void> {
    throw new Error("Tech News gatekeeper has no actions to revert.");
  }
}

@validateRpc()
export class CustomAccount extends WorkerEntrypoint<Cloudflare.Env> implements GatekeeperUser {
  async describe(): Promise<AccountDescription> {
    return describeNewsAccount();
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<NewsSession>>> {
    return this.ctx.exports.CustomGatekeeper({});
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  getGatekeeperClassFor(_url: string): never {
    throw new Error("Tech News gatekeeper has no URL-addressed resources.");
  }

  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("Tech News gatekeeper has no URL-addressed resources.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  async revoke(): Promise<void> {}

  reconnect(): Promise<{ url: string }> {
    throw new Error("Tech News gatekeeper has no credentials to reconnect.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.CustomVerifier({});
  }
}

@validateRpc()
export class CustomVerifier extends WorkerEntrypoint<Cloudflare.Env> implements GatekeeperUserVerifier {
  verify(): void {}
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env> {
  async describe(): Promise<VendorDescription> {
    return describeNewsVendor();
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    return this.ctx.exports.CustomAccount({});
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("Tech News gatekeeper is auto-provisioned and has no connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

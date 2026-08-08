import { describe, expect, it } from "vitest";
import {
  NewsSessionImpl,
  describeNewsAccount,
  describeNewsVendor,
  parseQiitaAtom,
} from "../src/custom.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function makeSession(routes: Record<string, () => Response>) {
  const observations: { title: string; description: string }[] = [];
  let disposed = false;
  const session = new NewsSessionImpl(
    {
      authorizeObservation(value: { title: string; description: string }) {
        observations.push(value);
        return Promise.resolve();
      },
      [Symbol.dispose]() {
        disposed = true;
      },
    },
    (url: string) => {
      for (const [prefix, make] of Object.entries(routes)) {
        if (url.startsWith(prefix)) return Promise.resolve(make());
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    },
  );
  return { session, observations, isDisposed: () => disposed };
}

describe("custom-gatekeeper (Tech News)", () => {
  it("describes an auto-provisioned singleton", () => {
    expect(describeNewsVendor()).toMatchObject({
      displayName: "Tech News",
      autoProvisionsAccount: true,
      providesAuth: false,
    });
    expect(describeNewsAccount()).toMatchObject({
      displayName: "Tech News",
      singleton: { tsType: "NewsSession" },
    });
  });

  it("lists Zenn trending and authorizes the observation", async () => {
    const { session, observations, isDisposed } = makeSession({
      "https://zenn.dev/api/articles?order=daily": () =>
        jsonResponse({
          articles: [
            {
              title: "LLM の話",
              path: "/alice/articles/abc123",
              published_at: "2026-08-08T09:00:00+09:00",
              user: { username: "alice" },
            },
          ],
        }),
    });

    await expect(session.listTrending({ site: "zenn", limit: 5 })).resolves.toEqual([
      {
        source: "zenn",
        title: "LLM の話",
        url: "https://zenn.dev/alice/articles/abc123",
        author: "alice",
        publishedAt: "2026-08-08T09:00:00+09:00",
      },
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0].title).toContain("trending");

    session[Symbol.dispose]();
    expect(isDisposed()).toBe(true);
  });

  it("lists Qiita topic articles via the API", async () => {
    const { session, observations } = makeSession({
      "https://qiita.com/api/v2/items?query=tag%3Allm": () =>
        jsonResponse([
          {
            title: "RAG 入門",
            url: "https://qiita.com/bob/items/0123456789abcdef0123",
            created_at: "2026-08-07T12:00:00+09:00",
            user: { id: "bob" },
          },
        ]),
    });

    const result = await session.listTopic("qiita", "llm", { limit: 10 });
    expect(result).toEqual([
      {
        source: "qiita",
        title: "RAG 入門",
        url: "https://qiita.com/bob/items/0123456789abcdef0123",
        author: "bob",
        publishedAt: "2026-08-07T12:00:00+09:00",
      },
    ]);
    expect(observations[0].title).toContain('"llm"');
  });

  it("parses Qiita's trending Atom feed", () => {
    const xml = `<?xml version="1.0"?><feed>
      <entry>
        <id>tag:qiita.com,2005:PublicArticle/1</id>
        <published>2026-08-08T05:00:00+09:00</published>
        <link rel="alternate" type="text/html" href="https://qiita.com/carol/items/aaaa"/>
        <title>A &amp; B</title>
        <author><name>carol</name></author>
      </entry>
    </feed>`;
    expect(parseQiitaAtom(xml, 10)).toEqual([
      {
        source: "qiita",
        title: "A & B",
        url: "https://qiita.com/carol/items/aaaa",
        author: "carol",
        publishedAt: "2026-08-08T05:00:00+09:00",
      },
    ]);
  });

  it("reads a Zenn article body as text", async () => {
    const { session, observations } = makeSession({
      "https://zenn.dev/api/articles/abc123": () =>
        jsonResponse({
          article: {
            title: "LLM の話",
            body_html: "<p>第一段落</p><p>第二段落 &amp; 続き</p>",
            published_at: "2026-08-08T09:00:00+09:00",
            user: { username: "alice" },
          },
        }),
    });

    const article = await session.readArticle("https://zenn.dev/alice/articles/abc123");
    expect(article).toMatchObject({
      title: "LLM の話",
      author: "alice",
      body: "第一段落\n第二段落 & 続き",
    });
    expect(observations[0].title).toContain("LLM の話");
  });

  it("rejects unsupported article URLs", async () => {
    const { session, observations } = makeSession({});
    await expect(session.readArticle("https://example.com/a")).rejects.toThrow(
      "Unsupported article host",
    );
    await expect(session.readArticle("https://zenn.dev/alice/books/xyz")).rejects.toThrow(
      "Not a Zenn article URL",
    );
    expect(observations).toHaveLength(0);
  });
});

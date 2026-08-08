/** A headline from Zenn or Qiita. */
export interface NewsHeadline {
  /** Which site the article is from. */
  source: "zenn" | "qiita";
  title: string;
  /** Canonical article URL. Pass this to readArticle() to get the full text. */
  url: string;
  /** Author's username on the source site. */
  author: string;
  /** Publication time, ISO 8601. */
  publishedAt: string;
}

/** The full text of a single article. */
export interface NewsArticle {
  title: string;
  url: string;
  author: string;
  /** Publication time, ISO 8601, when the source provides it. */
  publishedAt?: string;
  /**
   * Article body. Markdown for Qiita articles; plain text extracted from HTML
   * for Zenn articles. May be long (tens of kilobytes).
   */
  body: string;
}

/**
 * Japanese tech news from Zenn (zenn.dev) and Qiita (qiita.com).
 * List methods return headlines only; call readArticle() with a headline's url
 * for the full text.
 */
export interface NewsSession {
  /**
   * Currently trending articles. Omit site to get both sites interleaved.
   * limit is per site, 1-50, default 20.
   */
  listTrending(options?: { site?: "zenn" | "qiita"; limit?: number }): Promise<NewsHeadline[]>;

  /**
   * Latest articles for a topic/tag, e.g. "llm" or "typescript".
   * Topic names are site-specific; try the same word on both sites if unsure.
   */
  listTopic(site: "zenn" | "qiita", topic: string, options?: { limit?: number }): Promise<NewsHeadline[]>;

  /** Latest articles by a specific author (their username on that site). */
  listAuthor(site: "zenn" | "qiita", username: string, options?: { limit?: number }): Promise<NewsHeadline[]>;

  /**
   * Fetch the full text of one article. Accepts zenn.dev and qiita.com article
   * URLs (as returned in NewsHeadline.url). Throws if the URL is not a
   * supported article URL.
   */
  readArticle(url: string): Promise<NewsArticle>;
}

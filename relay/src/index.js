export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method !== "POST" || !url.pathname.startsWith("/v1/")) {
        return new Response("not found", { status: 404 });
      }
      const upstreamUrl = "https://opencode.ai/zen/go" + url.pathname;
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("x-api-key");
      headers.delete("cf-aig-authorization");
      headers.set("authorization", `Bearer ${env.OPENCODE_GO_API_KEY}`);
      const upstreamRequest = new Request(upstreamUrl, {
        method: "POST",
        headers,
        body: request.body,
        duplex: "half",
      });
      return fetch(upstreamRequest);
    } catch (err) {
      return new Response(`relay error: ${err && err.stack ? err.stack : err}`, { status: 500 });
    }
  },
};

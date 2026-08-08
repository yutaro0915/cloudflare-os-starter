export * from "./memory.js";

export default {
  async fetch(): Promise<Response> {
    return new Response("Memory Gatekeeper worker is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
};

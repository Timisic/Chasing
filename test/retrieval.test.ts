import assert from "node:assert/strict";
import test from "node:test";

import { fetchRetrievedSources } from "../src/retrieval.ts";

test("source retrieval rejects hosts that resolve to private networks", async () => {
  let requested = false;
  await assert.rejects(
    fetchRetrievedSources(
      [{ title: "Unsafe", url: "https://metadata.example/document", kind: "primary" }],
      (async () => {
        requested = true;
        return new Response("secret");
      }) as typeof fetch,
      async () => [{ address: "127.0.0.1", family: 4 }],
    ),
    /private source hosts/i,
  );
  assert.equal(requested, false);
});

test("source retrieval validates every HTTPS redirect before following it", async () => {
  const requested: string[] = [];
  const sources = await fetchRetrievedSources(
    [{ title: "Paper", url: "https://example.org", kind: "primary" }],
    (async (input: string | URL | Request) => {
      requested.push(String(input));
      if (requested.length === 1) {
        return new Response(null, { status: 302, headers: { location: "https://papers.example.org/final" } });
      }
      return new Response("Primary source text", { status: 200, headers: { "content-type": "text/plain" } });
    }) as typeof fetch,
    async () => [{ address: "93.184.216.34", family: 4 }],
  );

  assert.deepEqual(requested, ["https://example.org/", "https://papers.example.org/final"]);
  assert.equal(sources[0]?.url, "https://papers.example.org/final");
  assert.equal(sources[0]?.excerpt, "Primary source text");
});

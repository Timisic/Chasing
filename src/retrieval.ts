import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { RetrievedSource } from "./domain.ts";

export interface SourceRequest {
  title: string;
  url: string;
  kind: "official" | "primary";
}

const MAX_SOURCE_BYTES = 1_000_000;
const MAX_EXCERPT_CHARS = 6_000;
const MAX_REDIRECTS = 5;

export type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: HostResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [first = 0, second = 0] = parts;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function validateSourceUrl(input: string): URL {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error(`Source must use HTTPS: ${input}`);
  if (url.username || url.password) throw new Error(`Source URL must not contain credentials: ${input}`);
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname === "::1"
    || (isIP(hostname) === 4 && isPrivateIpv4(hostname))
    || (isIP(hostname) === 6 && (hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80")))
  ) {
    throw new Error(`Private source hosts are not allowed: ${input}`);
  }
  return url;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized) || normalized === "0.0.0.0";
  if (isIP(normalized) === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/u.test(normalized)) return true;
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice("::ffff:".length));
  }
  return false;
}

async function assertPublicResolution(url: URL, resolveHost: HostResolver): Promise<void> {
  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Private source hosts are not allowed: ${url.toString()}`);
  }
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error(`Source exceeds ${MAX_SOURCE_BYTES} bytes`);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error(`Source exceeds ${MAX_SOURCE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function cleanText(text: string, contentType: string): string {
  if (contentType.includes("html")) {
    text = text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }
  return text.replace(/\s+/gu, " ").trim().slice(0, MAX_EXCERPT_CHARS);
}

export async function fetchRetrievedSources(
  sources: SourceRequest[],
  request: typeof fetch = fetch,
  resolveHost: HostResolver = defaultResolver,
  signal?: AbortSignal,
): Promise<RetrievedSource[]> {
  const retrieved: RetrievedSource[] = [];
  for (const source of sources) {
    let url = validateSourceUrl(source.url);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertPublicResolution(url, resolveHost);
      response = await request(url, {
        headers: { accept: "text/html, text/plain, application/pdf" },
        redirect: "manual",
        ...(signal ? { signal } : {}),
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) throw new Error(`Source redirect is missing a location: ${url.toString()}`);
      if (redirects === MAX_REDIRECTS) throw new Error(`Source exceeded ${MAX_REDIRECTS} redirects: ${source.url}`);
      url = validateSourceUrl(new URL(location, url).toString());
    }
    if (!response) throw new Error(`Source retrieval produced no response: ${source.url}`);
    if (!response.ok) throw new Error(`Source retrieval failed (${response.status}): ${source.url}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const body = await readLimitedBody(response);
    const excerpt = contentType.includes("pdf")
      ? `PDF fetched successfully (${body.byteLength} bytes).`
      : cleanText(new TextDecoder().decode(body), contentType);
    if (!excerpt) throw new Error(`Source returned no readable content: ${source.url}`);
    retrieved.push({
      title: source.title.trim(),
      url: url.toString(),
      kind: source.kind,
      excerpt,
    });
  }
  return retrieved;
}

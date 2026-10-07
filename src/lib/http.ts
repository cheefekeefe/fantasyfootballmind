// Small fetch wrapper with timeouts and an in-memory + on-disk TTL cache.
// Upstream fantasy APIs are rate limited (and some cost credits), so everything is cached.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const memory = new Map<string, { expires: number; value: unknown }>();
const CACHE_DIR = path.join(process.cwd(), ".cache");

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${redact(url)}`);
  }
}

/** Remove API keys from URLs before they end up in logs or the UI. */
export function redact(url: string): string {
  return url.replace(/(apiKey|api_key|key)=[^&]+/gi, "$1=***");
}

interface FetchOpts {
  ttlMinutes: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Persist to .cache/ so restarts don't re-spend credits (Odds API) or re-download big files. */
  disk?: boolean;
  parse?: "json" | "text";
}

function cacheKey(url: string, headers?: Record<string, string>) {
  return crypto.createHash("sha1").update(url + JSON.stringify(headers ?? {})).digest("hex");
}

export async function cachedFetch<T = unknown>(url: string, opts: FetchOpts): Promise<T> {
  const key = cacheKey(url, opts.headers);
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const ttl = Number(process.env.CACHE_TTL_MINUTES) || opts.ttlMinutes;
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (opts.disk) {
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as { expires: number; value: T };
      if (raw.expires > now) {
        memory.set(key, raw);
        return raw.value;
      }
    } catch {
      // cache miss
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(url, { headers: opts.headers, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new HttpError(res.status, url);
  const value = (opts.parse === "text" ? await res.text() : await res.json()) as T;
  const entry = { expires: now + ttl * 60_000, value };
  memory.set(key, entry);
  if (opts.disk) {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(file, JSON.stringify(entry));
    } catch {
      // read-only filesystem (e.g. serverless) - memory cache still works
    }
  }
  return value;
}

/** Minimal RFC4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function num(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function errMessage(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}`;
  if (e instanceof Error) return e.name === "AbortError" ? "timed out" : e.message.slice(0, 120);
  return String(e);
}

import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import { requireAuthenticated } from "../_shared/auth.ts";
import { assertSafeUrl, safeFetch } from "../_shared/url_safety.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_ITEMS = 20;
const MAX_ITEM_CHARS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function fail(error: string, status = 0, httpStatus = 200) {
  return json(
    {
      ok: false,
      status,
      matchedCount: 0,
      previewItems: [],
      previewText: "",
      error,
    },
    httpStatus,
  );
}

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trim()}…`;
}

async function readLimitedText(response: Response, limitBytes: number) {
  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    if (received > limitBytes) {
      try {
        await reader.cancel();
      } catch {
        // Best effort cancellation only.
      }
      throw new Error(`Response too large. Maximum allowed size is ${limitBytes} bytes.`);
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8").decode(merged);
}

async function fetchHtml(url: URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "az-AZ,az;q=0.9,en-US;q=0.8",
        Referer: "https://www.google.com/",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const text = await readLimitedText(response, MAX_RESPONSE_BYTES);

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url.toString(),
      contentType,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractPreviewItems(html: string, selector: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document) throw new Error("HTML parse edilə bilmədi.");

  let elements: ReturnType<typeof document.querySelectorAll>;
  try {
    elements = document.querySelectorAll(selector);
  } catch {
    throw new Error("CSS selector düzgün deyil.");
  }

  const previewItems = Array.from(elements)
    .map((element) => normalizeText(element.textContent || ""))
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
    .map((item) => truncate(item, MAX_ITEM_CHARS));

  return {
    matchedCount: elements.length,
    previewItems,
    previewText: previewItems.join("\n"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 0, 405);

  const auth = await requireAuthenticated(req, json);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const selector = String(body.selector || "").trim();

    let url: URL;
    try {
      url = await assertSafeUrl(body.url);
    } catch {
      return fail("URL tələb olunur və təhlükəsiz http:// və ya https:// ünvanı olmalıdır.", 0, 400);
    }

    if (!selector) return fail("CSS selector tələb olunur.", 0, 400);

    const fetched = await fetchHtml(url);
    if (!fetched.ok) {
      return fail(`Sayt oxunmadı. HTTP status: ${fetched.status}`, fetched.status);
    }

    const looksHtml = /text\/html|application\/xhtml\+xml/i.test(fetched.contentType) || /<html[\s>]/i.test(fetched.text);
    if (!looksHtml) {
      return fail("Cavab HTML səhifə deyil. Selector testi normal HTML səhifə üçün işləyir.", fetched.status);
    }

    const result = extractPreviewItems(fetched.text, selector);
    if (result.matchedCount === 0) {
      return fail("Selector üzrə element tapılmadı.", fetched.status);
    }

    return json({
      ok: true,
      status: fetched.status,
      matchedCount: result.matchedCount,
      previewItems: result.previewItems,
      previewText: result.previewText,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return fail(isAbort ? "Sorğu vaxt limitini keçdi." : message);
  }
});

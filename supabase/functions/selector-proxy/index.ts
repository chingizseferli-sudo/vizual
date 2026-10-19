import { requireAuthenticated } from "../_shared/auth.ts";
import { assertSafeUrl, safeFetch } from "../_shared/url_safety.ts";
import { withCors } from "../_shared/cors.ts";
import { consumeRateLimit } from "../_shared/rate_limit.ts";

const MAX_RESPONSE_BYTES = 1_500_000;
const RATE_LIMIT = { requests: 60, windowSeconds: 600 };
const SELECTOR_PROXY_VERSION = "1.4-readable-proxy-failures";

type ProxyFetchResult = {
  contentType: string;
  finalUrl: string;
  status: number;
  text: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeHtml(html: string, finalUrl: string) {
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?x-frame-options["']?[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  cleaned = wakeStaticAssets(cleaned);

  const base = `<base href="${escapeHtmlAttr(finalUrl)}">`;
  const helperStyle = `<meta name="referrer" content="no-referrer"><style>html,body{min-height:100%;background:#fff!important;}body{overflow:auto!important;}img,video,iframe{max-width:100%;}img{height:auto;}[hidden],.hidden{visibility:visible!important;opacity:1!important;}</style>`;
  const headInject = `${base}${helperStyle}`;

  if (/<head[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<head[^>]*>/i, (match) => `${match}${headInject}`);
  } else {
    cleaned = `${headInject}${cleaned}`;
  }

  return cleaned;
}

function wakeStaticAssets(html: string) {
  let cleaned = html;

  cleaned = cleaned.replace(/<img\b([^>]*?)>/gi, (_match, attrs: string) => {
    let nextAttrs = attrs;
    const hasSrc = /\ssrc\s*=\s*["'][^"']+["']/i.test(nextAttrs);
    const lazySrc = nextAttrs.match(/\s(?:data-src|data-original|data-lazy-src|data-url|data-image)\s*=\s*(["'])(.*?)\1/i)?.[2];

    if (!hasSrc && lazySrc) {
      nextAttrs += ` src="${escapeHtmlAttr(lazySrc)}"`;
    }

    const hasSrcSet = /\ssrcset\s*=\s*["'][^"']+["']/i.test(nextAttrs);
    const lazySrcSet = nextAttrs.match(/\sdata-srcset\s*=\s*(["'])(.*?)\1/i)?.[2];

    if (!hasSrcSet && lazySrcSet) {
      nextAttrs += ` srcset="${escapeHtmlAttr(lazySrcSet)}"`;
    }

    nextAttrs = nextAttrs
      .replace(/\sloading\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\sdecoding\s*=\s*["'][^"']*["']/gi, "");

    return `<img${nextAttrs}>`;
  });

  cleaned = cleaned.replace(/<source\b([^>]*?)>/gi, (_match, attrs: string) => {
    let nextAttrs = attrs;
    const hasSrcSet = /\ssrcset\s*=\s*["'][^"']+["']/i.test(nextAttrs);
    const lazySrcSet = nextAttrs.match(/\s(?:data-srcset|data-src)\s*=\s*(["'])(.*?)\1/i)?.[2];

    if (!hasSrcSet && lazySrcSet) {
      nextAttrs += ` srcset="${escapeHtmlAttr(lazySrcSet)}"`;
    }

    return `<source${nextAttrs}>`;
  });

  return cleaned;
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

function isHtmlResponse(result: ProxyFetchResult) {
  return result.contentType.includes("text/html") || result.text.includes("<html");
}

function isCloudflareEdgeError(result: ProxyFetchResult) {
  const text = result.text.toLowerCase();
  return (
    text.includes("error 1034") ||
    text.includes("edge ip restricted") ||
    text.includes("cloudflare ray id") && text.includes("what happened?")
  );
}

function makeCanonicalFallbackUrl(url: URL) {
  const next = new URL(url.toString());
  const host = next.hostname.toLowerCase();

  if (host.startsWith("www.")) {
    next.hostname = host.slice(4);
    return next.toString();
  }

  if (host.split(".").length >= 2) {
    next.hostname = `www.${host}`;
    return next.toString();
  }

  return "";
}

function friendlyProxyError(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("abort") || lower.includes("timed out") || lower.includes("timeout")) {
    return "Sayt vaxtında cavab vermədi. Domen işləyirsə, selectoru real brauzer extension-u ilə seçin.";
  }

  if (lower.includes("dns") || lower.includes("enotfound") || lower.includes("name not resolved")) {
    return "Domen həll olunmadı və ya DNS problemi var. Domeni yoxlayın və ya www/non-www variantını sınayın.";
  }

  if (lower.includes("ssl") || lower.includes("certificate") || lower.includes("cert")) {
    return "Saytın SSL/certifikat cavabında problem var. Bu sayt pəncərədə açılmaya bilər.";
  }

  if (lower.includes("403") || lower.includes("forbidden")) {
    return "Sayt Edge/proxy oxumasını blokladı. Bu halda selectoru real brauzer extension-u ilə seçin.";
  }

  if (lower.includes("429") || lower.includes("rate")) {
    return "Sayt sorğuları müvəqqəti məhdudlaşdırdı. Bir az sonra yenidən yoxlayın.";
  }

  return "Sayt proxy pəncərəsində açılmadı. Real brauzer extension-u ilə selector seçmək daha uyğundur.";
}

async function fetchSelectorPage(url: URL): Promise<ProxyFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "az-AZ,az;q=0.9,en-US;q=0.8",
        Referer: "https://www.google.com/",
      },
    });

    return {
      contentType: upstream.headers.get("content-type") || "",
      finalUrl: upstream.url || url.toString(),
      status: upstream.status,
      text: await readLimitedText(upstream, MAX_RESPONSE_BYTES),
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAuthenticated(req, json);
  if (auth instanceof Response) return auth;

  if (!(await consumeRateLimit(auth.user.id, "selector-proxy", RATE_LIMIT.requests, RATE_LIMIT.windowSeconds))) {
    return json({ error: "Çox sorğu göndərildi. Bir neçə dəqiqə sonra yenidən yoxlayın.", version: SELECTOR_PROXY_VERSION }, 429);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawUrl = String(body.url || "").trim();

    if (!rawUrl) return json({ error: "url required" }, 400);

    const url = await assertSafeUrl(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    let result = await fetchSelectorPage(url);
    let canonicalFallback = false;

    if (isCloudflareEdgeError(result)) {
      const fallbackUrl = makeCanonicalFallbackUrl(url);

      if (fallbackUrl) {
        const safeFallbackUrl = await assertSafeUrl(fallbackUrl);
        const fallbackResult = await fetchSelectorPage(safeFallbackUrl);

        if (!isCloudflareEdgeError(fallbackResult) && isHtmlResponse(fallbackResult)) {
          result = fallbackResult;
          canonicalFallback = true;
        }
      }
    }

    if (isCloudflareEdgeError(result)) {
      return json({
        error: "Sayt Cloudflare/DNS səbəbilə bu domenlə açılmadı. www/non-www variantı da işlək HTML qaytarmadı.",
        status: result.status,
        contentType: result.contentType,
        finalUrl: result.finalUrl,
        version: SELECTOR_PROXY_VERSION,
      });
    }

    if (!isHtmlResponse(result)) {
      return json({
        error: "HTML response not found. Visual selector needs a normal page, not RSS/sitemap/XML.",
        status: result.status,
        contentType: result.contentType,
        finalUrl: result.finalUrl,
        version: SELECTOR_PROXY_VERSION,
      });
    }

    return json({
      html: sanitizeHtml(result.text, result.finalUrl),
      finalUrl: result.finalUrl,
      status: result.status,
      canonicalFallback,
      version: SELECTOR_PROXY_VERSION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("selector-proxy fetch failed", message);
    return json({
      error: friendlyProxyError(message),
      version: SELECTOR_PROXY_VERSION,
    });
  }
}));

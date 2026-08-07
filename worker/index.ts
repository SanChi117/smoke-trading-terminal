/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const BINANCE_ORIGIN = "https://fapi.binance.com";
const BINANCE_PROXY_PREFIX = "/api/binance";
const ALLOWED_BINANCE_PATHS = new Set([
  "/fapi/v1/klines",
  "/fapi/v1/ticker/24hr",
]);
const ALLOWED_INTERVALS = new Set(["1w", "1d", "4h", "15m", "5m"]);

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function validInteger(value: string | null): boolean {
  return value === null || /^\d+$/.test(value);
}

function buildBinanceUpstream(url: URL): URL | Response {
  const upstreamPath = url.pathname.slice(BINANCE_PROXY_PREFIX.length);
  if (!ALLOWED_BINANCE_PATHS.has(upstreamPath)) {
    return jsonError("Unsupported public market-data endpoint", 404);
  }

  const upstream = new URL(upstreamPath, BINANCE_ORIGIN);
  if (upstreamPath === "/fapi/v1/klines") {
    const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
    const interval = url.searchParams.get("interval") ?? "";
    const limitText = url.searchParams.get("limit") ?? "500";
    const limit = Number(limitText);
    const startTime = url.searchParams.get("startTime");
    const endTime = url.searchParams.get("endTime");

    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return jsonError("Invalid symbol", 400);
    if (!ALLOWED_INTERVALS.has(interval)) return jsonError("Invalid interval", 400);
    if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 1500) {
      return jsonError("Invalid limit", 400);
    }
    if (!validInteger(startTime) || !validInteger(endTime)) return jsonError("Invalid time range", 400);

    upstream.searchParams.set("symbol", symbol);
    upstream.searchParams.set("interval", interval);
    upstream.searchParams.set("limit", String(limit));
    if (startTime) upstream.searchParams.set("startTime", startTime);
    if (endTime) upstream.searchParams.set("endTime", endTime);
  }

  return upstream;
}

async function proxyBinanceMarketData(request: Request): Promise<Response> {
  if (request.method !== "GET") return jsonError("Method not allowed", 405);
  const result = buildBinanceUpstream(new URL(request.url));
  if (result instanceof Response) return result;

  try {
    const upstreamResponse = await fetch(result, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
    });
    const headers = new Headers({
      "content-type": upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": upstreamResponse.ok ? "public, max-age=3, s-maxage=3" : "no-store",
      "x-content-type-options": "nosniff",
    });
    const retryAfter = upstreamResponse.headers.get("retry-after");
    if (retryAfter) headers.set("retry-after", retryAfter);
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers });
  } catch {
    return jsonError("Binance market-data upstream unavailable", 502);
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(`${BINANCE_PROXY_PREFIX}/`)) {
      return proxyBinanceMarketData(request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

import { NextResponse } from "next/server";

/**
 * Shared CORS helper for API routes called cross-origin from the Shopify storefront.
 */

const ALLOWED_DOMAINS = [
  "myownsongs.com",
  "myshopify.com",
  "shopifypreview.com",
  "shopify.com",
  "localhost",
  "127.0.0.1",
];

function resolveAllowedOrigin(origin) {
  if (!origin) return "*";
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const isAllowed = ALLOWED_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
    if (isAllowed) {
      return origin;
    }
  } catch (e) {
    if (ALLOWED_DOMAINS.some((d) => origin.includes(d))) {
      return origin;
    }
  }
  return "*";
}

export function withCORS(response, origin) {
  const allowed = resolveAllowedOrigin(origin);
  response.headers.set("Access-Control-Allow-Origin", allowed || "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Range, x-file-name, x-file-type, x-order-id, x-video-id");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.set("Vary", "Origin");
  return response;
}

export function handleOptions(request) {
  const origin = request.headers.get("origin") || "";
  return withCORS(new NextResponse(null, { status: 204 }), origin);
}

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  // Prefer x-forwarded-proto for HTTPS detection (set by reverse proxies like Nginx/Cloudflare)
  // Always force HTTPS if the forwarded proto says https, or if we're in production
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const requestProto = request.nextUrl.protocol.replace(':', '');
  const protocol = forwardedProto || requestProto;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  // Always use HTTPS if any signal says https (prevents Mixed Content redirects)
  const safeProtocol = (protocol === 'https' || forwardedProto === 'https') ? 'https' : protocol;
  const baseUrl = `${safeProtocol}://${host}`;

  // Check if request is originating from the Shopify storefront
  const origin = request.headers.get('origin') || "";
  const referer = request.headers.get('referer') || "";
  const isFromShopifyStorefront = 
    origin.includes('myownsongs.com') || referer.includes('myownsongs.com') ||
    origin.includes('myshopify.com') || referer.includes('myshopify.com') ||
    origin.includes('jq3z5q-hv') || referer.includes('jq3z5q-hv');

  // Paths that are ALWAYS public (App & Shopify)
  const alwaysPublicPaths = [
    "/signin",
    "/api/auth/login",
    "/api/auth/shopify-callback", // Keep Shopify app authentication working
    "/api/shopify/webhooks", // Allow Shopify webhooks
    "/api/klaviyo/fulfill", // Allow Klaviyo webhook fulfillment
    "/api/klaviyo/publish-fulfill", // Allow Klaviyo publish webhook fulfillment
    "/api/download", // Public download route for emails
    "/api/video-tool", // Public video builder tool endpoints
    "/_next", // static files
    "/favicon.ico"
  ];

  // Paths that are public ONLY when requested from the Shopify Storefront
  const shopifyPublicPaths = [
    "/genarate",
    "/api/suno/generate-music",
    "/api/suno/generate-lyrics",
    "/api/suno/status",
    "/api/orders",
    "/api/form-options", // Used by storefront
    "/api/video-options" // Used by storefront video tool
  ];

  const isAlwaysPublic = alwaysPublicPaths.some(path => pathname.startsWith(path));
  const isShopifyPublic = isFromShopifyStorefront && shopifyPublicPaths.some(path => pathname.startsWith(path));
  // GET /api/form-options and /api/video-options are publicly accessible configuration endpoints
  const isPublicConfigGet = request.method === "GET" && (pathname === "/api/form-options" || pathname === "/api/video-options");

  // Allow all OPTIONS preflights to pass with full CORS headers immediately
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    const allowedOrigin = origin || "*";
    res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Range, x-file-name, x-file-type");
    res.headers.set("Access-Control-Max-Age", "86400");
    return res;
  }

  // If it's a permitted public path, let it pass without authentication
  if (isAlwaysPublic || isShopifyPublic || isPublicConfigGet) {
    return NextResponse.next();
  }

  // If request contains Shopify HMAC handshake parameters from Shopify admin, authenticate via callback
  if (request.nextUrl.searchParams.has("hmac") && request.nextUrl.searchParams.has("shop")) {
    const callbackUrl = new URL("/api/auth/shopify-callback", baseUrl);
    callbackUrl.search = request.nextUrl.search;
    return NextResponse.redirect(callbackUrl);
  }

  // Check for the admin token
  const token = request.cookies.get("admin_token")?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/signin", baseUrl));
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const { payload } = await jwtVerify(token, secret);
    const cleanRole = String(payload.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const isSuperAdmin = cleanRole === "superadmin" || payload.role === "super_admin";
    const isAdmin = isSuperAdmin || cleanRole === "admin" || payload.role === "admin";

    // Super Admin has 100% unrestricted access to everything A to Z
    if (isSuperAdmin) {
      if (pathname === "/orders") {
        const targetUrl = new URL("/orders/music", request.url);
        targetUrl.search = request.nextUrl.search;
        return NextResponse.redirect(targetUrl);
      }
      return NextResponse.next();
    }

    // Role-based protection for specific routes
    if (pathname.startsWith("/create-staff") && !isAdmin) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // Video Tool feature gate: if not enabled, block /orders/video, /form-elements/video, and /api/video-orders
    if (!payload.enableVideoTool) {
      if (pathname.startsWith("/orders/video")) {
        return NextResponse.redirect(new URL("/orders/music", request.url));
      }
      if (pathname.startsWith("/form-elements/video")) {
        return NextResponse.redirect(new URL("/form-elements", request.url));
      }
      if (pathname.startsWith("/api/video-orders")) {
        return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });
      }
    }

    // Always redirect /orders to /orders/music
    if (pathname === "/orders") {
      const targetUrl = new URL("/orders/music", request.url);
      targetUrl.search = request.nextUrl.search;
      return NextResponse.redirect(targetUrl);
    }

    // Staff permission-based route protection
    if (!isAdmin) {
      const PROTECTED_ROUTES = [
        "/orders/music",
        "/orders/video",
        "/orders/publish",
        "/orders",
        "/customers",
        "/ordered-musics",
        "/all-musics",
        "/form-elements/video",
        "/form-elements",
        "/users",
        "/trash",
        "/settings",
      ];
      const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
      // Only enforce if permissions are explicitly set (non-empty array)
      if (permissions.length > 0) {
        const matchedRoute = PROTECTED_ROUTES.find(
          (route) => pathname === route || pathname.startsWith(route + "/")
        );
        if (matchedRoute && !permissions.includes(matchedRoute)) {
          const unauthorizedUrl = new URL("/unauthorized", request.url);
          unauthorizedUrl.searchParams.set("path", matchedRoute);
          return NextResponse.redirect(unauthorizedUrl);
        }
      }
    }

    // If already authenticated and Shopify params are present, clean the URL
    if (request.nextUrl.searchParams.has("hmac") && request.nextUrl.searchParams.has("shop")) {
      return NextResponse.redirect(new URL("/", baseUrl));
    }

    return NextResponse.next();
  } catch (error) {
    // Token is invalid or expired
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/signin", baseUrl));
  }
}

export const config = {
  matcher: [
    /*
     * IMPORTANT: do NOT exclude all of "api" here — /api/admin/* (and any
     * other admin-only API routes) still need the token check below.
     *
     * Only the specific storefront-facing public paths are excluded, via
     * the `publicPaths` array above (which now includes "/api/form-options").
     * Everything else, including "/api/admin/...", still runs through the
     * full middleware and requires a valid admin_token.
     */
    "/((?!_next/static|_next/image|favicon.ico|images).*)",
  ],
};
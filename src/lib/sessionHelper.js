import crypto from "crypto";

/**
 * Parses user agent string into simplified device, browser, and OS info.
 */
export function parseUserAgent(userAgentString = "") {
  const ua = userAgentString.toLowerCase();

  // Detect OS
  let os = "Windows";
  if (ua.includes("windows nt 10.0") || ua.includes("windows nt 11.0") || ua.includes("windows")) {
    os = "Windows";
  } else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    os = "iOS";
  } else if (ua.includes("mac os x") || ua.includes("macintosh")) {
    os = "macOS";
  } else if (ua.includes("android")) {
    os = "Android";
  } else if (ua.includes("linux")) {
    os = "Linux";
  } else if (ua.includes("cros")) {
    os = "ChromeOS";
  }

  // Detect Device Type
  let device = "Desktop";
  if (ua.includes("ipad") || ua.includes("tablet")) {
    device = "Tablet";
  } else if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) {
    device = "Mobile";
  }

  // Detect Browser
  let browser = "Chrome";
  if (ua.includes("edg/")) {
    browser = "Microsoft Edge";
  } else if (ua.includes("opr/") || ua.includes("opera")) {
    browser = "Opera";
  } else if (ua.includes("firefox/")) {
    browser = "Firefox";
  } else if (ua.includes("chrome/") && !ua.includes("edg/")) {
    browser = "Chrome";
  } else if (ua.includes("safari/") && !ua.includes("chrome/")) {
    browser = "Safari";
  }

  return { os, device, browser };
}

/**
 * Generates a unique secure session ID
 */
export function generateSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Helper to extract client IP address from Next.js request headers
 */
export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

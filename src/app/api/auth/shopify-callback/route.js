import { NextResponse } from "next/server";
import crypto from "crypto";
import { SignJWT } from "jose";
import dbConnect from "@/lib/mongoose";
import Settings from "@/models/Settings";
import User from "@/models/User";
import { parseUserAgent, generateSessionId, getClientIp } from "@/lib/sessionHelper";

function verifyHmac(query, secret) {
  const hmac = query.hmac;
  if (!hmac || !secret) return false;

  const { hmac: _, signature: __, ...rest } = query;
  
  const message = Object.keys(rest)
    .sort()
    .map(key => `${key}=${rest[key]}`)
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(generatedHmac, 'utf8'), Buffer.from(hmac, 'utf8'));
  } catch (e) {
    return false;
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());

    const forwardedProto = request.headers.get('x-forwarded-proto');
    const requestProto = request.nextUrl.protocol.replace(':', '');
    const protocol = forwardedProto || requestProto;
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
    const isHttps = protocol === 'https' || forwardedProto === 'https' || process.env.NODE_ENV === 'production';
    const safeProtocol = isHttps ? 'https' : 'http';
    const baseUrl = `${safeProtocol}://${host}`;

    if (!query.hmac || !query.shop) {
      return NextResponse.redirect(new URL("/signin?error=MissingShopifyParams", baseUrl));
    }

    await dbConnect();
    
    // Fetch Shopify Secret ID from Settings
    const settings = await Settings.findOne({});
    if (!settings || !settings.shopifySecretId) {
      console.error("[Shopify Auth] Shopify Secret ID is not configured in Settings.");
      return NextResponse.redirect(new URL("/signin?error=ShopifyNotConfigured", baseUrl));
    }

    // Verify the HMAC
    const isValid = verifyHmac(query, settings.shopifySecretId);

    if (!isValid) {
      console.error("[Shopify Auth] Invalid HMAC signature.");
      return NextResponse.redirect(new URL("/signin?error=InvalidHMAC", baseUrl));
    }

    // Legitimate request from Shopify admin -> auto-login as super_admin
    let adminUser = await User.findOne({ role: "super_admin" });
    if (!adminUser) adminUser = await User.findOne({ role: "admin", status: "active" });
    if (!adminUser) adminUser = await User.findOne({ status: "active" });
    if (!adminUser) adminUser = await User.findOne({});

    if (!adminUser) {
      console.error("[Shopify Auth] No user found in database.");
      return NextResponse.redirect(new URL("/signin?error=NoAdminFound", baseUrl));
    }

    // Create a new session for this Shopify Embedded App opening
    const userAgent = request.headers.get("user-agent") || "";
    const ip = getClientIp(request);
    const { os, device, browser } = parseUserAgent(userAgent);
    const sessionId = generateSessionId();

    const newSession = {
      sessionId,
      device: `${device} (Shopify)`,
      browser,
      os,
      ip,
      userAgent,
      lastActive: new Date(),
      createdAt: new Date(),
    };

    const existingSessions = Array.isArray(adminUser.sessions) ? adminUser.sessions : [];
    const updatedSessions = [newSession, ...existingSessions.filter(s => s.sessionId !== sessionId)].slice(0, 20);

    await User.updateOne(
      { _id: adminUser._id },
      {
        $set: {
          lastLogin: new Date(),
          sessions: updatedSessions,
        }
      }
    );

    // Generate signed JWT token
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const token = await new SignJWT({ 
      id: adminUser._id.toString(),
      email: adminUser.email, 
      role: adminUser.role,
      name: adminUser.name,
      sessionId,
      enableVideoTool: adminUser.enableVideoTool !== false,
      permissions: Array.isArray(adminUser.permissions) ? [...adminUser.permissions].map(String) : [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`30d`)
      .sign(secret);

    // Redirect cleanly to Dashboard without URL query parameters
    const redirectUrl = new URL("/", baseUrl);
    const response = NextResponse.redirect(redirectUrl);

    // Set cookie with SameSite=None and Secure=true for Shopify iframe compatibility
    response.cookies.set("admin_token", token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "none" : "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // in seconds
    });

    return response;

  } catch (error) {
    console.error("[Shopify Auth] Internal Error:", error);
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
    return NextResponse.redirect(new URL("/signin?error=InternalServerError", `https://${host}`));
  }
}

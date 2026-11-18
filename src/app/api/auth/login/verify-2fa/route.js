import { NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import speakeasy from "speakeasy";
import dbConnect from "@/lib/mongoose";
import User from "@/models/User";
import { parseUserAgent, generateSessionId, getClientIp } from "@/lib/sessionHelper";

export async function POST(request) {
  try {
    const { tempToken, code } = await request.json();

    if (!tempToken || !code) {
      return NextResponse.json({ error: "Token and code are required" }, { status: 400 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    let payload;

    try {
      const verified = await jwtVerify(tempToken, secret);
      payload = verified.payload;
    } catch (err) {
      return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });
    }

    if (!payload.tempAuth || !payload.id) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    await dbConnect();
    const user = await User.findById(payload.id);

    if (!user || !user.isTwoFactorEnabled) {
      return NextResponse.json({ error: "Invalid user or 2FA not enabled" }, { status: 400 });
    }

    // Verify 2FA code
    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code
    });

    if (!isValid) {
      return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
    }

    // Create new device session
    const userAgent = request.headers.get("user-agent") || "";
    const ip = getClientIp(request);
    const { os, device, browser } = parseUserAgent(userAgent);
    const sessionId = generateSessionId();

    const newSession = {
      sessionId,
      device,
      browser,
      os,
      ip,
      userAgent,
      lastActive: new Date(),
    };

    const existingSessions = Array.isArray(user.sessions) ? user.sessions : [];
    const updatedSessions = [newSession, ...existingSessions.filter(s => s.sessionId !== sessionId)].slice(0, 20);

    await User.updateOne(
      { _id: user._id },
      { 
        $set: { 
          lastLogin: new Date(),
          sessions: updatedSessions,
        } 
      }
    );

    // Generate final token
    const keepLoggedIn = payload.keepLoggedIn;
    const expiresInDays = keepLoggedIn ? 30 : 1;
    
    const token = await new SignJWT({ 
      id: user._id.toString(),
      email: user.email, 
      role: user.role,
      name: user.name,
      sessionId,
      enableVideoTool: user.enableVideoTool !== false,
      permissions: Array.isArray(user.permissions) ? [...user.permissions].map(String) : [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${expiresInDays}d`)
      .sign(secret);

    const response = NextResponse.json({ 
      success: true, 
      role: user.role,
      enableVideoTool: user.enableVideoTool !== false,
    }, { status: 200 });
    
    response.cookies.set("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: expiresInDays * 24 * 60 * 60, 
    });

    return response;
  } catch (error) {
    console.error("[Verify2FALogin] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

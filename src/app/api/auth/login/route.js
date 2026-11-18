import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/mongoose";
import User from "@/models/User";
import { parseUserAgent, generateSessionId, getClientIp } from "@/lib/sessionHelper";

export async function POST(request) {
  try {
    const { email, password, keepLoggedIn } = await request.json();

    await dbConnect();

    // 1. Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // 2. Check if user is active
    if (user.status !== "active") {
      return NextResponse.json({ error: "Account is not active" }, { status: 403 });
    }

    // 3. Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // 4. Handle 2FA interception
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");

    if (user.isTwoFactorEnabled) {
      // Issue a temporary token for the 2FA step (expires in 5 minutes)
      const tempToken = await new SignJWT({ 
        tempAuth: true,
        id: user._id.toString(),
        keepLoggedIn: keepLoggedIn 
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(secret);

      return NextResponse.json({ 
        requires2FA: true, 
        tempToken,
        message: "2-Step Verification required" 
      }, { status: 200 });
    }

    // 5. Create new device session
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
    // Keep max 20 active sessions
    const updatedSessions = [newSession, ...existingSessions.filter(s => s.sessionId !== sessionId)].slice(0, 20);

    // Update last login and session list
    await User.updateOne(
      { _id: user._id },
      { 
        $set: { 
          lastLogin: new Date(),
          sessions: updatedSessions,
        } 
      }
    );

    // 6. Generate final token
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
      enableVideoTool: user.enableVideoTool !== false 
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
    console.error("[Login] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

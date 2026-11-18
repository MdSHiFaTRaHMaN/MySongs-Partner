import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/mongoose";
import User from "@/models/User";
import { parseUserAgent, generateSessionId, getClientIp } from "@/lib/sessionHelper";

// Helper to get authenticated user payload from cookie
async function getAuthPayload(request) {
  const token = request.cookies.get("admin_token")?.value;
  if (!token) return null;

  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function POST(request) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload || !authPayload.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authPayload.id;
    const { currentPassword, newEmail, newPassword } = await request.json();

    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }
    if (!newEmail && !newPassword) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findById(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return NextResponse.json({ error: "Incorrect current password" }, { status: 400 });
    }

    // Update email if provided
    if (newEmail && newEmail !== user.email) {
      const existing = await User.findOne({ email: newEmail.toLowerCase(), _id: { $ne: userId } });
      if (existing) {
        return NextResponse.json({ error: "Email already in use" }, { status: 400 });
      }
      user.email = newEmail.toLowerCase();
    }

    // Update password if provided
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
      }
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    // Mark passwordChangedAt timestamp to invalidate all previous JWTs on other devices
    const now = new Date();
    user.passwordChangedAt = now;

    // Reset sessions: Keep ONLY this new current device session, revoking all other old devices
    const userAgent = request.headers.get("user-agent") || "";
    const ip = getClientIp(request);
    const { os, device, browser } = parseUserAgent(userAgent);
    const currentSessionId = generateSessionId();

    const currentSession = {
      sessionId: currentSessionId,
      device,
      browser,
      os,
      ip,
      userAgent,
      lastActive: now,
      createdAt: now,
    };

    user.sessions = [currentSession];
    await user.save();

    // Generate and issue fresh JWT token for current session
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const token = await new SignJWT({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      sessionId: currentSessionId,
      enableVideoTool: user.enableVideoTool !== false,
      permissions: Array.isArray(user.permissions) ? [...user.permissions].map(String) : [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret);

    const response = NextResponse.json(
      { success: true, message: "Security settings updated and other devices logged out." },
      { status: 200 }
    );

    response.cookies.set("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error("[UpdateSecurity] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

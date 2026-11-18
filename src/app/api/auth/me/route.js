import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import dbConnect from "@/lib/mongoose";
import User from "@/models/User";
import { parseUserAgent, generateSessionId, getClientIp } from "@/lib/sessionHelper";

// Helper to get authenticated user & token payload from cookie
async function getAuthenticatedUserPayload(request) {
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

export async function GET(request) {
  try {
    const payload = await getAuthenticatedUserPayload(request);
    if (!payload || !payload.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const user = await User.findById(payload.id).select("-password");

    if (!user) {
      const resp = NextResponse.json({ error: "User not found" }, { status: 404 });
      resp.cookies.delete("admin_token");
      return resp;
    }

    // 1. Check if user is active
    if (user.status !== "active") {
      const resp = NextResponse.json({ error: "Account is inactive or suspended" }, { status: 403 });
      resp.cookies.delete("admin_token");
      return resp;
    }

    // 2. Check if email was changed
    if (payload.email && user.email && payload.email.toLowerCase() !== user.email.toLowerCase()) {
      const resp = NextResponse.json({ error: "Email has been changed. Please sign in again." }, { status: 401 });
      resp.cookies.delete("admin_token");
      return resp;
    }

    // 3. Check if password was changed after this token was issued
    if (user.passwordChangedAt && payload.iat) {
      const tokenIssuedAt = payload.iat * 1000;
      const pwdChangedAt = new Date(user.passwordChangedAt).getTime();
      // 3-second buffer for clock skew
      if (tokenIssuedAt < (pwdChangedAt - 3000)) {
        const resp = NextResponse.json({ error: "Password was changed. Please sign in again." }, { status: 401 });
        resp.cookies.delete("admin_token");
        return resp;
      }
    }

    let currentSessionId = payload.sessionId;
    const userSessions = Array.isArray(user.sessions) ? user.sessions : [];

    // 4. Session validation
    if (currentSessionId) {
      const activeSession = userSessions.find(s => s.sessionId === currentSessionId);
      if (!activeSession) {
        // Only trigger remote session logout if user explicitly has sessions registered
        if (userSessions.length > 0) {
          const revokedResp = NextResponse.json({ error: "Session has been logged out from another device" }, { status: 401 });
          revokedResp.cookies.delete("admin_token");
          return revokedResp;
        }
      } else {
        // Update session lastActive
        await User.updateOne(
          { _id: user._id, "sessions.sessionId": currentSessionId },
          { $set: { "sessions.$.lastActive": new Date() } }
        );
      }
    }

    // If no sessionId in token or missing from list, register a fresh session seamlessly
    if (!currentSessionId) {
      const userAgent = request.headers.get("user-agent") || "";
      const ip = getClientIp(request);
      const { os, device, browser } = parseUserAgent(userAgent);
      currentSessionId = generateSessionId();

      const newSession = {
        sessionId: currentSessionId,
        device,
        browser,
        os,
        ip,
        userAgent,
        lastActive: new Date(),
        createdAt: new Date(),
      };

      await User.updateOne(
        { _id: user._id },
        { $push: { sessions: { $each: [newSession], $slice: -20 } } }
      );
    }

    // Refresh JWT cookie with latest DB permissions and sessionId
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const updatedToken = await new SignJWT({
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

    const isHttps = process.env.NODE_ENV === "production" || request.headers.get("x-forwarded-proto") === "https";

    const response = NextResponse.json({ success: true, user }, { status: 200 });
    response.cookies.set("admin_token", updatedToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "none" : "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error("[GetMe] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const payload = await getAuthenticatedUserPayload(request);
    if (!payload || !payload.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();

    await dbConnect();
    
    // Check if updating email, and if it's already in use
    if (data.email) {
      const existingEmail = await User.findOne({ email: data.email.toLowerCase(), _id: { $ne: payload.id } });
      if (existingEmail) {
        return NextResponse.json({ error: "Email already in use" }, { status: 400 });
      }
    }

    // Only allow specific fields to be updated by the user themselves
    const allowedUpdates = {
      name: data.name,
      email: data.email ? data.email.toLowerCase() : undefined,
      phone: data.phone,
      designation: data.designation,
      bio: data.bio,
      address: data.address,
      socialLinks: data.socialLinks,
      avatar: data.avatar,
    };

    Object.keys(allowedUpdates).forEach(key => {
      if (allowedUpdates[key] === undefined) delete allowedUpdates[key];
    });

    const user = await User.findByIdAndUpdate(
      payload.id,
      { $set: allowedUpdates },
      { returnDocument: 'after', runValidators: true }
    ).select("-password");

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, user }, { status: 200 });
  } catch (error) {
    console.error("[UpdateMe] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import dbConnect from "@/lib/mongoose";
import User from "@/models/User";

// Helper to authenticate user and extract token payload
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

export async function GET(request) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload || !payload.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const user = await User.findById(payload.id).select("sessions");

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentSessionId = payload.sessionId;
    const rawSessions = Array.isArray(user.sessions) ? user.sessions : [];

    // Sort by lastActive (newest first)
    const sessions = rawSessions
      .map((s) => ({
        _id: s._id,
        sessionId: s.sessionId,
        device: s.device || "Desktop",
        browser: s.browser || "Browser",
        os: s.os || "OS",
        ip: s.ip || "Unknown IP",
        lastActive: s.lastActive || s.createdAt || new Date(),
        createdAt: s.createdAt || new Date(),
        isCurrent: Boolean(currentSessionId && s.sessionId === currentSessionId),
      }))
      .sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
      });

    return NextResponse.json({
      success: true,
      sessions,
      totalDevices: sessions.length,
      currentSessionId,
    });
  } catch (error) {
    console.error("[GET /api/users/sessions Error]:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload || !payload.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const user = await User.findById(payload.id);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentSessionId = payload.sessionId;
    const { searchParams } = new URL(request.url);
    
    // Read parameters
    let targetSessionId = searchParams.get("sessionId");
    let isAllOther = searchParams.get("allOther") === "true";

    if (!targetSessionId && !isAllOther) {
      try {
        const body = await request.json();
        if (body && typeof body === "object") {
          if (body.sessionId) targetSessionId = String(body.sessionId);
          if (body.allOther) isAllOther = true;
        }
      } catch (e) {
        // Body reading is optional
      }
    }

    const currentSessions = Array.isArray(user.sessions) ? user.sessions : [];

    if (isAllOther) {
      // Keep only current session
      const remainingSessions = currentSessions.filter((s) => s.sessionId === currentSessionId);
      user.sessions = remainingSessions;
      await user.save();

      return NextResponse.json({
        success: true,
        message: "Successfully logged out of all other devices.",
        remainingCount: remainingSessions.length,
      });
    }

    if (targetSessionId) {
      const isLoggingOutSelf = targetSessionId === currentSessionId;
      const updatedSessions = currentSessions.filter((s) => s.sessionId !== targetSessionId);
      user.sessions = updatedSessions;
      await user.save();

      const response = NextResponse.json({
        success: true,
        message: isLoggingOutSelf ? "Current session logged out." : "Device logged out successfully.",
        isCurrent: isLoggingOutSelf,
        remainingCount: updatedSessions.length,
      });

      if (isLoggingOutSelf) {
        response.cookies.delete("admin_token");
      }

      return response;
    }

    return NextResponse.json({ error: "No sessionId or allOther flag provided" }, { status: 400 });
  } catch (error) {
    console.error("[DELETE /api/users/sessions Error]:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

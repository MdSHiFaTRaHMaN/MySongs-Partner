import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import AccessRequest from "@/models/AccessRequest";
import User from "@/models/User";
import { jwtVerify } from "jose";

export async function GET(request) {
  try {
    await dbConnect();

    const token = request.cookies.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    let payload;
    try {
      const { payload: jwtPayload } = await jwtVerify(token, secret);
      payload = jwtPayload;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    let requests;
    const cleanRole = String(payload.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const isAdmin = cleanRole === "superadmin" || payload.role === "super_admin" || cleanRole === "admin" || payload.role === "admin";

    if (isAdmin) {
      requests = await AccessRequest.find({}).sort({ createdAt: -1 });
    } else {
      requests = await AccessRequest.find({ userId: payload.id }).sort({ createdAt: -1 });
    }

    return NextResponse.json({ success: true, requests }, { status: 200 });
  } catch (error) {
    console.error("[AccessRequests API GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await dbConnect();

    const token = request.cookies.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    let payload;
    try {
      const { payload: jwtPayload } = await jwtVerify(token, secret);
      payload = jwtPayload;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { requestedPath, requestedPathLabel, reason } = await request.json();

    if (!requestedPath) {
      return NextResponse.json({ error: "Requested path is required" }, { status: 400 });
    }

    // Check if user exists
    const user = await User.findById(payload.id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if request already pending
    const existing = await AccessRequest.findOne({
      userId: user._id,
      requestedPath,
      status: "pending",
    });

    if (existing) {
      return NextResponse.json(
        { success: true, message: "A request for this feature is already pending review.", accessRequest: existing },
        { status: 200 }
      );
    }

    const newRequest = await AccessRequest.create({
      userId: user._id,
      userEmail: user.email,
      userName: user.name,
      requestedPath,
      requestedPathLabel: requestedPathLabel || requestedPath,
      reason: reason || "",
      status: "pending",
    });

    return NextResponse.json({ success: true, accessRequest: newRequest }, { status: 201 });
  } catch (error) {
    console.error("[AccessRequests API POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    await dbConnect();

    const token = request.cookies.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    let payload;
    try {
      const { payload: jwtPayload } = await jwtVerify(token, secret);
      payload = jwtPayload;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (payload.role !== "admin" && payload.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden: Only admins can review access requests" }, { status: 403 });
    }

    const { requestId, action } = await request.json(); // action: "approve" or "reject"

    if (!requestId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "requestId and valid action (approve/reject) are required" }, { status: 400 });
    }

    const accessReq = await AccessRequest.findById(requestId);
    if (!accessReq) {
      return NextResponse.json({ error: "Access request not found" }, { status: 404 });
    }

    if (action === "approve") {
      accessReq.status = "approved";
      await accessReq.save();

      // Add permission path to user
      const user = await User.findById(accessReq.userId);
      if (user) {
        const currentPerms = user.permissions || [];
        if (!currentPerms.includes(accessReq.requestedPath)) {
          user.permissions = [...currentPerms, accessReq.requestedPath];
          await user.save();
        }
      }
    } else {
      accessReq.status = "rejected";
      await accessReq.save();
    }

    return NextResponse.json({ success: true, accessRequest: accessReq }, { status: 200 });
  } catch (error) {
    console.error("[AccessRequests API PUT] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

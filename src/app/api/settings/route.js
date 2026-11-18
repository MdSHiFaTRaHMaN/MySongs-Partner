import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import dbConnect from "@/lib/mongoose";
import Settings from "@/models/Settings";
import { clearSettingsCache } from "@/lib/getSettings";

export const dynamic = "force-dynamic";

// Helper to get payload
async function getAdminPayload(request) {
  let token = request?.cookies?.get("admin_token")?.value;
  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get("admin_token")?.value;
    } catch (e) {}
  }
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
    const payload = await getAdminPayload(request);
    const canView = payload?.role === "admin" || payload?.role === "super_admin" || (Array.isArray(payload?.permissions) && payload.permissions.includes("/"));
    if (!payload || !canView) {
      return NextResponse.json({ error: "Forbidden: Only admins can view settings" }, { status: 403 });
    }

    await dbConnect();
    let settings = await Settings.findOne({});
    
    if (!settings) {
      settings = await Settings.create({});
    }

    return NextResponse.json(settings, { status: 200 });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ message: "Error fetching settings", error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const payload = await getAdminPayload(request);
    const canUpdate = payload?.role === "admin" || payload?.role === "super_admin" || (Array.isArray(payload?.permissions) && payload.permissions.includes("/"));
    if (!payload || !canUpdate) {
      return NextResponse.json({ error: "Forbidden: Only admins can update settings" }, { status: 403 });
    }

    const data = await request.json();
    await dbConnect();

    if (data.monthlyTarget !== undefined) {
      const cleaned = Number(String(data.monthlyTarget).replace(/[^0-9.]/g, ""));
      if (!isNaN(cleaned) && cleaned > 0) {
        data.monthlyTarget = cleaned;
      } else {
        delete data.monthlyTarget;
      }
    }

    // Update settings doc or create one if none exists
    const settings = await Settings.findOneAndUpdate(
      {},
      { $set: data },
      { new: true, returnDocument: 'after', upsert: true }
    );

    clearSettingsCache();

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
      monthlyTarget: settings.monthlyTarget,
      settings
    }, { status: 200 });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ message: "Error updating settings", error: error.message }, { status: 500 });
  }
}

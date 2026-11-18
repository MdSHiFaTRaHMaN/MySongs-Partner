import { NextResponse } from "next/server";
import { emptyTrashBinOnly } from "@/lib/trashCleanup";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

async function verifyAdminAuth() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return false;
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
    const { payload } = await jwtVerify(token, secret);
    return payload?.role === "admin" || payload?.role === "super_admin";
  } catch (e) {
    return false;
  }
}

export async function POST(request) {
  const isAuth = await verifyAdminAuth();
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const targetType = body?.type || "all";
    const result = await emptyTrashBinOnly(targetType);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[POST /api/trash/empty Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to empty trash" }, { status: 500 });
  }
}

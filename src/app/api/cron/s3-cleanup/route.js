import { NextResponse } from "next/server";
import { runS3Cleanup } from "@/lib/s3Cleanup";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

async function verifyAuth(request) {
  // 1. Check CRON_SECRET header
  const authHeader = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "default_cron_secret_key";
  if (authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // 2. Check Admin Session Token
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (token) {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
      const { payload } = await jwtVerify(token, secret);
      if (payload?.role === "admin" || payload?.role === "super_admin") {
        return true;
      }
    }
  } catch (e) {}

  return false;
}

export async function GET(request) {
  const isAuthorized = await verifyAuth(request);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get("days");
    const retentionDays = daysParam ? parseInt(daysParam, 10) : 30;

    const result = await runS3Cleanup(retentionDays);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[GET /api/cron/s3-cleanup Error]:", error);
    return NextResponse.json(
      { error: error.message || "S3 Cleanup failed" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  return GET(request);
}

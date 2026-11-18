import { NextResponse } from "next/server";
import { POST as fulfillPOST, OPTIONS as fulfillOPTIONS } from "../fulfill/route";
import { withCORS } from "@/lib/cors";

export async function OPTIONS(request) {
  return fulfillOPTIONS(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    const rawBody = await request.json().catch(() => ({}));
    // Force orderType to "publish"
    const enrichedBody = {
      ...rawBody,
      orderType: "publish",
    };

    // Construct a new Request with the enriched body
    const enrichedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(enrichedBody),
    });

    return await fulfillPOST(enrichedRequest);
  } catch (error) {
    console.error("[Klaviyo Publish Fulfill Route] Error:", error);
    return withCORS(
      NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 }),
      origin
    );
  }
}

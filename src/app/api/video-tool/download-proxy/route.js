import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  // Security: only allow proxying from our S3 domains
  if (!url.includes("amazonaws.com")) {
    return new NextResponse("Unauthorized domain", { status: 403 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return new NextResponse("Failed to fetch asset from source", { status: 502 });
    }

    // Stream the response back to the client with CORS enabled
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[Download Proxy API] Error:", error);
    return new NextResponse("Download proxy failed", { status: 500 });
  }
}

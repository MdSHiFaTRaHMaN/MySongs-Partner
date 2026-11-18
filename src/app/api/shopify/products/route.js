import { NextResponse } from "next/server";
import { getSettings } from "@/lib/getSettings";
import { jwtVerify } from "jose";

export async function GET(request) {
  try {
    // Auth check: Check cookie or Authorization header
    let token = request.cookies.get("admin_token")?.value;
    if (!token) {
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return NextResponse.json({ error: "Unauthorized: No token provided" }, { status: 401 });
    }
    
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-fallback-key-change-me");
      const { payload } = await jwtVerify(token, secret);
      const cleanRole = String(payload.role || "").toLowerCase().replace(/[\s_-]/g, "");
      const isSuperAdmin = cleanRole === "superadmin" || payload.role === "super_admin";
      const isAdmin = isSuperAdmin || cleanRole === "admin" || payload.role === "admin" || cleanRole === "staff" || payload.role === "staff";

      if (!isAdmin && !isSuperAdmin) {
        return NextResponse.json({ error: "Forbidden: Insufficient permissions" }, { status: 403 });
      }
    } catch (tokenErr) {
      console.error("[Shopify Products API] JWT Verification Error:", tokenErr);
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const settings = await getSettings();
    if (!settings.shopUrl1 || !settings.shopifyAdminApiKey) {
      return NextResponse.json({ error: "Shopify API not configured" }, { status: 500 });
    }

    let url = settings.shopUrl1;
    if (!url.startsWith("http")) url = `https://${url}`;

    // Fetch products
    const response = await fetch(`${url}/admin/api/2024-04/products.json?limit=250&fields=id,title,image,variants`, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Shopify Products Fetch] Failed:", response.status, errText);
      return NextResponse.json({ error: "Failed to fetch products from Shopify" }, { status: 500 });
    }

    const data = await response.json();
    
    // Format the response for the frontend dropdown
    const formattedProducts = [];
    
    if (data.products) {
      for (const product of data.products) {
        const prodImage = product.image?.src || "";
        const variants = product.variants || [];

        let regularVariant = null;
        let rushVariant = null;

        for (const variant of variants) {
          const vTitle = (variant.title || "").toLowerCase();
          if (vTitle.includes("rush") || vTitle.includes("fast") || vTitle.includes("60") || vTitle.includes("express") || vTitle.includes("priorit")) {
            rushVariant = variant;
          } else if (!regularVariant) {
            regularVariant = variant;
          }
        }

        if (!regularVariant && variants.length > 0) {
          regularVariant = variants[0];
        }
        if (!rushVariant && variants.length > 1) {
          rushVariant = variants[1];
        }

        formattedProducts.push({
          id: product.id.toString(),
          productId: product.id.toString(),
          variantId: regularVariant ? regularVariant.id.toString() : (variants[0]?.id?.toString() || ""),
          rushVariantId: rushVariant ? rushVariant.id.toString() : "",
          productTitle: product.title,
          displayTitle: product.title,
          price: regularVariant ? regularVariant.price : (variants[0]?.price || ""),
          rushPrice: rushVariant ? rushVariant.price : "",
          regularVariantTitle: regularVariant ? regularVariant.title : "",
          rushVariantTitle: rushVariant ? rushVariant.title : "",
          image: prodImage
        });
      }
    }

    return NextResponse.json({ success: true, products: formattedProducts });
  } catch (error) {
    console.error("[Shopify Products Fetch] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

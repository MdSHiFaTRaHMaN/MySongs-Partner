import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import VideoOption from "@/models/VideoOption";
import { withCORS, handleOptions } from "@/lib/cors";
import { syncPackageVariantsToShopify } from "@/lib/shopifyVariantSync";

const defaultVideoOptions = {
  packages: [
    {
      id: "video_standard",
      title: "Cinematic Music Video",
      price: "€49.95",
      compareAtPrice: "€99.95",
      tagline: "Most Popular",
      features: [
        "High-Definition 1080p Cinematic Music Video",
        "Custom synchronized audio & beat transitions",
        "Includes custom background effects & color grading",
        "Ready in 24-48 Hours directly in your inbox",
        "Shareable MP4 video for all devices & social media",
        "100% Satisfaction Guarantee with free revision"
      ],
      image: "https://placehold.co/400x400/f8f9fa/101828?text=Music+Video",
      shopifyProductId: "",
      shopifyVariantId: "",
      shopifyRushVariantId: ""
    }
  ],
  rushOrderTitle: "Rush My Video Order",
  rushOrderDescription: "Order delivered in under 2 hours",
  step1Title: "Step 1: Upload your audio track",
  step1Subtitle: "Upload your custom song or any audio file you want in the music video.",
  step2Title: "Step 2: Upload photos and video clips",
  step2Subtitle: "Add your favorite pictures and short video clips to make your music video unforgettable.",
  step3Title: "Step 3: Select your package",
  step3Subtitle: "Choose your music video production package and proceed to checkout."
};

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();

    let options = await VideoOption.findOne();

    if (!options) {
      options = await VideoOption.create(defaultVideoOptions);
    }

    return withCORS(
      NextResponse.json({ success: true, data: options }, { status: 200 }),
      origin
    );
  } catch (error) {
    console.error("[GetVideoOptions] Error:", error);
    return withCORS(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      origin
    );
  }
}

export async function PUT(request) {
  const origin = request.headers.get("origin") || "";
  try {
    const data = await request.json();
    await dbConnect();

    let options = await VideoOption.findOne();

    if (!options) {
      options = new VideoOption(defaultVideoOptions);
    }

    if (data.packages) options.packages = data.packages;
    if (data.rushOrderTitle !== undefined) options.rushOrderTitle = data.rushOrderTitle;
    if (data.rushOrderDescription !== undefined) options.rushOrderDescription = data.rushOrderDescription;
    if (data.step1Title !== undefined) options.step1Title = data.step1Title;
    if (data.step1Subtitle !== undefined) options.step1Subtitle = data.step1Subtitle;
    if (data.step2Title !== undefined) options.step2Title = data.step2Title;
    if (data.step2Subtitle !== undefined) options.step2Subtitle = data.step2Subtitle;
    if (data.step3Title !== undefined) options.step3Title = data.step3Title;
    if (data.step3Subtitle !== undefined) options.step3Subtitle = data.step3Subtitle;

    await options.save();

    // Sync package prices directly to Shopify Product Variants
    let shopifySync = null;
    if (Array.isArray(data.packages) && data.packages.length > 0) {
      try {
        shopifySync = await syncPackageVariantsToShopify(data.packages);
      } catch (syncError) {
        console.error("[Shopify Video Options Sync Error]:", syncError);
      }
    }

    return withCORS(
      NextResponse.json({ success: true, data: options, shopifySync }, { status: 200 }),
      origin
    );
  } catch (error) {
    console.error("[UpdateVideoOptions] Error:", error);
    return withCORS(
      NextResponse.json({ error: error.message || "Failed to update options" }, { status: 500 }),
      origin
    );
  }
}

export async function POST(request) {
  return PUT(request);
}

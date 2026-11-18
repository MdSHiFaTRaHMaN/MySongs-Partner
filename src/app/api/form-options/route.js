import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import GenerateOption from "@/models/GenerateOption";
import { withCORS, handleOptions } from "@/lib/cors";
import { getSettings } from "@/lib/getSettings";
import { syncPackageVariantsToShopify } from "@/lib/shopifyVariantSync";

const defaultOptions = {
  occasions: [
    "Love", "Father's Day", "Mother's Day", "Birthday",
    "Anniversary", "Wedding", "Birth", "Retirement",
    "Thank You", "Farewell", "Graduation", "Other"
  ],
  genres: [
    "Pop", "Acoustic", "Rock", "Country", "Jazz",
    "R&B/Soul", "EDM", "Hip-Hop", "Classical", "Latin"
  ],
  voices: ["Male", "Female", "Duet"],
  moods: ["Romantic", "Energetic", "Calm", "Inspiring", "Festive", "Emotional", "Powerful"],
  languages: ["English", "German", "Dutch", "French", "Spanish"],
  packages: [
    {
      id: "muziekbox", title: "Muziekbox", price: "€59.95", tagline: "Perfect as a gift!",
      features: ["Beautiful physical music box", "High quality audio", "Fast shipping"],
      image: "https://placehold.co/400x400/f8f9fa/101828?text=Muziekbox",
      shopifyProductId: "", shopifyVariantId: ""
    },
    {
      id: "digitaal", title: "Digitaal Liedje", price: "€29.95", tagline: "Ideal for a quick surprise",
      features: ["Digital MP3 download", "Custom lyrics included", "Direct in your inbox"],
      image: "https://placehold.co/400x400/f8f9fa/101828?text=Digitaal+Liedje",
      shopifyProductId: "", shopifyVariantId: ""
    },
    {
      id: "video", title: "Video + Liedje", price: "€69.95", tagline: "New!",
      features: ["Personalized video", "Digital MP3 included", "Perfect for sharing"],
      image: "https://placehold.co/400x400/f8f9fa/101828?text=Video+%2B+Liedje",
      shopifyProductId: "", shopifyVariantId: ""
    }
  ],
  upsells: [
    {
      id: "upsell_rush",
      title: "Rush My Order",
      subtext: "Order delivered in 30 minutes",
      price: "€19.95",
      type: "rush",
      shopifyProductId: "",
      shopifyVariantId: "",
      enabled: true,
      defaultSelected: false,
      order: 0,
    },
    {
      id: "upsell_spotify_apple",
      title: "Song on Spotify & Apple Music",
      subtext: "Stream it anytime and share it with friends and family",
      price: "€19.95",
      type: "product",
      shopifyProductId: "",
      shopifyVariantId: "",
      enabled: true,
      defaultSelected: false,
      order: 1,
    }
  ],
  rushOrderTitle: "Rush My Order",
  rushOrderDescription: "Order delivered in 60 minutes"
};

// Preflight — the browser sends this automatically before the real GET/PUT.
// Without this, the actual request never goes out and shows up as a CORS error.
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();

    // Check if options exist
    let options = await GenerateOption.findOne();

    // If no options exist, create them with defaults
    if (!options) {
      options = await GenerateOption.create(defaultOptions);
    } else if (!options.upsells || options.upsells.length === 0) {
      // Auto-migrate existing database with default upsells
      options.upsells = defaultOptions.upsells;
      await options.save();
    }

    return withCORS(
      NextResponse.json({ success: true, data: options }, { status: 200 }),
      origin
    );
  } catch (error) {
    console.error("[GetFormOptions] Error:", error);
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

    let options = await GenerateOption.findOne();

    if (!options) {
      options = new GenerateOption();
    }

    const oldPackages = options.packages ? JSON.parse(JSON.stringify(options.packages)) : [];

    // Update fields
    if (data.occasions) options.occasions = data.occasions;
    if (data.genres) options.genres = data.genres;
    if (data.voices) options.voices = data.voices;
    if (data.moods) options.moods = data.moods;
    if (data.languages) options.languages = data.languages;
    if (data.packages) options.packages = data.packages;
    if (data.upsells !== undefined) options.upsells = data.upsells;
    if (data.rushOrderTitle !== undefined) options.rushOrderTitle = data.rushOrderTitle;
    if (data.rushOrderDescription !== undefined) options.rushOrderDescription = data.rushOrderDescription;

    await options.save();

    // Sync package prices directly to Shopify Product Variants
    let shopifySync = null;
    if (Array.isArray(data.packages) && data.packages.length > 0) {
      try {
        shopifySync = await syncPackageVariantsToShopify(data.packages);
      } catch (syncError) {
        console.error("[Shopify Form Options Sync Error]:", syncError);
      }
    }

    return withCORS(
      NextResponse.json({ success: true, data: options, shopifySync }, { status: 200 }),
      origin
    );
  } catch (error) {
    console.error("[UpdateFormOptions] Error:", error);
    return withCORS(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      origin
    );
  }
}
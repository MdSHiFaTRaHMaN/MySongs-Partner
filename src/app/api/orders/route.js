import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { withCORS, handleOptions } from "@/lib/cors";
import { decryptTaskId } from "@/lib/encryption";
import { getSettings } from "@/lib/getSettings";
import { generatePresignedUrl } from "@/lib/s3";

// Preflight — the browser sends this automatically before the real POST.
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    await dbConnect();
    const settings = await getSettings();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const email = searchParams.get("email")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "";
    const pageParam = parseInt(searchParams.get("page") || "1", 10);
    const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limitParam = parseInt(searchParams.get("limit") || String(settings.tableItemsPerPage || 50), 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 50 : limitParam;

    const query = {
      isDeleted: { $ne: true },
    };

    if (email) {
      query.email = { $regex: email, $options: "i" };
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: "i" } },
        { shopifyOrderId: { $regex: search, $options: "i" } },
        { taskId: { $regex: search, $options: "i" } },
        { musicId: { $regex: search, $options: "i" } },
        { occasion: { $regex: search, $options: "i" } },
      ];
    }

    const totalCount = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const skip = (page - 1) * limit;

    const rawOrders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Convert S3 keys to presigned URLs for browser playback
    const orders = await Promise.all(
      rawOrders.map(async (doc) => {
        const order = doc.toObject ? doc.toObject() : { ...doc };
        if (order.musicTracks && order.musicTracks.length > 0) {
          for (const track of order.musicTracks) {
            if (track.audioUrl && !track.audioUrl.startsWith("http")) {
              try {
                track.audioUrl = await generatePresignedUrl(track.audioUrl, 604800);
              } catch (e) {}
            }
            if (track.streamAudioUrl && !track.streamAudioUrl.startsWith("http")) {
              try {
                track.streamAudioUrl = await generatePresignedUrl(track.streamAudioUrl, 604800);
              } catch (e) {}
            }
          }
        }
        if (order.audioUrl && !order.audioUrl.startsWith("http")) {
          try {
            order.audioUrl = await generatePresignedUrl(order.audioUrl, 604800);
          } catch (e) {}
        }
        return order;
      })
    );

    return NextResponse.json(
      {
        success: true,
        orders,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[orders] GET Error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    await dbConnect();

    const body = await request.json();
    const { formData, musicTracks, taskId: rawTaskId, musicId, productId, variantId } = body;
    // Always use the raw (decrypted) taskId for DB operations
    const taskId = decryptTaskId(rawTaskId);

    if (!formData?.email || !taskId) {
      return withCORS(
        NextResponse.json(
          { error: "Email and taskId are required" },
          { status: 400 }
        ),
        origin
      );
    }

    const existingOrder = await Order.findOne({ email: formData.email, taskId: taskId });
    let newStatus = existingOrder?.status || "created";

    // If they selected a package and the order isn't already paid or pending from Shopify, mark it as in_cart
    if (formData.selectedPackage && (newStatus === "created" || newStatus === "pending_payment")) {
      newStatus = "in_cart";
    }

    // Upsert the order: if it already exists for this taskId and email, update it.
    // Otherwise, create a new record.
    const order = await Order.findOneAndUpdate(
      { email: formData.email, taskId: taskId },
      {
        $set: {
          occasion: formData.occasion,
          forWho: formData.forWho,
          recipientName: formData.recipientName,
          genre: formData.genre,
          voice: formData.voice,
          mood: formData.mood,
          language: formData.language || formData.lyricsLanguage || "English",
          lyrics: formData.lyrics,
          selectedDemo: formData.selectedDemo,
          selectedPackage: formData.selectedPackage,
          orderNotes: formData.orderNotes,
          musicId: musicId || undefined, // opaque public ID — maps back to this taskId for support/admin lookups
          shopifyProductId: productId || undefined,
          shopifyVariantId: variantId || undefined,
          status: newStatus,
        },
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );

    return withCORS(NextResponse.json({ success: true, order }), origin);
  } catch (error) {
    console.error("[orders] POST Error:", error);
    return withCORS(
      NextResponse.json(
        { error: "Failed to save order to database" },
        { status: 500 }
      ),
      origin
    );
  }
}
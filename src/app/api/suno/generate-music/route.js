import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import VideoOrder from "@/models/VideoOrder";
import Notification from "@/models/Notification";
import Customer from "@/models/Customer";
import { getSettings } from "@/lib/getSettings";
import { withCORS, handleOptions } from "@/lib/cors";
import { checkAbandonedCart } from "@/lib/abandonedCartChecker";
import { encryptTaskId } from "@/lib/encryption";
import { musicQueue } from "@/lib/queue";
import { verifyTurnstile, checkRateLimit, checkUserRateLimits, getClientIp, isLocalOrPrivateIp, isValidPublicIp, cleanIp } from "@/lib/security";

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    const settings = await getSettings();
    const originHeader = request.headers.get("origin") || "";
    const refererHeader = request.headers.get("referer") || "";
    const allowedOrigins = [
      settings.shopUrl1,
      settings.shopUrl2,
      process.env.NEXT_PUBLIC_APP_URL,
      "http://localhost:3000",
      "http://localhost:3001",
    ].filter(Boolean);

    const host = request.headers.get("host") || "";
    const isAllowed = (!originHeader && !refererHeader) || allowedOrigins.some((allowed) => {
      try {
        const allowedUrl = new URL(allowed);
        const originUrl = originHeader ? new URL(originHeader) : null;
        const refererUrl = refererHeader ? new URL(refererHeader) : null;
        const hostMatch = (url) => url && url.host === allowedUrl.host;
        return hostMatch(originUrl) || hostMatch(refererUrl);
      } catch (e) {
        return originHeader.startsWith(allowed) || refererHeader.startsWith(allowed);
      }
    }) || (host && (originHeader.includes(host) || refererHeader.includes(host) || host.includes("localhost")));

    if (!isAllowed) {
      return withCORS(
        NextResponse.json({ error: "Unauthorized: Request origin not allowed" }, { status: 403 }),
        origin
      );
    }

    const activeProvider = settings.activeAiProvider === "mureka" ? "mureka" : "suno";
    const apiKey = activeProvider === "mureka"
      ? (settings.murekaApiKey || process.env.MUREKA_API_KEY)
      : (settings.sunoApiKey || process.env.SUNO_API_KEY);

    if (!apiKey) {
      const providerName = activeProvider === "mureka" ? "Mureka AI" : "Suno AI";
      return withCORS(
        NextResponse.json({ error: `${providerName} API Key not configured. Please set it in Settings.` }, { status: 500 }),
        origin
      );
    }

    const bodyText = await request.text();
    if (!bodyText) {
      return withCORS(NextResponse.json({ error: "Empty request body" }, { status: 400 }), origin);
    }
    const reqBody = JSON.parse(bodyText);
    const { lyrics, title, style, formData, hp_website, turnstileToken, resumeBaseUrl, visitorId, clientIp: clientIpFromBody } = reqBody;

    const serverIp = getClientIp(request);
    const ip = (clientIpFromBody && isValidPublicIp(clientIpFromBody) ? cleanIp(clientIpFromBody) : null) || serverIp;

    if (!lyrics) {
      return withCORS(NextResponse.json({ error: "Lyrics are required" }, { status: 400 }), origin);
    }
    if (!formData || !formData.email) {
      return withCORS(
        NextResponse.json({ error: "Email is required to save the generated order" }, { status: 400 }),
        origin
      );
    }

    const flagCustomer = async (email) => {
      if (!email) return;
      try {
        await dbConnect();
        await Customer.findOneAndUpdate(
          { email },
          { 
            $inc: { securityFlags: 1 },
            ...(isValidPublicIp(ip) ? { $addToSet: { knownIps: ip } } : {})
          },
          { upsert: true }
        );
      } catch (e) {
        console.error("Failed to flag customer", e);
      }
    };

    await dbConnect();

    if (formData?.email && isValidPublicIp(ip)) {
      try {
        await Customer.findOneAndUpdate(
          { email: formData.email },
          {
            $addToSet: { knownIps: ip },
          },
          { upsert: true }
        );
      } catch (e) {
        console.error("Failed to associate IP with customer:", e);
      }
    }

    const orConditions = [];
    if (formData?.email) {
      orConditions.push({ email: formData.email, isBlocked: true });
      orConditions.push({ email: formData.email, blockedUntil: { $gt: new Date() } });
    }
    if (isValidPublicIp(ip)) {
      orConditions.push({ knownIps: ip, isBlocked: true });
      orConditions.push({ knownIps: ip, blockedUntil: { $gt: new Date() } });
    }

    if (orConditions.length > 0) {
      const blockedCustomer = await Customer.findOne({ $or: orConditions });
      if (blockedCustomer) {
        if (blockedCustomer.isBlocked) {
          const reason = blockedCustomer.blockReason || "Your account has been restricted from generating music.";
          return withCORS(NextResponse.json({ error: reason }, { status: 403 }), origin);
        }
        if (blockedCustomer.blockedUntil && new Date() < new Date(blockedCustomer.blockedUntil)) {
          return withCORS(NextResponse.json({ error: "Your account is temporarily blocked for 24 hours due to excessive generations." }, { status: 403 }), origin);
        }
      }
    }

    if (hp_website) {
      await flagCustomer(formData?.email);
      return withCORS(NextResponse.json({ error: "Invalid request format." }, { status: 400 }), origin);
    }

    if (turnstileToken && process.env.TURNSTILE_SECRET_KEY) {
      const isHuman = await verifyTurnstile(turnstileToken);
      if (!isHuman) {
        await flagCustomer(formData?.email);
        return withCORS(NextResponse.json({ error: "Human verification failed. Please refresh the page and try again." }, { status: 400 }), origin);
      }
    }

    const isRateAllowed = await checkRateLimit(ip, visitorId, 60, 3600);
    if (!isRateAllowed) {
      return withCORS(NextResponse.json({ error: "Too many requests from your IP. Please try again later." }, { status: 429 }), origin);
    }

    const isUserAllowed = await checkUserRateLimits(formData.email, settings);
    if (!isUserAllowed) {
      return withCORS(NextResponse.json({ error: "You have reached your music generation limit. Please wait before generating more." }, { status: 429 }), origin);
    }

    if (settings.autoBlockEnabled) {
      const emailRegex = new RegExp(`^${formData.email.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      const totalGenerations = await Order.countDocuments({ email: emailRegex });
      const [paidMusicCount, paidVideoCount] = await Promise.all([
        Order.countDocuments({
          email: emailRegex,
          $or: [
            { status: { $in: ["paid", "fulfilled", "delivering", "ready"] } },
            { shopifyOrderId: { $ne: null, $nin: ["", "undefined"] } },
          ],
        }),
        VideoOrder.countDocuments({
          email: emailRegex,
          isDeleted: { $ne: true },
          $or: [
            { status: { $in: ["paid", "fulfilled", "delivering", "ready"] } },
            { shopifyOrderId: { $ne: null, $nin: ["", "undefined"] } },
          ],
        }),
      ]);
      const totalPurchases = paidMusicCount + paidVideoCount;
      
      if (totalGenerations >= settings.autoBlockGenerationCount && totalPurchases <= settings.autoBlockRequiredPurchases) {
        const blockReason = "Excessive generations without purchases";
        const blockCount = (customer?.blockCount || 0) + 1;
        
        let updateData = { blockReason, blockCount };
        if (blockCount >= 2) {
          updateData.isBlocked = true;
        } else {
          updateData.blockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        
        await Customer.findOneAndUpdate(
          { email: formData.email },
          { $set: updateData },
          { upsert: true }
        );
        
        return withCORS(NextResponse.json({ error: blockCount >= 2 ? "Your account has been restricted." : "You have reached your limit. Your account is temporarily blocked for 24 hours." }, { status: 403 }), origin);
      }
    }

    const callBackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`;
    const safeStyle = (style || "Pop").substring(0, 200);
    const safeTitle = (title || "My Custom Song").substring(0, 80);
    const safeLyrics = lyrics.substring(0, 3000);

    const sunoModel = settings.sunoModel || "V3_5";
    const murekaModel = settings.murekaModel || "mureka-9.5";

    const body = {
      prompt: safeLyrics,
      style: safeStyle,
      title: safeTitle,
      customMode: true,
      instrumental: false,
      model: sunoModel,
      callBackUrl,
    };

    console.log("[generate-music] Enqueuing job for generation:", formData.email);

    const taskId = crypto.randomUUID();

    if (taskId) {
      try {
        await dbConnect();
        let targetOrder = null;
        if (reqBody.orderId && String(reqBody.orderId).match(/^[0-9a-fA-F]{24}$/)) {
          targetOrder = await Order.findById(reqBody.orderId);
        }
        if (!targetOrder && reqBody.shopifyOrderId) {
          const cleanShopId = String(reqBody.shopifyOrderId).replace(/^#/, "");
          targetOrder = await Order.findOne({
            $or: [
              { shopifyOrderId: cleanShopId },
              { shopifyOrderId: `#${cleanShopId}` },
              { shopifyOrderNumber: cleanShopId },
              { shopifyOrderNumber: `#${cleanShopId}` },
            ],
          });
        }

        const resolvedRecipientName = formData?.recipientName || formData?.recipients?.[0]?.name || "";
        const resolvedRecipients = Array.isArray(formData?.recipients) && formData.recipients.length > 0
          ? formData.recipients
          : (resolvedRecipientName ? [{ name: resolvedRecipientName, pronunciationMode: "Original", pronunciation: "" }] : []);

        if (targetOrder) {
          targetOrder.taskId = taskId;
          if (formData?.lyrics || lyrics) targetOrder.lyrics = formData?.lyrics || lyrics;
          if (formData?.genre) targetOrder.genre = formData.genre;
          if (formData?.voice) targetOrder.voice = formData.voice;
          if (formData?.mood) targetOrder.mood = formData.mood;
          if (formData?.occasion) targetOrder.occasion = formData.occasion;
          if (resolvedRecipientName) targetOrder.recipientName = resolvedRecipientName;
          if (resolvedRecipients.length > 0) targetOrder.recipients = resolvedRecipients;
          if (formData?.storyText) targetOrder.storyText = formData.storyText;
          if (formData?.creationMethod) targetOrder.creationMethod = formData.creationMethod;
          if (formData?.ownLyrics) targetOrder.ownLyrics = formData.ownLyrics;
          if (formData?.generatedLyrics) targetOrder.generatedLyrics = formData.generatedLyrics;
          if (formData) targetOrder.formData = formData;
          await targetOrder.save();
        } else {
          targetOrder = await Order.create({
            taskId: taskId,
            email: formData.email,
            occasion: formData.occasion,
            forWho: formData.forWho,
            recipientName: resolvedRecipientName,
            recipients: resolvedRecipients,
            storyText: formData.storyText || "",
            creationMethod: formData.creationMethod || "write_for_us",
            ownLyrics: formData.ownLyrics || "",
            generatedLyrics: formData.generatedLyrics || "",
            formData: formData,
            genre: formData.genre,
            voice: formData.voice,
            mood: formData.mood,
            language: formData.language || formData.lyricsLanguage || "English",
            lyrics: formData.lyrics || lyrics,
            resumeBaseUrl: resumeBaseUrl || "",
            status: "created",
          });
        }

        await Customer.findOneAndUpdate(
          { email: formData.email },
          { $addToSet: { knownIps: ip } },
          { upsert: true }
        );

        await Notification.create({
          title: "Music Generation Started",
          message: `${formData.email} started generating a song`,
          type: "music_started",
          link: `/ordered-musics/${targetOrder._id}`
        });

        if (resumeBaseUrl) {
          checkAbandonedCart(targetOrder._id, taskId, formData.email, resumeBaseUrl);
        }

        await musicQueue.add("generate-music", {
          taskId,
          orderId: targetOrder._id,
          provider: activeProvider,
          sunoBody: body,
          murekaBody: {
            lyrics: safeLyrics,
            prompt: [formData.genre, formData.voice, formData.mood, formData.occasion].filter(Boolean).join(", ") || safeStyle || "Pop, melodic",
            style: safeStyle || "Pop",
            title: safeTitle || "Custom Song",
            model: murekaModel,
          },
          apiKey: apiKey,
          apiBase: activeProvider === "mureka" ? (settings.murekaApiBase || "https://api.mureka.ai") : settings.sunoApiBase,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false
        });

      } catch (dbErr) {
        console.error("[generate-music] DB Error or Queue Error:", dbErr);
        return withCORS(NextResponse.json({ error: "Failed to process request." }, { status: 500 }), origin);
      }
    }

    return withCORS(NextResponse.json({ taskId: encryptTaskId(taskId) }), origin);
  } catch (error) {
    console.error("[generate-music] Error:", error);
    return withCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }), origin);
  }
}
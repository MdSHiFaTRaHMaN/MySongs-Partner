import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { getSettings } from "@/lib/getSettings";
import { uploadToS3, generatePresignedUrl, extractS3Key, checkS3KeyExists } from "@/lib/s3";
import { generateMurekaSong } from "@/lib/mureka";
import crypto from "crypto";

const TEMP_DIR = os.tmpdir();

function isValidSunoTaskId(id) {
  if (!id || typeof id !== "string") return false;
  const trimmed = id.trim();
  if (
    trimmed.startsWith("shopify_") ||
    trimmed.startsWith("manual_") ||
    trimmed.startsWith("task_") ||
    trimmed.startsWith("dummy_") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("track_") ||
    trimmed.startsWith("pkg_") ||
    trimmed === "undefined" ||
    trimmed === "null" ||
    trimmed === "N/A"
  ) {
    return false;
  }
  return /^[0-9a-fA-F-]{20,64}$/.test(trimmed) || /^[a-zA-Z0-9_-]{15,64}$/.test(trimmed);
}

async function downloadFileToDisk(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
  const destStream = fs.createWriteStream(destPath);
  await pipeline(response.body, destStream);
}

function createPreview(inputPath, outputPath, durationSeconds = 45) {
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .setStartTime("00:00:15")
      .setDuration(durationSeconds.toString())
      .output(outputPath)
      .on("end", () => resolve(true))
      .on("error", (err) => {
        console.warn("[sync-file] ffmpeg preview warning:", err.message || err);
        resolve(false);
      })
      .run();
  });
}

export async function POST(request) {
  try {
    await dbConnect();
    const settings = await getSettings();
    const previewDuration = settings?.previewDurationSeconds || 45;
    const body = await request.json().catch(() => ({}));
    const {
      orderId,
      shopifyOrderId,
      musicId,
      taskId: inputTaskId,
      email: inputEmail,
      action,
      customAudioUrl,
      customAudioKey,
      customTitle,
    } = body;

    let targetOrder = null;
    const cleanShopifyId = shopifyOrderId ? String(shopifyOrderId).replace(/^#/, "") : null;

    // 1. Locate Order in MongoDB
    if (orderId && String(orderId).match(/^[0-9a-fA-F]{24}$/)) {
      targetOrder = await Order.findById(orderId);
    }
    if (!targetOrder && musicId && musicId !== "N/A") {
      targetOrder = await Order.findOne({ musicId: musicId });
    }
    if (!targetOrder && cleanShopifyId) {
      targetOrder = await Order.findOne({
        $or: [
          { shopifyOrderId: cleanShopifyId },
          { shopifyOrderId: `#${cleanShopifyId}` },
          { shopifyOrderNumber: cleanShopifyId },
          { shopifyOrderNumber: `#${cleanShopifyId}` },
        ],
      });
    }

    // 2. Query Shopify order if available to inspect line item properties
    let shopifyLineProperties = [];
    let shopifyOrderData = null;
    if (cleanShopifyId && settings.shopUrl1 && settings.shopifyAdminApiKey) {
      try {
        let shopUrl = settings.shopUrl1;
        if (!shopUrl.startsWith("http")) shopUrl = `https://${shopUrl}`;
        const shopifyRes = await fetch(`${shopUrl}/admin/api/2024-04/orders/${cleanShopifyId}.json`, {
          headers: {
            "X-Shopify-Access-Token": settings.shopifyAdminApiKey,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (shopifyRes.ok) {
          const shopifyJson = await shopifyRes.json();
          shopifyOrderData = shopifyJson?.order;
          if (shopifyOrderData && shopifyOrderData.line_items) {
            shopifyOrderData.line_items.forEach((item) => {
              (item.properties || []).forEach((p) => {
                shopifyLineProperties.push({ name: p.name, value: p.value, lineItemId: item.id });
              });
            });
          }
        }
      } catch (err) {
        console.error("[sync-file] Shopify query error:", err);
      }
    }

    // Check Shopify line properties for Audio URL, Music ID, Task ID
    const propAudioUrl = shopifyLineProperties.find(
      (p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "audiourl"
    )?.value;

    const propMusicId = shopifyLineProperties.find(
      (p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "musicid"
    )?.value || musicId;

    const propTaskId = shopifyLineProperties.find(
      (p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "taskid"
    )?.value || inputTaskId;

    const propSongTitle = shopifyLineProperties.find(
      (p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "songtitle"
    )?.value || "Custom Song";

    const propLyrics = shopifyLineProperties.find(
      (p) => (p.name || "").toLowerCase().replace(/[\s_-]/g, "") === "lyrics"
    )?.value || "";

    // If targetOrder not found yet, inspect _Audio_Url for folder match `music/<objectId>/`
    if (!targetOrder && propAudioUrl) {
      const extractedKey = extractS3Key(propAudioUrl);
      const folderMatch = extractedKey?.match(/music\/([0-9a-fA-F]{24})\//);
      if (folderMatch) {
        targetOrder = await Order.findById(folderMatch[1]);
      }
    }

    // If still not found, check by propMusicId or inputEmail
    if (!targetOrder && propMusicId && propMusicId !== "N/A") {
      targetOrder = await Order.findOne({ musicId: propMusicId });
    }

    const customerEmail = shopifyOrderData?.email || shopifyOrderData?.customer?.email || inputEmail;
    if (!targetOrder && customerEmail) {
      targetOrder = await Order.findOne({
        email: { $regex: new RegExp(`^${customerEmail.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      }).sort({ createdAt: -1 });
    }

    const activeProvider = settings.activeAiProvider === "mureka" ? "mureka" : "suno";
    const isMureka = activeProvider === "mureka";
    const apiKey = isMureka
      ? (settings.murekaApiKey || process.env.MUREKA_API_KEY)
      : (settings.sunoApiKey || process.env.SUNO_API_KEY);
    const apiBase = isMureka
      ? (settings.murekaApiBase || "https://api.mureka.ai")
      : (settings.sunoApiBase || "https://api.sunoapi.org");

    // ─────────────────────────────────────────────────────────────
    // 3. ACTION: START AI GENERATION (SUNO / MUREKA)
    // ─────────────────────────────────────────────────────────────
    if (action === "start_generation") {
      if (!apiKey) {
        const providerName = isMureka ? "Mureka AI" : "Suno AI";
        return NextResponse.json({ success: false, error: `${providerName} API key is not configured in Settings.` }, { status: 400 });
      }

      const songLyrics = targetOrder?.lyrics || propLyrics || "A beautiful custom song full of memories and love.";
      const songStyle = [targetOrder?.genre, targetOrder?.voice, targetOrder?.mood, targetOrder?.occasion].filter(Boolean).join(", ") || "Pop, Melodic";
      const songTitle = propSongTitle || (targetOrder?.recipientName ? `Song for ${targetOrder.recipientName}` : "Custom Song");
      
      console.log(`[sync-file] Starting fresh ${isMureka ? "Mureka AI" : "Suno AI"} generation for order... Title: ${songTitle}`);

      let newTaskId = null;

      if (isMureka) {
        const murekaModel = settings.murekaModel || "mureka-9.5";
        try {
          const murekaRes = await generateMurekaSong(
            apiKey,
            {
              lyrics: songLyrics.substring(0, 3000),
              prompt: songStyle.substring(0, 200),
              style: songStyle.substring(0, 200),
              title: songTitle.substring(0, 80),
              model: murekaModel,
              callBackUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`,
            },
            apiBase
          );
          newTaskId = `mureka_${murekaRes.taskId}`;
        } catch (mErr) {
          return NextResponse.json({
            success: false,
            error: mErr.message || "Failed to start Mureka AI generation. Please check Mureka API Key in Settings.",
          }, { status: 400 });
        }
      } else {
        const sunoModel = settings.sunoModel || "V3_5";
        const startRes = await fetch(`${apiBase}/api/v1/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            prompt: songLyrics.substring(0, 3000),
            style: songStyle.substring(0, 200),
            title: songTitle.substring(0, 80),
            customMode: true,
            instrumental: false,
            model: sunoModel,
            callBackUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`,
          }),
        });

        const startData = await startRes.json();
        if (startData.code !== 200 || !startData.data?.taskId) {
          return NextResponse.json({
            success: false,
            error: startData.msg || "Failed to start Suno AI generation. Please check API credits/key in Settings.",
          }, { status: 400 });
        }
        newTaskId = startData.data.taskId;
      }

      console.log(`[sync-file] AI task created: ${newTaskId}. Saved to order.`);

      if (targetOrder) {
        targetOrder.taskId = newTaskId;
        if (cleanShopifyId && !targetOrder.shopifyOrderId) {
          targetOrder.shopifyOrderId = cleanShopifyId;
        }
        await targetOrder.save();
      } else {
        targetOrder = new Order({
          email: customerEmail || "customer@myownsongs.cloud",
          taskId: newTaskId,
          musicId: (propMusicId && propMusicId !== "N/A") ? propMusicId : `music_${crypto.randomBytes(4).toString("hex")}`,
          shopifyOrderId: cleanShopifyId || "",
          shopifyOrderNumber: shopifyOrderData?.name || `#${shopifyOrderData?.order_number || cleanShopifyId}`,
          status: "paid",
        });
        await targetOrder.save();
      }

      return NextResponse.json({
        success: true,
        status: "GENERATING",
        taskId: newTaskId,
        orderId: targetOrder._id.toString(),
        provider: activeProvider,
        message: `Music generation started on ${isMureka ? "Mureka AI" : "Suno AI"}!`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. MANUAL CUSTOM AUDIO UPLOAD OR URL
    // ─────────────────────────────────────────────────────────────
    if (customAudioKey || customAudioUrl) {
      const audioKey = customAudioKey || extractS3Key(customAudioUrl);
      if (!targetOrder) {
        targetOrder = new Order({
          email: customerEmail || "support@myownsongs.cloud",
          taskId: isValidSunoTaskId(inputTaskId) ? inputTaskId : `manual_${crypto.randomUUID()}`,
          musicId: (propMusicId && propMusicId !== "N/A") ? propMusicId : `music_${crypto.randomBytes(4).toString("hex")}`,
          shopifyOrderId: cleanShopifyId || "",
          shopifyOrderNumber: shopifyOrderData?.name || `#${shopifyOrderData?.order_number || cleanShopifyId}`,
          status: "paid",
        });
      }

      const newTrack = {
        id: `track_${crypto.randomUUID()}`,
        title: customTitle || propSongTitle || "Custom Song",
        audioUrl: audioKey,
        streamAudioUrl: audioKey,
        lyrics: propLyrics || targetOrder.lyrics || "",
      };
      targetOrder.musicTracks = [newTrack];
      targetOrder.selectedDemo = newTrack.id;
      if (cleanShopifyId && !targetOrder.shopifyOrderId) {
        targetOrder.shopifyOrderId = cleanShopifyId;
      }
      if (shopifyOrderData?.name && !targetOrder.shopifyOrderNumber) {
        targetOrder.shopifyOrderNumber = shopifyOrderData.name;
      }
      await targetOrder.save();

      const presigned = await generatePresignedUrl(audioKey, 7 * 24 * 3600);
      return NextResponse.json({
        success: true,
        status: "COMPLETED",
        message: "Audio file uploaded and attached to S3 & database successfully!",
        track: { ...newTrack, audioUrl: presigned, streamAudioUrl: presigned },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. IF S3 FILE ALREADY EXISTS
    // ─────────────────────────────────────────────────────────────
    if (propAudioUrl) {
      const extractedKey = extractS3Key(propAudioUrl);
      if (extractedKey && (extractedKey.startsWith("music/") || extractedKey.endsWith(".mp3"))) {
        const existsOnS3 = await checkS3KeyExists(extractedKey);
        if (existsOnS3) {
          if (!targetOrder) {
            targetOrder = new Order({
              email: customerEmail || "customer@myownsongs.cloud",
              taskId: isValidSunoTaskId(propTaskId) ? propTaskId : `task_${crypto.randomUUID()}`,
              musicId: (propMusicId && propMusicId !== "N/A") ? propMusicId : `music_${crypto.randomBytes(4).toString("hex")}`,
              shopifyOrderId: cleanShopifyId || "",
              shopifyOrderNumber: shopifyOrderData?.name || `#${shopifyOrderData?.order_number || cleanShopifyId}`,
              status: "paid",
            });
          }

          const restoredTrack = {
            id: `track_${crypto.randomUUID()}`,
            title: propSongTitle,
            audioUrl: extractedKey,
            streamAudioUrl: extractedKey,
            lyrics: propLyrics || targetOrder.lyrics || "",
          };

          targetOrder.musicTracks = [restoredTrack];
          targetOrder.selectedDemo = restoredTrack.id;
          if (cleanShopifyId && !targetOrder.shopifyOrderId) {
            targetOrder.shopifyOrderId = cleanShopifyId;
          }
          if (shopifyOrderData?.name && !targetOrder.shopifyOrderNumber) {
            targetOrder.shopifyOrderNumber = shopifyOrderData.name;
          }
          await targetOrder.save();

          const presignedUrl = await generatePresignedUrl(extractedKey, 7 * 24 * 3600);
          return NextResponse.json({
            success: true,
            status: "COMPLETED",
            message: "Music file confirmed on S3 storage and connected successfully!",
            tracks: [{ ...restoredTrack, audioUrl: presignedUrl, streamAudioUrl: presignedUrl }],
          });
        }
      }
    }

    if (targetOrder && targetOrder.musicTracks && targetOrder.musicTracks.length > 0) {
      const validTracks = targetOrder.musicTracks.filter((t) => t.audioUrl || t.streamAudioUrl);
      if (validTracks.length > 0) {
        const primaryKey = extractS3Key(validTracks[0].audioUrl || validTracks[0].streamAudioUrl);
        const existsOnS3 = await checkS3KeyExists(primaryKey);

        if (existsOnS3) {
          if (cleanShopifyId && !targetOrder.shopifyOrderId) {
            targetOrder.shopifyOrderId = cleanShopifyId;
          }
          if (shopifyOrderData?.name && !targetOrder.shopifyOrderNumber) {
            targetOrder.shopifyOrderNumber = shopifyOrderData.name;
          }
          await targetOrder.save();

          const presignedTracks = await Promise.all(
            targetOrder.musicTracks.map(async (t) => {
              const track = JSON.parse(JSON.stringify(t));
              const aKey = extractS3Key(track.audioUrl);
              const sKey = extractS3Key(track.streamAudioUrl || track.audioUrl);
              if (aKey) {
                track.audioUrl = await generatePresignedUrl(aKey, 7 * 24 * 3600);
              }
              if (sKey) {
                track.streamAudioUrl = await generatePresignedUrl(sKey, 7 * 24 * 3600);
              }
              return track;
            })
          );

          return NextResponse.json({
            success: true,
            status: "COMPLETED",
            message: "Music file presigned links refreshed successfully!",
            tracks: presignedTracks,
          });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 6. FETCH / POLL TASK ID FROM SUNO AI
    // ─────────────────────────────────────────────────────────────
    let effectiveTaskId = null;
    if (isValidSunoTaskId(inputTaskId)) {
      effectiveTaskId = inputTaskId;
    } else if (isValidSunoTaskId(propTaskId)) {
      effectiveTaskId = propTaskId;
    } else if (isValidSunoTaskId(targetOrder?.taskId)) {
      effectiveTaskId = targetOrder.taskId;
    } else if (customerEmail) {
      const siblingOrder = await Order.findOne({
        email: { $regex: new RegExp(`^${customerEmail.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        taskId: { $regex: /^[0-9a-fA-F-]{20,64}$/ },
      }).sort({ createdAt: -1 });

      if (siblingOrder && isValidSunoTaskId(siblingOrder.taskId)) {
        effectiveTaskId = siblingOrder.taskId;
        if (!targetOrder) targetOrder = siblingOrder;
      }
    }

    if (effectiveTaskId && isValidSunoTaskId(effectiveTaskId) && apiKey) {
      try {
        console.log(`[sync-file] Querying Suno API for valid taskId: ${effectiveTaskId}`);
        const sunoRes = await fetch(`${apiBase}/api/v1/generate/record-info?taskId=${effectiveTaskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
        });

        if (sunoRes.ok) {
          const sunoData = await sunoRes.json();
          const taskStatus = sunoData?.data?.status;
          const tracks = sunoData?.data?.response?.sunoData || [];

          // If Suno generation explicitly failed
          const failedStatuses = ["FAILED", "CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"];
          if (failedStatuses.includes(taskStatus)) {
            return NextResponse.json({
              success: false,
              status: "FAILED",
              error: sunoData?.data?.errorMessage || sunoData?.data?.error || `Generation failed on Suno AI with status: ${taskStatus}`,
            }, { status: 400 });
          }

          // If Suno is still generating / composing
          const pendingStatuses = ["PENDING", "TEXT_SUCCESS", "IN_PROGRESS", "QUEUED", "RUNNING", "PROCESSING"];
          const isPending = pendingStatuses.includes(taskStatus) || 
            (!["FIRST_SUCCESS", "SUCCESS"].includes(taskStatus) && tracks.length === 0 && sunoData?.code === 200 && sunoData?.data);

          if (isPending) {
            return NextResponse.json({
              success: true,
              status: "PENDING",
              taskId: effectiveTaskId,
              message: `Suno AI is composing and rendering audio tracks (${taskStatus || "PROCESSING"})...`,
            });
          }

          // If Suno only has the first variation ready, keep waiting for the 2nd variation
          const validAudioTracks = tracks.filter((t) => t.audioUrl);
          if (taskStatus === "FIRST_SUCCESS" && validAudioTracks.length < 2) {
            return NextResponse.json({
              success: true,
              status: "PENDING",
              taskId: effectiveTaskId,
              message: "First variation ready, generating second variation...",
            });
          }

          if (["FIRST_SUCCESS", "SUCCESS"].includes(taskStatus) || validAudioTracks.length > 0) {
            if (validAudioTracks.length > 0) {
              if (!targetOrder) {
                targetOrder = new Order({
                  email: customerEmail || "customer@myownsongs.cloud",
                  taskId: effectiveTaskId,
                  musicId: (propMusicId && propMusicId !== "N/A") ? propMusicId : `music_${crypto.randomBytes(4).toString("hex")}`,
                  shopifyOrderId: cleanShopifyId || "",
                  shopifyOrderNumber: shopifyOrderData?.name || `#${shopifyOrderData?.order_number || cleanShopifyId}`,
                  status: "paid",
                });
                await targetOrder.save();
              }

              const fetchedTracks = [];
              for (let i = 0; i < validAudioTracks.length; i++) {
                const t = validAudioTracks[i];
                const trackId = t.id || crypto.randomUUID();
                const fullPath = path.join(TEMP_DIR, `${trackId}_full.mp3`);
                const previewPath = path.join(TEMP_DIR, `${trackId}_preview.mp3`);

                try {
                  console.log(`[sync-file] Downloading track ${i + 1}/${validAudioTracks.length} (${trackId}) from Suno: ${t.audioUrl}...`);
                  await downloadFileToDisk(t.audioUrl, fullPath);

                  console.log(`[sync-file] Creating ${previewDuration}s preview for track ${trackId}...`);
                  const previewCreated = await createPreview(fullPath, previewPath, previewDuration);

                  const s3FullKey = `music/${targetOrder._id}/${crypto.randomUUID()}.mp3`;
                  const s3PreviewKey = `music/${targetOrder._id}/${crypto.randomUUID()}_preview.mp3`;

                  console.log(`[sync-file] Uploading track ${trackId} to S3...`);
                  await uploadToS3(fullPath, s3FullKey, "audio/mpeg");

                  if (previewCreated && fs.existsSync(previewPath)) {
                    await uploadToS3(previewPath, s3PreviewKey, "audio/mpeg");
                  }

                  const baseTitle = propSongTitle || targetOrder?.recipientName ? `Song for ${targetOrder.recipientName}` : "Custom Song";
                  const trackTitle = t.title || (validAudioTracks.length > 1 ? `${baseTitle} (Version ${i + 1})` : baseTitle);

                  fetchedTracks.push({
                    id: trackId,
                    title: trackTitle,
                    audioUrl: s3FullKey,
                    streamAudioUrl: previewCreated ? s3PreviewKey : s3FullKey,
                    imageUrl: t.imageUrl || "",
                    duration: t.duration || 0,
                    lyrics: t.prompt || propLyrics || targetOrder.lyrics || "",
                  });
                } catch (e) {
                  console.error(`[sync-file] Error processing Suno track ${trackId}:`, e);
                } finally {
                  try {
                    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                    if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
                  } catch (cleanupErr) {}
                }
              }

              if (fetchedTracks.length > 0) {
                const updatePayload = {
                  musicTracks: fetchedTracks,
                  selectedDemo: fetchedTracks[0].id,
                  taskId: effectiveTaskId,
                };
                if (cleanShopifyId && !targetOrder.shopifyOrderId) {
                  updatePayload.shopifyOrderId = cleanShopifyId;
                }
                if (shopifyOrderData?.name && !targetOrder.shopifyOrderNumber) {
                  updatePayload.shopifyOrderNumber = shopifyOrderData.name;
                }

                await Order.findByIdAndUpdate(targetOrder._id, { $set: updatePayload });

                const presignedTracks = await Promise.all(
                  fetchedTracks.map(async (t) => ({
                    ...t,
                    audioUrl: await generatePresignedUrl(t.audioUrl, 7 * 24 * 3600),
                    streamAudioUrl: await generatePresignedUrl(t.streamAudioUrl, 7 * 24 * 3600),
                  }))
                );

                return NextResponse.json({
                  success: true,
                  status: "COMPLETED",
                  message: "Full song & preview downloaded from Suno AI, uploaded to S3, and database updated successfully!",
                  tracks: presignedTracks,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error("[sync-file] Suno AI fetch error:", err);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 7. IF NOT FOUND / EXPIRED, PROMPT GENERATE OR UPLOAD
    // ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      success: false,
      status: "EXPIRED",
      error: "Music file is not on S3 storage and the original Suno task has expired. Click 'Generate Song with AI' below to compose a new song with the saved lyrics.",
      canUpload: true,
      orderId: targetOrder?._id?.toString() || null,
      taskId: effectiveTaskId || null,
    });
  } catch (error) {
    console.error("[sync-file] Unhandled error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}

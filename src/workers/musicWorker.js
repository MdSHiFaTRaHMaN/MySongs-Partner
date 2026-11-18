import { Worker } from "bullmq";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import dbConnect from "../lib/mongoose.js";
import Order from "../models/Order.js";
import VideoOrder from "../models/VideoOrder.js";
import Notification from "../models/Notification.js";
import { uploadToS3 } from "../lib/s3.js";
import redis from "../lib/redis.js";
import { getSettings } from "../lib/getSettings.js";
import { sendKlaviyoMusicDelivery, sendKlaviyoMusicReady } from "../lib/klaviyo.js";
import { fulfillShopifyOrder } from "../lib/shopifyFulfill.js";
import { generateMurekaSong, pollMurekaSong } from "../lib/mureka.js";

const TEMP_DIR = os.tmpdir();

async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
  const destStream = fs.createWriteStream(destPath);
  await pipeline(response.body, destStream);
}

function createPreview(inputPath, outputPath, durationSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime("00:00:15") // Start preview at 15s
      .setDuration(durationSeconds.toString()) // Dynamic duration
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Polling helper with network and failure resilience
async function pollSuno(taskId, apiKey, apiBase) {
  const maxAttempts = 60; // up to 5 mins (60 * 5s)
  let consecutiveErrors = 0;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${apiBase}/api/v1/generate/record-info?taskId=${taskId}`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20000), // 20s timeout
      });
      const data = await res.json();

      // If Suno returns temporary 500 error, keep polling without crashing
      if (data.code === 500) {
        console.warn(`[Worker] Suno API returned temporary 500 error for task ${taskId}, retrying in 5s...`);
        consecutiveErrors++;
        if (consecutiveErrors > 10) {
          throw new Error("Suno API cluster temporarily unavailable (consecutive 500 errors)");
        }
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // Check if Suno returned non-200 code
      if (data.code && data.code !== 200) {
        throw new Error(data.msg || data.message || `Suno API returned error code ${data.code}`);
      }

      consecutiveErrors = 0;
      const status = data.data?.status;
      const failedStatuses = [
        "FAILED",
        "FAIL",
        "CREATE_TASK_FAILED",
        "GENERATE_AUDIO_FAILED",
        "CALLBACK_EXCEPTION",
        "SENSITIVE_WORD_ERROR",
        "ERROR",
        "REJECTED"
      ];
      
      if (status === "SUCCESS") {
        return data.data;
      } else if (failedStatuses.includes(status)) {
        const errorDetail = data.data?.errorMessage || data.data?.error || status;
        throw new Error(`Suno API failed with status: ${status} (${errorDetail})`);
      }
    } catch (fetchErr) {
      if (fetchErr.message && (fetchErr.message.includes("Suno API failed") || fetchErr.message.includes("error code"))) {
        throw fetchErr;
      }
      console.warn(`[Worker] Polling network glitch for task ${taskId}:`, fetchErr.message);
      consecutiveErrors++;
      if (consecutiveErrors > 8) {
        throw fetchErr;
      }
    }
    
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("Suno API polling timed out");
}

export const worker = new Worker("music-generation", async (job) => {
  const { taskId, orderId, provider, sunoBody, murekaBody, apiKey, apiBase } = job.data;
  const isMureka = provider === "mureka";
  console.log(`[Worker] Processing ${isMureka ? "Mureka AI" : "Suno AI"} job for taskId: ${taskId}, orderId: ${orderId}`);

  await dbConnect();
  const settings = await getSettings();
  const previewDuration = settings?.previewDurationSeconds || 45;

  try {
    let rawTracks = [];

    if (isMureka) {
      // 1. Generate via Mureka AI
      const murekaRes = await generateMurekaSong(apiKey, murekaBody, apiBase);
      const murekaTaskId = murekaRes.taskId;
      console.log(`[Worker] Mureka task started: ${murekaTaskId}`);
      rawTracks = await pollMurekaSong(murekaTaskId, apiKey, apiBase);
    } else {
      // 1. Generate via Suno AI with auto-fallback to Mureka AI if available
      try {
        let sunoRes = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const response = await fetch(`${apiBase}/api/v1/generate`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
              body: JSON.stringify(sunoBody),
              signal: AbortSignal.timeout(30000),
            });
            sunoRes = await response.json();
            if (sunoRes.code === 200) break;
            console.warn(`[Worker] Suno generation start attempt ${attempt} returned code ${sunoRes.code} (${sunoRes.msg}), retrying...`);
          } catch (netErr) {
            console.warn(`[Worker] Suno generation start attempt ${attempt} network error:`, netErr.message);
          }
          if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
        }
        
        if (!sunoRes || sunoRes.code !== 200) {
          throw new Error(sunoRes?.msg || "Failed to start Suno music generation after 3 attempts");
        }
        
        const realTaskId = sunoRes.data?.taskId;
        
        // 2. Poll until success
        const resultData = await pollSuno(realTaskId, apiKey, apiBase);
        const sunoTracks = resultData.response?.sunoData || [];
        rawTracks = sunoTracks.map((t) => ({
          id: t.id,
          title: t.title,
          audioUrl: t.audioUrl,
          imageUrl: t.imageUrl,
          duration: t.duration,
          prompt: t.prompt,
        }));
      } catch (sunoErr) {
        if (settings?.murekaApiKey) {
          console.warn(`[Worker] Suno AI failed for order ${orderId} (${sunoErr.message}). Initiating automatic fallback to Mureka AI...`);
          const murekaBase = settings.murekaApiBase || "https://api.mureka.ai";
          const murekaRes = await generateMurekaSong(settings.murekaApiKey, murekaBody, murekaBase);
          const murekaTaskId = murekaRes.taskId;
          console.log(`[Worker] Mureka fallback task started: ${murekaTaskId}`);
          rawTracks = await pollMurekaSong(murekaTaskId, settings.murekaApiKey, murekaBase);
        } else {
          throw sunoErr;
        }
      }
    }

    if (rawTracks.length === 0) {
      throw new Error(`No tracks returned from ${isMureka ? "Mureka AI" : "Suno AI"}`);
    }

    const processedTracks = [];

    // 3. Process each track
    for (const track of rawTracks) {
      if (!track.audioUrl) continue;
      
      const fullPath = path.join(TEMP_DIR, `${track.id}_full.mp3`);
      const previewPath = path.join(TEMP_DIR, `${track.id}_preview.mp3`);
      
      console.log(`[Worker] Downloading track ${track.id}...`);
      await downloadFile(track.audioUrl, fullPath);
      
      console.log(`[Worker] Creating preview for track ${track.id}...`);
      await createPreview(fullPath, previewPath, previewDuration);
      
      console.log(`[Worker] Uploading to S3 for track ${track.id}...`);
      const s3FullKey = `music/${orderId}/${crypto.randomUUID()}.mp3`;
      const s3PreviewKey = `music/${orderId}/${crypto.randomUUID()}.mp3`;
      
      await uploadToS3(fullPath, s3FullKey, "audio/mpeg");
      await uploadToS3(previewPath, s3PreviewKey, "audio/mpeg");
      
      processedTracks.push({
        id: track.id,
        title: track.title,
        audioUrl: s3FullKey, // Backend full file key
        streamAudioUrl: s3PreviewKey, // Preview stream key
        imageUrl: track.imageUrl,
        duration: track.duration,
        lyrics: track.prompt,
      });

      // Cleanup temp files
      fs.unlinkSync(fullPath);
      fs.unlinkSync(previewPath);
    }

    // 4. Update Database
    const order = await Order.findById(orderId);
    if (order) {
      order.musicTracks = processedTracks;
      if ((!order.lyrics || !order.lyrics.trim()) && processedTracks[0]?.lyrics) {
        order.lyrics = processedTracks[0].lyrics;
      }
      if (!order.recipientName && processedTracks[0]?.title) {
        const match = processedTracks[0].title.match(/\s+for\s+(.+)$/i);
        if (match && match[1]) {
          order.recipientName = match[1].trim();
          if (!order.recipients || order.recipients.length === 0) {
            order.recipients = [{ name: order.recipientName, pronunciationMode: "Original", pronunciation: "" }];
          }
        }
      }
      // Ensure status is marked completed and clear any previous generation errors
      if (order.status !== "paid" && order.status !== "delivering" && order.status !== "fulfilled") {
        order.status = "completed";
      }
      order.generationError = undefined;
      order.lastPolledAt = new Date();
      await order.save();

      // Auto-update connected VideoOrder audioFile if this was an upsell order
      try {
        if (processedTracks.length > 0) {
          await VideoOrder.updateMany(
            { originalMusicOrderId: order._id },
            {
              $set: {
                audioFile: {
                  key: processedTracks[0].audioUrl || processedTracks[0].streamAudioUrl,
                  url: processedTracks[0].audioUrl || processedTracks[0].streamAudioUrl,
                  name: processedTracks[0].title || `${order.recipientName || "Custom"}'s Song`,
                  size: 0,
                },
              },
            }
          );
        }
      } catch (vidErr) {
        console.warn("[Worker] VideoOrder audio sync notice:", vidErr.message);
      }

      // Safe Notification Creation
      try {
        await Notification.create({
          title: "Music Generation Complete",
          message: `The song for ${order.email} is ready!`,
          type: "music_generated",
          link: `/ordered-musics/${order._id}`,
        });
      } catch (notifErr) {
        console.warn("[Worker] Notification creation notice:", notifErr.message);
      }
      console.log(`[Worker] Order ${orderId} successfully completed and saved.`);
      
      // If the order is already marked as paid, trigger Klaviyo Music_Delivered now
      if (order.status === "paid" && !order.deliveryEmailSent) {
        console.log(`[Worker] Order is paid. Triggering Klaviyo and Shopify fulfillment...`);
        try {
          const settings = await getSettings();
          if (settings.klaviyoApiKey) {
            const klaviyoResult = await sendKlaviyoMusicDelivery(settings.klaviyoApiKey, order.email, [order], order.orderNumber);
            if (klaviyoResult.success) {
              order.deliveryEmailSent = true;
              order.status = "delivering";
              await order.save();
              console.log(`[Worker] Successfully sent Music_Delivered event to Klaviyo for ${order.email}. Status updated to 'delivering'. Awaiting Klaviyo Webhook for Shopify fulfillment.`);
            } else {
              console.error(`[Worker] Failed to send Klaviyo email: ${klaviyoResult.error}`);
            }
          } else {
            console.warn(`[Worker] Klaviyo API key not found in settings.`);
          }
        } catch(e) {
          console.error(`[Worker] Error triggering Klaviyo:`, e);
        }
      } else if ((order.status === "created" || order.status === "completed") && !order.resumeEmailSent) {
        // Unpaid order / demo song generated: Send Music_Ready_To_Select event to Klaviyo
        try {
          const settings = await getSettings();
          if (settings.klaviyoApiKey) {
            const baseUrl = order.resumeBaseUrl || settings.shopUrl1 || process.env.NEXT_PUBLIC_APP_URL || "";
            const resumeLink = baseUrl ? `${baseUrl.replace(/\/$/, "")}?resumeOrder=${order._id}` : "";
            if (resumeLink) {
              const klaviyoResult = await sendKlaviyoMusicReady(settings.klaviyoApiKey, order.email, order, resumeLink);
              if (klaviyoResult.success) {
                order.resumeEmailSent = true;
                await order.save();
                console.log(`[Worker] Successfully sent Klaviyo Music_Ready_To_Select event for ${order.email}`);
              }
            }
          }
        } catch (e) {
          console.error(`[Worker] Error triggering Klaviyo Music_Ready_To_Select:`, e);
        }
      }
    }

  } catch (err) {
    console.error(`[Worker] Job failed for order ${orderId}:`, err);
    try {
      await dbConnect();
      const existing = await Order.findById(orderId).select("musicTracks status").lean();
      if (!existing?.musicTracks || existing.musicTracks.length === 0) {
        await Order.findByIdAndUpdate(orderId, {
          status: "failed",
          generationError: err.message || "Music generation failed",
        });
      } else {
        console.log(`[Worker] Order ${orderId} already has ${existing.musicTracks.length} tracks; retaining completed status.`);
        if (existing.status !== "paid" && existing.status !== "delivering" && existing.status !== "fulfilled") {
          await Order.findByIdAndUpdate(orderId, {
            status: "completed",
            $unset: { generationError: 1 }
          });
        }
      }
    } catch (e) {
      console.error(`[Worker] Error updating order status:`, e);
    }
    throw err; // Let BullMQ handle retries
  }
}, { 
  connection: redis,
  concurrency: 5 // Process 5 generations concurrently max
});

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job.id} failed with error:`, err);
});

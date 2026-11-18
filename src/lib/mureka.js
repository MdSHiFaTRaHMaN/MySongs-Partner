/**
 * Mureka AI API Integration Client (platform.mureka.ai)
 * Fully compliant with official Mureka API specifications.
 * Supports:
 * - Model: mureka-9.5 (or custom specified)
 * - Song Generation: POST /v1/song/generate
 * - Song Polling: GET /v1/song/query/{task_id}
 * - Lyrics Generation: POST /v1/lyrics/generate
 * - Lyrics Polling: GET /v1/lyrics/query/{task_id}
 * - Account Billing & Balance: GET /v1/account/billing
 */

export const MUREKA_DEFAULT_BASE_URL = "https://api.mureka.ai";
export const MUREKA_DEFAULT_MODEL = "mureka-9.5";

/**
 * Initiates song generation on Mureka AI
 * @param {string} apiKey - Mureka API Key (from platform.mureka.ai)
 * @param {Object} params - Generation parameters (lyrics, prompt, style, title, model, etc.)
 * @param {string} apiBase - Optional API Base URL
 * @returns {Promise<Object>} Mureka task metadata including taskId
 */
export async function generateMurekaSong(apiKey, params = {}, apiBase = MUREKA_DEFAULT_BASE_URL) {
  if (!apiKey) {
    throw new Error("Mureka API Key is missing. Please configure it in Settings.");
  }

  const base = (apiBase || MUREKA_DEFAULT_BASE_URL).replace(/\/$/, "");

  const promptText = params.prompt || params.style || "Pop, melodic, high quality";
  const lyricsText = params.lyrics || "";
  let modelName = params.model || MUREKA_DEFAULT_MODEL;
  if (!modelName || modelName === "mureka-8.5" || modelName === "default") {
    modelName = "auto";
  }

  const payload = {
    lyrics: lyricsText,
    prompt: promptText,
    model: modelName,
  };

  if (params.callBackUrl) {
    payload.callBackUrl = params.callBackUrl;
  }

  console.log(`[Mureka API] Sending generation request (model: ${modelName}) to ${base}/v1/song/generate`);

  const res = await fetch(`${base}/v1/song/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || (data.code && data.code !== 200 && data.code !== 0)) {
    const errorMsg = data.failed_reason || data.error || data.msg || data.message || `Mureka API Error (${res.status})`;
    console.error("[Mureka API] Generation request failed:", errorMsg, data);
    throw new Error(errorMsg);
  }

  const taskId = data.id || data.data?.taskId || data.data?.id || data.taskId;

  if (!taskId) {
    console.error("[Mureka API] Unexpected response format (no taskId found):", data);
    throw new Error("Mureka API did not return a valid task ID.");
  }

  console.log(`[Mureka API] Song generation initiated successfully (Model: ${modelName}). Task ID: ${taskId}`);

  return {
    taskId: String(taskId),
    status: data.status || data.data?.status || "queued",
    model: modelName,
    raw: data,
  };
}

/**
 * Polls Mureka AI song generation task until completion or timeout
 * @param {string} taskId - Mureka Task ID
 * @param {string} apiKey - Mureka API Key
 * @param {string} apiBase - Mureka API Base URL
 * @param {number} maxAttempts - Maximum polling attempts (default: 360 = ~30 minutes at 5s intervals)
 * @returns {Promise<Array>} Normalized list of generated tracks
 */
export async function pollMurekaSong(taskId, apiKey, apiBase = MUREKA_DEFAULT_BASE_URL, maxAttempts = 360) {
  if (!taskId) {
    throw new Error("Cannot poll Mureka task without a valid taskId.");
  }

  const base = (apiBase || MUREKA_DEFAULT_BASE_URL).replace(/\/$/, "");

  console.log(`[Mureka Polling] Checking status for task ${taskId}...`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // 1. Try official endpoint: GET /v1/song/query/{task_id}
      let res = await fetch(`${base}/v1/song/query/${encodeURIComponent(taskId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
      });

      // Fallback endpoint if /query/{id} is not found
      if (res.status === 404) {
        res = await fetch(`${base}/v1/song/record-info?taskId=${encodeURIComponent(taskId)}`, {
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        });
      }

      if (!res.ok && res.status !== 404) {
        console.warn(`[Mureka Polling] HTTP ${res.status} on attempt ${i + 1}`);
      } else {
        const data = await res.json();
        const taskData = data.data || data;
        const status = String(taskData?.status || "").toLowerCase();

        // Check for success
        if (status === "succeeded" || status === "success" || status === "completed") {
          console.log(`[Mureka Polling] Task ${taskId} completed with status: ${status}`);

          const rawTracks =
            taskData.choices ||
            taskData.response?.choices ||
            taskData.response?.murekaData ||
            taskData.response?.sunoData ||
            taskData.tracks ||
            taskData.songs ||
            [];

          const tracks = [];

          if (Array.isArray(rawTracks) && rawTracks.length > 0) {
            rawTracks.forEach((t, idx) => {
              const audioUrl = t.url || t.audioUrl || t.audio_url || t.mp3 || "";
              if (audioUrl) {
                tracks.push({
                  id: String(t.id || `mureka_${taskId}_${idx + 1}`),
                  title: t.title || "Custom Song",
                  audioUrl: audioUrl,
                  imageUrl: t.image_url || t.imageUrl || t.cover || t.cover_url || "",
                  duration: Number(t.duration) || 180,
                  prompt: t.prompt || t.lyrics || "",
                });
              }
            });
          }

          if (tracks.length === 0 && (taskData.url || taskData.audioUrl || taskData.audio_url)) {
            tracks.push({
              id: `mureka_${taskId}_1`,
              title: taskData.title || "Custom Song",
              audioUrl: taskData.url || taskData.audioUrl || taskData.audio_url,
              imageUrl: taskData.image_url || taskData.imageUrl || "",
              duration: Number(taskData.duration) || 180,
              prompt: taskData.prompt || "",
            });
          }

          if (tracks.length > 0) {
            console.log(`[Mureka Polling] Successfully retrieved ${tracks.length} track(s) for task ${taskId}.`);
            return tracks;
          }
        }

        // Check for failure
        if (["failed", "timeouted", "cancelled", "create_task_failed", "generate_audio_failed", "exception"].includes(status)) {
          const reason = taskData.failed_reason || taskData.error || taskData.msg || taskData.message || `Status: ${status}`;
          console.error(`[Mureka Polling] Task ${taskId} failed:`, reason);
          throw new Error(`Mureka generation failed: ${reason}`);
        }

        if (i % 6 === 0) {
          console.log(`[Mureka Polling] Task ${taskId} status: ${status || "pending"} (Attempt ${i + 1}/${maxAttempts})`);
        }
      }
    } catch (err) {
      if (err.message && err.message.includes("Mureka generation failed")) {
        throw err;
      }
      console.warn(`[Mureka Polling] Attempt ${i + 1} error:`, err.message);
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error(`Mureka generation timed out for task ${taskId} after 30 minutes.`);
}

/**
 * Generates lyrics using Mureka AI
 * @param {string} apiKey - Mureka API Key
 * @param {string} prompt - Topic/theme or description for lyrics
 * @param {string} apiBase - Optional API Base URL
 * @returns {Promise<Object>} Generated lyrics data or taskId
 */
// In-memory cache for synchronous Mureka lyrics results (TTL: 30 minutes)
const murekaLyricsCache = new Map();

export function setMurekaLyricsCache(taskId, data) {
  if (!taskId) return;
  if (murekaLyricsCache.size > 200) {
    const oldestKey = murekaLyricsCache.keys().next().value;
    murekaLyricsCache.delete(oldestKey);
  }
  murekaLyricsCache.set(String(taskId), {
    ...data,
    timestamp: Date.now(),
  });
}

export function getMurekaLyricsCache(taskId) {
  if (!taskId) return null;
  const cleanId = String(taskId).replace(/^mureka_/, "");
  const entry = murekaLyricsCache.get(cleanId) || murekaLyricsCache.get(String(taskId));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 30 * 60 * 1000) {
    murekaLyricsCache.delete(cleanId);
    murekaLyricsCache.delete(String(taskId));
    return null;
  }
  return entry;
}

/**
 * Generates lyrics using Mureka AI
 * @param {string} apiKey - Mureka API Key
 * @param {string} prompt - Topic/theme or description for lyrics
 * @param {string} apiBase - Optional API Base URL
 * @returns {Promise<Object>} Generated lyrics data or taskId
 */
export async function generateMurekaLyrics(apiKey, prompt, apiBase = MUREKA_DEFAULT_BASE_URL) {
  if (!apiKey) {
    throw new Error("Mureka API Key is missing. Please configure it in Settings.");
  }

  const base = (apiBase || MUREKA_DEFAULT_BASE_URL).replace(/\/$/, "");

  // Mureka POST /v1/lyrics/generate officially accepts { prompt: string }
  const payload = {
    prompt: prompt,
  };

  console.log(`[Mureka Lyrics] Requesting lyrics generation from ${base}/v1/lyrics/generate...`);

  const res = await fetch(`${base}/v1/lyrics/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || (data.code && data.code !== 200 && data.code !== 0)) {
    const errorMsg =
      (typeof data.error === "object" ? data.error?.message : data.error) ||
      data.failed_reason ||
      data.msg ||
      data.message ||
      `Mureka Lyrics Error (${res.status})`;
    const isRateLimit = String(errorMsg).toLowerCase().includes("rate limit") || String(errorMsg).toLowerCase().includes("concurrent");
    if (isRateLimit) {
      console.warn("[Mureka Lyrics] Concurrency rate limit reached, falling back to backup provider:", errorMsg);
    } else {
      console.error("[Mureka Lyrics] Request failed:", errorMsg, data);
    }
    throw new Error(errorMsg);
  }

  const taskData = data.data || data;
  const directLyrics =
    taskData.lyrics ||
    taskData.text ||
    taskData.choices?.[0]?.lyrics ||
    taskData.choices?.[0]?.text;
  const directTitle = taskData.title || taskData.choices?.[0]?.title || "Custom Lyrics";

  if (directLyrics) {
    const taskId = String(taskData.id || taskData.taskId || `direct_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const result = {
      taskId: taskId,
      status: "succeeded",
      lyrics: directLyrics,
      title: directTitle,
    };
    setMurekaLyricsCache(taskId, result);
    return result;
  }

  throw new Error("Mureka returned no lyrics in response.");
}

/**
 * Checks Mureka AI lyrics task completion (from memory cache or fast lookup).
 * Note: Mureka lyrics are generated synchronously via /v1/lyrics/generate.
 * There is no asynchronous query endpoint for lyrics on Mureka.
 * @param {string} taskId - Mureka Task ID
 * @param {string} apiKey - Mureka API Key
 * @param {string} apiBase - Mureka API Base URL
 * @returns {Promise<Object>} { lyrics, title, status }
 */
export async function pollMurekaLyrics(taskId, apiKey, apiBase = MUREKA_DEFAULT_BASE_URL) {
  const cached = getMurekaLyricsCache(taskId);
  if (cached && cached.lyrics) {
    return {
      status: "SUCCESS",
      lyrics: cached.lyrics,
      title: cached.title || "Custom Lyrics",
    };
  }

  // If not found in cache, return immediately rather than hanging server for 3 minutes
  return {
    status: "FAILED",
    error: "Mureka lyrics task not found or expired.",
    lyrics: null,
    title: null,
  };
}

/**
 * Fetches Mureka AI Account Billing and Balance (in USD cents)
 * @param {string} apiKey - Mureka API Key
 * @param {string} apiBase - Optional Mureka Base URL
 * @returns {Promise<Object>} { balanceCents, balanceUsd, totalRecharge, totalSpending, concurrentLimit }
 */
export async function getMurekaBilling(apiKey, apiBase = MUREKA_DEFAULT_BASE_URL) {
  if (!apiKey) {
    throw new Error("Mureka API Key is missing.");
  }

  const base = (apiBase || MUREKA_DEFAULT_BASE_URL).replace(/\/$/, "");

  const res = await fetch(`${base}/v1/account/billing`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    next: { revalidate: 30 }, // Next.js ISR cache
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.msg || data.message || `Mureka Billing Error (${res.status})`);
  }

  const billingData = data.data || data;
  const balanceCents = typeof billingData.balance === "number" ? billingData.balance : 0;
  const totalRecharge = typeof billingData.total_recharge === "number" ? billingData.total_recharge : 0;
  const totalSpending = typeof billingData.total_spending === "number" ? billingData.total_spending : 0;

  return {
    accountId: billingData.account_id || null,
    balanceCents,
    balanceUsd: (balanceCents / 100).toFixed(2),
    totalRechargeUsd: (totalRecharge / 100).toFixed(2),
    totalSpendingUsd: (totalSpending / 100).toFixed(2),
    concurrentLimit: billingData.concurrent_request_limit || 5,
  };
}

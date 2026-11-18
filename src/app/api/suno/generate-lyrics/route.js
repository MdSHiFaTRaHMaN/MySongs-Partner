import { NextResponse } from "next/server";
import { getSettings } from "@/lib/getSettings";
import { withCORS, handleOptions } from "@/lib/cors";
import { encryptTaskId } from "@/lib/encryption";
import { generateMurekaLyrics } from "@/lib/mureka";

// Preflight — the browser sends this automatically before the real POST.
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  try {
    // ── Security: Origin / Referer check ──
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

    const isAllowed = allowedOrigins.some(
      (allowed) => originHeader.startsWith(allowed) || refererHeader.startsWith(allowed)
    );

    if (!isAllowed) {
      return withCORS(
        NextResponse.json(
          { error: "Unauthorized: Request origin not allowed" },
          { status: 403 }
        ),
        origin
      );
    }

    const { prompt, language } = await request.json();

    if (!prompt) {
      return withCORS(NextResponse.json({ error: "Prompt is required" }, { status: 400 }), origin);
    }

    // ── LANGUAGE DIRECTIVE (Explicit customer selection has absolute priority) ──
    const targetLang = (language && typeof language === "string" && language.trim())
      ? language.trim()
      : (prompt.toLowerCase().includes("in dutch") ? "Dutch" : "English");
    const lang = targetLang;

    // Clean any prior inline directives to avoid conflicting language tags
    const cleanedBasePrompt = prompt
      .replace(/\[Language:\s*[^\]]+\]\s*/gi, "")
      .replace(/Important:\s*[^.]+\.?/gi, "")
      .replace(/Preserve all exact[^.]+\.?/gi, "")
      .replace(/\.?\s*(?:Write|Create)\s+(?:all\s+)?(?:the\s+)?lyrics\s+in\s+[a-zA-Z]+\.?/gi, "")
      .replace(/\s*In\s+[a-zA-Z]+\.?$/gi, "")
      .trim();

    // ── MUREKA PROMPT (Supports rich context up to 2000 chars) ──
    const murekaPrompt = `[Language: ${lang}] ${cleanedBasePrompt}. Write all lyrics in ${lang}. Important: Preserve all exact customer details, names, colors, and memories in ${lang} without altering them.`;

    // ── SUNO PROMPT (Strictly capped to match Suno limit of 200 chars) ──
    let rawSuno = cleanedBasePrompt.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
    const langDirective = ` In ${lang}.`;

    // Budget: maximum 198 characters total (guarantees safe compliance with Suno's 200 limit)
    const maxCleanLen = Math.max(10, 198 - langDirective.length);
    if (rawSuno.length > maxCleanLen) {
      rawSuno = rawSuno.substring(0, maxCleanLen).trim();
    }
    let sunoPrompt = `${rawSuno}${langDirective}`.trim();

    // Hard ceiling: Suno API returns 400 if length >= 200. We cap strictly at 198.
    if (sunoPrompt.length > 198) {
      sunoPrompt = sunoPrompt.substring(0, 198);
    }

    const activeProvider = settings.activeAiProvider === "mureka" ? "mureka" : "suno";
    const murekaApiKey = settings.murekaApiKey || process.env.MUREKA_API_KEY;
    const sunoApiKey = settings.sunoApiKey || process.env.SUNO_API_KEY;

    // Prefer Mureka if explicitly set, OR if customer prompt exceeds 200 characters
    const shouldTryMurekaFirst = murekaApiKey && (activeProvider === "mureka" || prompt.trim().length > 200 || !sunoApiKey);

    // ── MUREKA AI LYRICS GENERATION HELPER ──
    const tryMurekaGeneration = async () => {
      if (!murekaApiKey) return null;
      try {
        const murekaRes = await generateMurekaLyrics(murekaApiKey, murekaPrompt, settings.murekaApiBase);
        if (murekaRes && murekaRes.lyrics) {
          return withCORS(
            NextResponse.json({
              taskId: encryptTaskId(`mureka_${murekaRes.taskId}`),
              status: "SUCCESS",
              lyrics: murekaRes.lyrics,
              title: murekaRes.title || "Custom Lyrics",
              allVariations: [{ text: murekaRes.lyrics, title: murekaRes.title }],
            }),
            origin
          );
        }
        console.warn("[generate-lyrics] Mureka returned no lyrics, falling back to Suno...");
        return null;
      } catch (mErr) {
        console.warn("[generate-lyrics] Mureka generation attempt error:", mErr.message);
        return null;
      }
    };

    if (shouldTryMurekaFirst) {
      const murekaResult = await tryMurekaGeneration();
      if (murekaResult) return murekaResult;
      console.warn("[generate-lyrics] Mureka failed or returned empty, falling back to Suno...");
    }

    // ── SUNO AI LYRICS GENERATION ──
    const apiKey = sunoApiKey;
    if (!apiKey) {
      // If Suno not configured, try Mureka as last resort
      if (murekaApiKey) {
        const murekaFallback = await tryMurekaGeneration();
        if (murekaFallback) return murekaFallback;
      }
      return withCORS(
        NextResponse.json({ error: "AI lyrics provider not configured. Please check Settings." }, { status: 500 }),
        origin
      );
    }

    const callBackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/suno/callback`;

    let data = null;
    const lyricsEndpoint = `${settings.sunoApiBase || "https://api.sunoapi.org"}/api/v1/lyrics`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(lyricsEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            prompt: sunoPrompt,
            callBackUrl,
          }),
          signal: AbortSignal.timeout(15000),
        });
        data = await response.json();
        console.log(`[generate-lyrics] Attempt ${attempt} Response:`, JSON.stringify(data));
        if (data.code === 200) break;
        if (data.code === 500 && attempt < 3) {
          console.warn(`[generate-lyrics] Suno returned 500 on attempt ${attempt}, retrying in 2s...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          break;
        }
      } catch (err) {
        console.warn(`[generate-lyrics] Attempt ${attempt} network error:`, err.message);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!data || data.code !== 200) {
      if (!shouldTryMurekaFirst && murekaApiKey) {
        console.warn("[generate-lyrics] Suno generation failed, attempting Mureka backup...");
        const murekaBackup = await tryMurekaGeneration();
        if (murekaBackup) return murekaBackup;
      }
      return withCORS(
        NextResponse.json(
          { error: data?.msg || "Failed to generate lyrics. Please try again." },
          { status: 400 }
        ),
        origin
      );
    }

    return withCORS(NextResponse.json({ taskId: encryptTaskId(data.data?.taskId) }), origin);
  } catch (error) {
    console.error("[generate-lyrics] Error:", error);
    return withCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }), origin);
  }
}
import React from "react";
import { getSettings } from "@/lib/getSettings";
import { RiCoinsFill } from "react-icons/ri";
import { FiDollarSign } from "react-icons/fi";
import { getMurekaBilling } from "@/lib/mureka";
import redis from "@/lib/redis";

export const dynamic = "force-dynamic";

export default async function SunoCreditCard() {
  const settings = await getSettings();
  const activeProvider = settings.activeAiProvider === "mureka" ? "mureka" : "suno";

  let sunoCredits = null;
  let sunoError = null;

  let murekaBilling = null;
  let murekaError = null;

  const murekaKey = (settings.murekaApiKey || process.env.MUREKA_API_KEY || "").trim();
  const sunoKey = (settings.sunoApiKey || process.env.SUNO_API_KEY || "").trim();

  // 1. Fetch Suno Credits (with Redis cache)
  if (sunoKey) {
    try {
      const cachedSuno = await redis.get("cache:credits:suno");
      if (cachedSuno !== null) {
        sunoCredits = Number(cachedSuno);
      }
    } catch (e) {}

    if (sunoCredits === null) {
      try {
        const baseUrl = settings.sunoApiBase || "https://api.sunoapi.org";
        const res = await fetch(`${baseUrl}/api/v1/generate/credit`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${sunoKey}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        });

        const json = await res.json();
        if (res.ok && json.code === 200) {
          sunoCredits = json.data;
          try {
            await redis.set("cache:credits:suno", String(sunoCredits), "EX", 180);
          } catch (e) {}
        } else {
          sunoError = json.msg || "Failed to fetch credits";
        }
      } catch (err) {
        sunoError = "Network error";
      }
    }
  }

  // 2. Fetch Mureka Billing/Balance (with Redis cache)
  if (murekaKey) {
    try {
      const cachedMureka = await redis.get("cache:credits:mureka");
      if (cachedMureka) {
        murekaBilling = JSON.parse(cachedMureka);
      }
    } catch (e) {}

    if (!murekaBilling) {
      try {
        murekaBilling = await getMurekaBilling(murekaKey, settings.murekaApiBase);
        if (murekaBilling) {
          try {
            await redis.set("cache:credits:mureka", JSON.stringify(murekaBilling), "EX", 180);
          } catch (e) {}
        }
      } catch (err) {
        murekaError = err.message || "Failed to fetch Mureka balance";
      }
    }
  }

  const isMurekaActive = activeProvider === "mureka";

  // Clean value determination without nested JSX ternaries
  let displayValue = "---";
  if (isMurekaActive) {
    if (murekaBilling) {
      displayValue = `$${murekaBilling.balanceUsd} USD`;
    } else if (murekaError) {
      displayValue = "Error";
    } else if (murekaKey) {
      displayValue = "Loading...";
    } else {
      displayValue = "Not Configured";
    }
  } else {
    if (sunoCredits !== null) {
      displayValue = `${sunoCredits.toLocaleString()} Credits`;
    } else if (sunoError) {
      displayValue = "Error";
    } else if (sunoKey) {
      displayValue = "Loading...";
    } else {
      displayValue = "Not Configured";
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 flex flex-col justify-between h-full relative overflow-hidden group hover:border-brand-300 dark:hover:border-brand-500/30 transition">
      {/* Top Header & Icon */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl transition ${
          isMurekaActive
            ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
            : "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
        }`}>
          {isMurekaActive ? <FiDollarSign size={22} /> : <RiCoinsFill size={22} />}
        </div>

        {/* Active Provider Pill */}
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            isMurekaActive
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300"
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
            {isMurekaActive ? "Mureka Active" : "Suno Active"}
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
            Music: {isMurekaActive ? `Mureka (${settings.murekaModel || "auto"})` : `Suno AI (${settings.sunoModel || "V3_5"})`}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Lyrics: Suno (4200) / Mureka (v200)
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="mt-4">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">
          {isMurekaActive ? "MUREKA API BALANCE" : "SUNO API CREDITS"}
        </span>
        <h4 className="mt-1 text-2xl font-bold text-gray-800 dark:text-white/90">
          {displayValue}
        </h4>
      </div>

      {/* Footer Info */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/60 flex items-center justify-between text-xs text-gray-400">
        <span className="truncate max-w-[150px]">
          {isMurekaActive ? "api.mureka.ai" : (settings.sunoApiBase || "api.sunoapi.org").replace(/^https?:\/\//, "")}
        </span>
        {isMurekaActive ? (
          <span>
            {sunoCredits !== null ? `Suno: ${sunoCredits.toLocaleString()} cr` : "Suno: Ready"}
          </span>
        ) : (
          <span>
            {murekaBilling ? `Mureka: $${murekaBilling.balanceUsd}` : "Mureka: Ready"}
          </span>
        )}
      </div>
    </div>
  );
}

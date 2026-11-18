"use client";
// import Chart from "react-apexcharts";

import dynamic from "next/dynamic";
import { PencilIcon } from "@/icons";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast/Toast";

// Dynamically import the ReactApexChart component
const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

export default function MonthlyTarget({
  revenueThisMonth = 0,
  revenueLastMonth = 0,
  revenueToday = 0,
  totalRevenue = 0,
  monthlyTarget = 10000,
}) {
  const router = useRouter();
  let showToast = null;
  try {
    showToast = useToast();
  } catch (e) { }

  // Local state for target so the UI updates IMMEDIATELY (optimistic update)
  const [target, setTarget] = useState(monthlyTarget || 10000);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(monthlyTarget || 10000);
  const [isSaving, setIsSaving] = useState(false);

  // Sync if prop changes from parent
  useEffect(() => {
    if (monthlyTarget) {
      setTarget(monthlyTarget);
      if (!isEditing) {
        setInputValue(monthlyTarget);
      }
    }
  }, [monthlyTarget, isEditing]);

  const handleSave = async () => {
    const cleaned = Number(String(inputValue).replace(/[^0-9.]/g, ""));
    if (isNaN(cleaned) || cleaned <= 0) {
      showToast?.({
        variant: "error",
        title: "Invalid Target",
        message: "Please enter a valid monthly target amount greater than 0.",
      });
      return;
    }

    const prevTarget = target;
    // 1. IMMEDIATELY update UI state (Optimistic Update)
    setTarget(cleaned);
    setIsEditing(false);
    setIsSaving(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyTarget: cleaned }),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.settings || data.message)) {
        showToast?.({
          variant: "success",
          title: "Target Updated",
          message: `Monthly target successfully updated to €${cleaned.toLocaleString()}.`,
        });
        router.refresh();
      } else {
        throw new Error(data.error || data.message || "Failed to update monthly target");
      }
    } catch (error) {
      console.error("Error saving target:", error);
      // Rollback on error
      setTarget(prevTarget);
      setInputValue(prevTarget);
      setIsEditing(true);
      showToast?.({
        variant: "error",
        title: "Save Failed",
        message: error.message || "Could not save monthly target.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Use current month revenue or last month revenue as active baseline for progress indicator
  const activeRevenue = revenueThisMonth > 0 ? revenueThisMonth : (revenueLastMonth > 0 ? revenueLastMonth : totalRevenue);
  const progressPercentage = target > 0 ? Math.min((activeRevenue / target) * 100, 100).toFixed(1) : 0;
  const series = [parseFloat(progressPercentage)];

  const growthPercentage = revenueLastMonth > 0 ? (((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100).toFixed(1) : 0;
  const isHigher = revenueThisMonth >= revenueLastMonth;

  const formatCurrency = (val) => {
    if (val >= 1000) {
      return `€${(val / 1000).toFixed(1)}K`.replace('.0K', 'K');
    }
    return `€${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const options = {
    colors: ["#ff8a3e"],
    chart: {
      fontFamily: "Outfit, sans-serif",
      type: "radialBar",
      height: 330,
      sparkline: {
        enabled: true,
      },
    },
    plotOptions: {
      radialBar: {
        startAngle: -85,
        endAngle: 85,
        hollow: {
          size: "80%",
        },
        track: {
          background: "#E4E7EC",
          strokeWidth: "100%",
          margin: 5,
        },
        dataLabels: {
          name: {
            show: false,
          },
          value: {
            fontSize: "36px",
            fontWeight: "600",
            offsetY: -40,
            color: "#1D2939",
            formatter: function (val) {
              return val + "%";
            },
          },
        },
      },
    },
    fill: {
      type: "solid",
      colors: ["#ff8a3e"],
    },
    stroke: {
      lineCap: "round",
    },
    labels: ["Progress"],
  };

  const UpArrowSVG = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M7.60141 2.33683C7.73885 2.18084 7.9401 2.08243 8.16435 2.08243C8.16475 2.08243 8.16516 2.08243 8.16556 2.08243C8.35773 2.08219 8.54998 2.15535 8.69664 2.30191L12.6968 6.29924C12.9898 6.59203 12.9899 7.0669 12.6971 7.3599C12.4044 7.6529 11.9295 7.65306 11.6365 7.36027L8.91435 4.64004L8.91435 13.5C8.91435 13.9142 8.57856 14.25 8.16435 14.25C7.75013 14.25 7.41435 13.9142 7.41435 13.5L7.41435 4.64442L4.69679 7.36025C4.4038 7.65305 3.92893 7.6529 3.63613 7.35992C3.34333 7.06693 3.34348 6.59206 3.63646 6.29926L7.60141 2.33683Z" fill="#039855" />
    </svg>
  );

  const DownArrowSVG = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M7.26816 13.6632C7.4056 13.8192 7.60686 13.9176 7.8311 13.9176C7.83148 13.9176 7.83187 13.9176 7.83226 13.9176C8.02445 13.9178 8.21671 13.8447 8.36339 13.6981L12.3635 9.70076C12.6565 9.40797 12.6567 8.9331 12.3639 8.6401C12.0711 8.34711 11.5962 8.34694 11.3032 8.63973L8.5811 11.36L8.5811 2.5C8.5811 2.08579 8.24531 1.75 7.8311 1.75C7.41688 1.75 7.0811 2.08579 7.0811 2.5L7.0811 11.3556L4.36354 8.63975C4.07055 8.34695 3.59568 8.3471 3.30288 8.64009C3.01008 8.93307 3.01023 9.40794 3.30321 9.70075L7.26816 13.6632Z" fill="#D92D20" />
    </svg>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Monthly Target
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
              Target you've set for each month
            </p>
          </div>
          <div className="relative">
            {isEditing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSave();
                }}
                className="flex items-center gap-1.5"
              >
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                    €
                  </span>
                  <input
                    type="text"
                    autoFocus
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setIsEditing(false);
                        setInputValue(target);
                      }
                    }}
                    placeholder="10000"
                    className="w-28 rounded-md border border-gray-300 pl-6 pr-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50 transition"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setInputValue(target);
                  }}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  title="Cancel"
                >
                  ✕
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setInputValue(target);
                  setIsEditing(true);
                }}
                className="p-1 mt-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition"
                title="Edit Monthly Target"
              >
                <PencilIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <div className="relative mt-2">
          <div className="max-h-[330px]">
            <ReactApexChart
              options={options}
              series={series}
              type="radialBar"
              height={330}
            />
          </div>

          {revenueThisMonth > 0 && (
            <span className={`absolute left-1/2 top-full -translate-x-1/2 -translate-y-[95%] rounded-full px-3 py-1 text-xs font-medium ${isHigher ? 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500' : 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500'}`}>
              {isHigher ? '+' : ''}{growthPercentage}%
            </span>
          )}
        </div>
        <p className="mx-auto mt-10 w-full max-w-[380px] text-center text-sm text-gray-500 sm:text-base">
          {revenueThisMonth > 0 ? (
            `You earned €${revenueThisMonth.toLocaleString()} this month (€${revenueToday.toLocaleString()} today). Keep up the good work!`
          ) : (
            `Total revenue earned so far is €${(totalRevenue || revenueLastMonth).toLocaleString()}. Let's push to reach your monthly target!`
          )}
        </p>
      </div>

      <div className="flex items-center justify-center gap-5 px-6 py-3.5 sm:gap-8 sm:py-5">
        <div>
          <p className="mb-1 text-center text-gray-500 text-theme-xs dark:text-gray-400 sm:text-sm">
            Target
          </p>
          <p className="flex items-center justify-center gap-1 text-base font-semibold text-gray-800 dark:text-white/90 sm:text-lg">
            {formatCurrency(target)}
            <UpArrowSVG />
          </p>
        </div>

        <div className="w-px bg-gray-200 h-7 dark:bg-gray-800"></div>

        <div>
          <p className="mb-1 text-center text-gray-500 text-theme-xs dark:text-gray-400 sm:text-sm">
            Revenue
          </p>
          <p className="flex items-center justify-center gap-1 text-base font-semibold text-gray-800 dark:text-white/90 sm:text-lg">
            {formatCurrency(activeRevenue)}
            {isHigher ? <UpArrowSVG /> : <DownArrowSVG />}
          </p>
        </div>

        <div className="w-px bg-gray-200 h-7 dark:bg-gray-800"></div>

        <div>
          <p className="mb-1 text-center text-gray-500 text-theme-xs dark:text-gray-400 sm:text-sm">
            Today
          </p>
          <p className="flex items-center justify-center gap-1 text-base font-semibold text-gray-800 dark:text-white/90 sm:text-lg">
            {formatCurrency(revenueToday)}
            <UpArrowSVG />
          </p>
        </div>
      </div>
    </div>
  );
}

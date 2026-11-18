import React from "react";

export default function LoadingSpinner({ minHeight = "min-h-[60vh]" }) {
  return (
    <div className={`flex flex-col items-center justify-center ${minHeight} w-full gap-3 py-12`}>
      <div className="h-10 w-10 rounded-full border-3 border-orange-500/20 border-t-orange-500 animate-spin" />
    </div>
  );
}

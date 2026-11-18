"use client";

import React from "react";
import useGoBack from "@/hooks/useGoBack";

export default function BackButton({
  children = "← Back",
  className = "",
  fallbackUrl = "/",
  ...props
}) {
  const goBack = useGoBack(fallbackUrl);

  return (
    <button
      type="button"
      onClick={() => goBack()}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

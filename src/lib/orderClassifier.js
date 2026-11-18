/**
 * Helper utilities to classify Shopify Orders into:
 * - "video": contains line item property `_Video_ID` (or videoId / _video_id)
 * - "music": contains line item property `_Music_ID` (or musicId / _music_id)
 * - "other": does NOT contain `_Video_ID` or `_Music_ID`
 */

/**
 * Checks if a line item belongs to a Video order by searching for `_Video_ID` property
 */
export function isVideoLineItem(item) {
  if (!item) return false;
  const props = item.properties || [];
  return props.some((p) => {
    const norm = (p.name || "").toLowerCase().replace(/[\s_-]/g, "");
    return (
      norm === "videoid" ||
      (norm === "ordertype" && String(p.value).toLowerCase() === "video")
    );
  });
}

/**
 * Checks if a line item belongs to a Music order by searching for `_Music_ID` property
 */
export function isMusicLineItem(item) {
  if (!item) return false;
  const props = item.properties || [];
  return props.some((p) => {
    const norm = (p.name || "").toLowerCase().replace(/[\s_-]/g, "");
    return (
      norm === "musicid" ||
      norm === "taskid" ||
      (norm === "ordertype" && String(p.value).toLowerCase() === "music")
    );
  });
}

/**
 * Classifies an entire order into "video", "music", or "other"
 */
export function classifyOrder(order, { mongoMusicIds = new Set(), mongoVideoIds = new Set() } = {}) {
  if (!order) return "other";

  const orderIdStr = String(order.id || "").replace(/^#/, "").trim();
  const orderNumStr = String(order.order_number || "").replace(/^#/, "").trim();
  const orderNameStr = String(order.name || "").replace(/^#/, "").trim();

  // 1. Check Video Order: Has line item with `_Video_ID` or exists in VideoOrder DB
  const matchesVideoDb =
    (orderIdStr && (mongoVideoIds.has(orderIdStr) || mongoVideoIds.has(`#${orderIdStr}`))) ||
    (orderNumStr && (mongoVideoIds.has(orderNumStr) || mongoVideoIds.has(`#${orderNumStr}`))) ||
    (orderNameStr && (mongoVideoIds.has(orderNameStr) || mongoVideoIds.has(`#${orderNameStr}`)));

  const hasVideoProp = (order.line_items || []).some(isVideoLineItem);

  if (matchesVideoDb || hasVideoProp) {
    return "video";
  }

  // 2. Check Music Order: Has line item with `_Music_ID` or exists in Order DB
  const matchesMusicDb =
    (orderIdStr && (mongoMusicIds.has(orderIdStr) || mongoMusicIds.has(`#${orderIdStr}`))) ||
    (orderNumStr && (mongoMusicIds.has(orderNumStr) || mongoMusicIds.has(`#${orderNumStr}`))) ||
    (orderNameStr && (mongoMusicIds.has(orderNameStr) || mongoMusicIds.has(`#${orderNameStr}`)));

  const hasMusicProp = (order.line_items || []).some(isMusicLineItem);

  if (matchesMusicDb || hasMusicProp) {
    return "music";
  }

  // 3. Otherwise, it is an "Other" Order (Merchandise, regular products, etc.)
  return "other";
}

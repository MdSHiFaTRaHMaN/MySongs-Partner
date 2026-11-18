import { generatePresignedUrl } from "./s3.js";

/**
 * Sends a custom event to Klaviyo to trigger the Music Delivery flow.
 * 
 * @param {string} klaviyoApiKey - The private API key for Klaviyo
 * @param {string} email - The customer's email address
 * @param {Array|object} orders - An array of completed order objects (or a single object for backwards compatibility)
 * @param {string|number} orderNumber - The human readable order number (e.g. 1013)
 * @returns {object} - { success: boolean, error?: string }
 */
export async function sendKlaviyoMusicDelivery(klaviyoApiKey, email, orders, orderNumber = "") {
  if (!klaviyoApiKey || !email) {
    console.error("[Klaviyo] Missing API key or email.");
    return { success: false, error: "Missing API key or email in request." };
  }

  // Normalize to array
  const orderList = Array.isArray(orders) ? orders : [orders];
  if (orderList.length === 0) {
    return { success: false, error: "No orders provided." };
  }

  // Filter for valid orders with tracks
  const validOrders = orderList.filter(o => o.musicTracks && o.musicTracks.length > 0 && o.musicTracks[0].audioUrl);
  if (validOrders.length === 0) {
    console.error("[Klaviyo] No complete music tracks to send.");
    return { success: false, error: "No completed music tracks found for these orders." };
  }

  // The first valid order acts as the base for order-level properties
  const baseOrder = validOrders[0];

  const items = await Promise.all(validOrders.map(async order => {
    let selectedTrack = order.musicTracks[0];
    if (order.selectedDemo) {
      const matchedTrack = order.musicTracks.find(t => t.id === order.selectedDemo);
      if (matchedTrack) selectedTrack = matchedTrack;
    }

    let rawLyrics = selectedTrack.lyrics || order.lyrics || "";
    let rawAudioUrl = selectedTrack.audioUrl || order.musicTracks[0]?.audioUrl || "";

    // Direct S3 presigned URL for streaming/online preview (valid 7 days)
    let streamAudioUrl = rawAudioUrl;
    if (rawAudioUrl && !rawAudioUrl.startsWith("http://") && !rawAudioUrl.startsWith("https://")) {
      try {
        streamAudioUrl = await generatePresignedUrl(rawAudioUrl, 7 * 24 * 3600); // 7 days expiration
      } catch (err) {
        console.error("[Klaviyo] Failed to generate presigned S3 URL:", err);
      }
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const trackTitle = selectedTrack.title || order.musicTracks[0]?.title || "Custom Song";
    const safeFilename = `${trackTitle}.mp3`;

    // Download URL: pass raw S3 key (rawAudioUrl) to /api/download.
    let directDownloadUrl = streamAudioUrl;
    let streamPlayUrl = streamAudioUrl;
    if (rawAudioUrl) {
      directDownloadUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawAudioUrl)}&filename=${encodeURIComponent(safeFilename)}`;
      streamPlayUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawAudioUrl)}&filename=${encodeURIComponent(safeFilename)}&stream=true`;
    }

    // Check for Secondary Song (e.g. 2 songs selected in Revision)
    const latestRevision = Array.isArray(order.revisions) && order.revisions.length > 0
      ? [...order.revisions].sort((a, b) => (b.version || 0) - (a.version || 0))[0]
      : null;

    let secondaryAudioUrl = "";
    let secondaryStreamUrl = "";
    let secondaryTitle = "";

    if (latestRevision && latestRevision.secondaryAudioUrl) {
      const rawSecKey = latestRevision.secondaryAudioUrl;
      const secName = `${trackTitle} (Option 2).mp3`;
      secondaryAudioUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawSecKey)}&filename=${encodeURIComponent(secName)}`;
      secondaryStreamUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawSecKey)}&filename=${encodeURIComponent(secName)}&stream=true`;
      secondaryTitle = `${trackTitle} (Option 2)`;
    } else if (order.musicTracks && order.musicTracks.length > 1) {
      const secTrack = order.musicTracks.find(t => t.id !== selectedTrack.id) || order.musicTracks[1];
      if (secTrack && secTrack.audioUrl) {
        const rawSecKey = secTrack.audioUrl;
        secondaryTitle = secTrack.title || `${trackTitle} (Option 2)`;
        secondaryAudioUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawSecKey)}&filename=${encodeURIComponent(`${secondaryTitle}.mp3`)}`;
        secondaryStreamUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawSecKey)}&filename=${encodeURIComponent(`${secondaryTitle}.mp3`)}&stream=true`;
      }
    }

    return {
      musicId: order.musicId || "",
      occasion: order.occasion || "",
      forWho: order.forWho || "",
      genre: order.genre || "",
      language: order.language || "English",
      orderNotes: order.orderNotes || "",
      primaryAudioUrl: directDownloadUrl, // Direct MP3 download link for email template
      directDownloadUrl: directDownloadUrl,
      streamAudioUrl: streamPlayUrl,
      secondaryAudioUrl: secondaryAudioUrl,
      secondaryStreamAudioUrl: secondaryStreamUrl,
      secondaryTitle: secondaryTitle,
      hasMultipleSongs: Boolean(secondaryAudioUrl),
      songCount: secondaryAudioUrl ? 2 : 1,
      title: trackTitle,
      imageUrl: selectedTrack.imageUrl || order.musicTracks[0]?.imageUrl || "",
      lyrics: rawLyrics,
    };
  }));

  console.log(`[Klaviyo] Preparing to send email to ${email}. Number of items: ${items.length}`);

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              first_name: baseOrder?.name?.split(" ")[0] || "",
              last_name: baseOrder?.name?.split(" ")[1] || "",
              email: email,
              properties: {
                Language: baseOrder?.language || "English",
              }
            }
          }
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: "Music_Delivered",
            }
          }
        },
        properties: {
          shopifyOrderId: orderNumber ? `#${orderNumber}` : (baseOrder.shopifyOrderId || ""),
          language: baseOrder?.language || "English",
          primaryAudioUrl: items[0]?.primaryAudioUrl || "",
          secondaryAudioUrl: items[0]?.secondaryAudioUrl || "",
          hasMultipleSongs: Boolean(items[0]?.secondaryAudioUrl),
          songCount: items[0]?.secondaryAudioUrl ? 2 : 1,
          items: items,
        },
        time: new Date().toISOString(),
      },
    },
  };

  try {
    const response = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        "Authorization": `Klaviyo-API-Key ${klaviyoApiKey}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "revision": "2024-02-15", // Required by Klaviyo v3 API
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Klaviyo] Failed to send event:", response.status, errorText);
      return { success: false, error: errorText || `HTTP Error ${response.status}` };
    }

    console.log(`[Klaviyo] Successfully sent Music_Delivered event to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("[Klaviyo] Network error sending event:", error);
    return { success: false, error: error.message || "Network error" };
  }
}

/**
 * Sends a custom event to Klaviyo when music is ready (Abandoned Cart Flow).
 * 
 * @param {string} klaviyoApiKey - The private API key for Klaviyo
 * @param {string} email - The customer's email address
 * @param {object} order - The order object
 * @param {string} resumeLink - The magic link to resume the cart
 * @returns {object} - { success: boolean, error?: string }
 */
export async function sendKlaviyoMusicReady(klaviyoApiKey, email, order, resumeLink) {
  if (!klaviyoApiKey || !email || !resumeLink) {
    console.error("[Klaviyo] Missing API key, email, or resumeLink.");
    return { success: false, error: "Missing required fields." };
  }

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: email,
              properties: {
                Language: order.language || "English",
              }
            }
          }
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: "Music_Ready_To_Select",
            }
          }
        },
        properties: {
          resumeLink: resumeLink,
          occasion: order.occasion || "",
          genre: order.genre || "",
          language: order.language || "English",
        },
        time: new Date().toISOString(),
      },
    },
  };

  try {
    const response = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        "Authorization": `Klaviyo-API-Key ${klaviyoApiKey}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "revision": "2024-02-15",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Klaviyo] Failed to send Music_Ready_To_Select event:", response.status, errorText);
      return { success: false, error: errorText || `HTTP Error ${response.status}` };
    }

    console.log(`[Klaviyo] Successfully sent Music_Ready_To_Select event to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("[Klaviyo] Network error sending event:", error);
    return { success: false, error: error.message || "Network error" };
  }
}

/**
 * Sends a custom event to Klaviyo to trigger the Music Video Delivery flow.
 *
 * @param {string} klaviyoApiKey - The private API key for Klaviyo
 * @param {string} email - The customer's email address
 * @param {object} videoOrder - The VideoOrder object
 * @param {string|number} orderNumber - The human readable order number (e.g. 1013)
 * @returns {object} - { success: boolean, error?: string }
 */
export async function sendKlaviyoVideoDelivery(klaviyoApiKey, email, videoOrder, orderNumber = "") {
  if (!klaviyoApiKey || !email) {
    console.error("[Klaviyo] Missing API key or email for Video Delivery.");
    return { success: false, error: "Missing API key or email in request." };
  }

  if (!videoOrder || (!videoOrder.finalVideoUrl && !videoOrder.finalVideoKey)) {
    console.error("[Klaviyo] No final video URL/Key to deliver.");
    return { success: false, error: "No completed final video found for this order." };
  }

  const rawVideoKey = videoOrder.finalVideoKey || videoOrder.finalVideoUrl || "";
  let streamVideoUrl = videoOrder.finalVideoUrl || "";

  if (rawVideoKey && !rawVideoKey.startsWith("http://") && !rawVideoKey.startsWith("https://")) {
    try {
      streamVideoUrl = await generatePresignedUrl(rawVideoKey, 7 * 24 * 3600); // 7 days expiration
    } catch (err) {
      console.error("[Klaviyo] Failed to generate presigned S3 URL for video:", err);
    }
  }

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://myownsongs.cloud"
  ).replace(/\/$/, "");
  const videoTitle = `${videoOrder.customerName ? videoOrder.customerName + "'s" : "Custom"} Music Video`;
  const safeFilename = `${videoTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`;

  let directDownloadUrl = streamVideoUrl;
  let streamPlayUrl = streamVideoUrl;
  if (rawVideoKey) {
    directDownloadUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawVideoKey)}&filename=${encodeURIComponent(safeFilename)}`;
    streamPlayUrl = `${appUrl}/api/download?url=${encodeURIComponent(rawVideoKey)}&filename=${encodeURIComponent(safeFilename)}&stream=true`;
  }

  const formattedOrderNumber = orderNumber ? `#${orderNumber}` : (videoOrder.shopifyOrderNumber || videoOrder.shopifyOrderId || "");

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              first_name: videoOrder.customerName?.split(" ")[0] || "",
              last_name: videoOrder.customerName?.split(" ")[1] || "",
              email: email,
            },
          },
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: "Video_Delivered",
            },
          },
        },
        properties: {
          shopifyOrderId: formattedOrderNumber,
          shopifyOrderNumber: formattedOrderNumber,
          videoId: videoOrder.videoId || "",
          videoUrl: streamPlayUrl,
          directDownloadUrl: directDownloadUrl,
          streamVideoUrl: streamPlayUrl,
          package: videoOrder.selectedPackage || "Music Video",
          orderNotes: videoOrder.orderNotes || "",
          mediaCount: videoOrder.mediaFiles?.length || 0,
          audioTitle: videoOrder.audioFile?.name || "Custom Audio",
        },
        time: new Date().toISOString(),
      },
    },
  };

  try {
    const response = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        "Authorization": `Klaviyo-API-Key ${klaviyoApiKey}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "revision": "2024-02-15",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Klaviyo] Failed to send Video_Delivered event:", response.status, errorText);
      return { success: false, error: errorText || `HTTP Error ${response.status}` };
    }

    console.log(`[Klaviyo] Successfully sent Video_Delivered event to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("[Klaviyo] Network error sending Video_Delivered event:", error);
    return { success: false, error: error.message || "Network error" };
  }
}

/**
 * Queries Klaviyo API to verify whether an email/event was delivered, dropped, bounced, or is still in flow.
 * 
 * @param {string} klaviyoApiKey - Private API key for Klaviyo
 * @param {string} email - Customer email address
 * @param {string|number} shopifyOrderId - Shopify order ID
 * @param {string|number} orderNumber - Shopify order number
 * @returns {object} - Detailed status of delivery in Klaviyo
 */
export async function getKlaviyoDeliveryStatus(klaviyoApiKey, email, shopifyOrderId = "", orderNumber = "") {
  if (!klaviyoApiKey || !email) {
    return { success: false, error: "Missing Klaviyo API key or email" };
  }

  const cleanEmail = email.trim().toLowerCase();
  const headers = {
    "Authorization": `Klaviyo-API-Key ${klaviyoApiKey}`,
    "Accept": "application/json",
    "revision": "2024-02-15",
  };

  try {
    // 1. Get profile by email
    const profileRes = await fetch(
      `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(cleanEmail)}")`,
      {
        method: "GET",
        headers,
      }
    );

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      return { success: false, error: `Failed to find profile in Klaviyo: ${errText}` };
    }

    const profileData = await profileRes.json();
    const profile = profileData.data && profileData.data[0];

    if (!profile) {
      return {
        success: true,
        status: "not_found",
        summary: "Profile not found in Klaviyo. No events have been recorded for this email.",
        emailDelivered: false,
        eventSent: false,
        events: []
      };
    }

    const profileId = profile.id;

    // 2. Fetch events for this profile
    const eventsRes = await fetch(
      `https://a.klaviyo.com/api/events/?filter=equals(profile_id,"${profileId}")&include=metric&sort=-datetime&page[size]=50`,
      {
        method: "GET",
        headers,
      }
    );

    if (!eventsRes.ok) {
      const errText = await eventsRes.text();
      return { success: false, error: `Failed to fetch Klaviyo events: ${errText}` };
    }

    const eventsData = await eventsRes.json();
    const rawEvents = eventsData.data || [];
    const includedMetrics = eventsData.included || [];

    // Map metric id -> metric name
    const metricMap = {};
    for (const item of includedMetrics) {
      if (item.type === "metric" && item.attributes) {
        metricMap[item.id] = item.attributes.name;
      }
    }

    // Attach metric name to each event
    const events = rawEvents.map((e) => {
      const metricId = e.relationships?.metric?.data?.id;
      const props = e.attributes?.event_properties || e.attributes?.properties || {};
      return {
        id: e.id,
        name: metricMap[metricId] || "Unknown Event",
        datetime: e.attributes?.datetime || e.attributes?.timestamp,
        properties: props,
      };
    });

    const cleanOrderId = String(shopifyOrderId).replace(/^#/, "").trim();
    const cleanOrderNum = String(orderNumber).replace(/^#/, "").trim();

    // Look for Music_Delivered, Video_Delivered, or Publish_Delivered events (case-insensitive)
    const deliveryEvents = events.filter((e) => {
      const normName = e.name.toLowerCase().replace(/[\s_-]/g, "");
      return (
        normName === "musicdelivered" ||
        normName === "videodelivered" ||
        normName === "publishdelivered" ||
        normName.includes("musicdeliv") ||
        normName.includes("videodeliv") ||
        normName.includes("publishdeliv")
      );
    });

    // Match with orderId/orderNumber if possible, otherwise use the most recent delivery event
    let deliveryEvent = deliveryEvents.find((e) => {
      if (!cleanOrderId && !cleanOrderNum) return true;
      const propStr = JSON.stringify(e.properties).toLowerCase();
      if (cleanOrderId && propStr.includes(cleanOrderId.toLowerCase())) return true;
      if (cleanOrderNum && propStr.includes(cleanOrderNum.toLowerCase())) return true;
      return false;
    });

    // Fallback to the latest delivery event for this profile
    if (!deliveryEvent && deliveryEvents.length > 0) {
      deliveryEvent = deliveryEvents[0];
    }

    // Look for email disposition events
    const receivedEmailEvent = events.find((e) => {
      const norm = e.name.toLowerCase().replace(/[\s_-]/g, "");
      return norm === "receivedemail" || norm === "sentemail";
    });
    const droppedEmailEvent = events.find((e) => {
      const norm = e.name.toLowerCase().replace(/[\s_-]/g, "");
      return norm === "droppedemail" || norm === "spamsubmitted";
    });
    const bouncedEmailEvent = events.find((e) => {
      const norm = e.name.toLowerCase().replace(/[\s_-]/g, "");
      return norm === "bouncedemail";
    });
    const openedEmailEvent = events.find((e) => e.name.toLowerCase().replace(/[\s_-]/g, "") === "openedemail");
    const clickedEmailEvent = events.find((e) => e.name.toLowerCase().replace(/[\s_-]/g, "") === "clickedemail");

    let status = "not_found";
    let summary = "";
    let reason = "";
    let emailDelivered = false;
    let eventSent = Boolean(deliveryEvent);

    if (droppedEmailEvent) {
      status = "dropped";
      reason =
        droppedEmailEvent.properties?.reason ||
        droppedEmailEvent.properties?.drop_reason ||
        "Email dropped by Klaviyo.";
      summary = `Email was dropped by Klaviyo: ${reason}`;
    } else if (bouncedEmailEvent) {
      status = "bounced";
      reason =
        bouncedEmailEvent.properties?.bounce_type ||
        bouncedEmailEvent.properties?.reason ||
        "Email bounced from recipient mail server.";
      summary = `Email bounced: ${reason}`;
    } else if (receivedEmailEvent) {
      status = "delivered";
      emailDelivered = true;
      const subject =
        receivedEmailEvent.properties?.subject ||
        receivedEmailEvent.properties?.campaign_name ||
        receivedEmailEvent.properties?.["$message_name"] ||
        "Delivery Email";
      summary = `Email delivered to ${cleanEmail} on ${new Date(
        receivedEmailEvent.datetime
      ).toLocaleString()} ("${subject}")`;
    } else if (deliveryEvent) {
      status = "in_flow";
      summary = `Event "${deliveryEvent.name}" received by Klaviyo on ${new Date(
        deliveryEvent.datetime
      ).toLocaleString()}. Email dispatch is pending in Klaviyo.`;
    } else {
      status = "no_delivery_event";
      summary = `No delivery event found in Klaviyo for this customer.`;
    }

    return {
      success: true,
      status,
      summary,
      reason,
      emailDelivered,
      eventSent,
      deliveryEvent,
      receivedEmailEvent,
      openedEmailEvent,
      clickedEmailEvent,
      droppedEmailEvent,
      bouncedEmailEvent,
      events: events.slice(0, 10),
    };
  } catch (error) {
    console.error("[Klaviyo Status Check] Error:", error);
    return { success: false, error: error.message || "Network error checking Klaviyo status" };
  }
}

/**
 * Sends a custom event to Klaviyo to trigger the Music Publish Delivery flow.
 *
 * @param {string} klaviyoApiKey - The private API key for Klaviyo
 * @param {string} email - The customer's email address
 * @param {object} publishData - Object containing streaming links and metadata (spotifyUrl, appleMusicUrl, youtubeUrl, songTitle, message, etc.)
 * @param {string|number} orderNumber - The human readable order number (e.g. 1013)
 * @returns {object} - { success: boolean, error?: string }
 */
export async function sendKlaviyoPublishDelivery(klaviyoApiKey, email, publishData = {}, orderNumber = "") {
  if (!klaviyoApiKey || !email) {
    console.error("[Klaviyo] Missing API key or email for Publish Delivery.");
    return { success: false, error: "Missing API key or email in request." };
  }

  const {
    spotifyUrl = "",
    appleMusicUrl = "",
    youtubeUrl = "",
    otherUrl = "",
    links = [],
    songTitle = "Your Published Song",
    artistName = "",
    customMessage = "",
    customerName = "",
    language = "English",
  } = publishData;

  const formattedOrderNumber = orderNumber ? `#${orderNumber}` : (publishData.shopifyOrderNumber || publishData.shopifyOrderId || "");

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              first_name: customerName?.split(" ")[0] || "",
              last_name: customerName?.split(" ")[1] || "",
              email: email.trim().toLowerCase(),
              properties: {
                Language: language || "English",
              },
            },
          },
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: "Publish_Delivered",
            },
          },
        },
        properties: {
          shopifyOrderId: publishData.shopifyOrderId ? String(publishData.shopifyOrderId).replace(/^#/, "") : formattedOrderNumber,
          shopifyOrderNumber: formattedOrderNumber,
          rawShopifyOrderId: publishData.shopifyOrderId || "",
          orderType: "publish",
          email: email.trim().toLowerCase(),
          songTitle,
          artistName,
          spotifyUrl,
          appleMusicUrl,
          youtubeUrl,
          otherUrl,
          links: Array.isArray(links) ? links : [],
          customMessage,
          language,
          hasSpotify: Boolean(spotifyUrl),
          hasAppleMusic: Boolean(appleMusicUrl),
          hasYoutube: Boolean(youtubeUrl),
          time: new Date().toISOString(),
        },
        time: new Date().toISOString(),
      },
    },
  };

  try {
    const response = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoApiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        revision: "2024-02-15",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Klaviyo] Failed to send Publish_Delivered event:", response.status, errorText);
      return { success: false, error: errorText || `HTTP Error ${response.status}` };
    }

    console.log(`[Klaviyo] Successfully sent Publish_Delivered event to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("[Klaviyo] Network error sending Publish_Delivered event:", error);
    return { success: false, error: error.message || "Network error" };
  }
}

/**
 * Sends a custom event to Klaviyo to trigger the Music Video Upload Flow (or Reminder).
 * Sent automatically when a customer purchases the Music Video Upsell.
 */
export async function sendKlaviyoVideoUploadLink(klaviyoApiKey, email, orderNumber, uploadUrl, options = {}) {
  if (!klaviyoApiKey || !email) {
    return { success: false, error: "Missing API key or email." };
  }

  const cleanOrderNum = String(orderNumber || "").replace(/^#/, "").trim();
  const isReminder = Boolean(options.isReminder);

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: email.trim().toLowerCase(),
            },
          },
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: isReminder ? "Video_Upload_Reminder" : "Video_Upload_Required",
            },
          },
        },
        properties: {
          shopifyOrderId: cleanOrderNum ? `#${cleanOrderNum}` : "",
          shopifyOrderNumber: cleanOrderNum ? `#${cleanOrderNum}` : "",
          uploadUrl: uploadUrl || "",
          isReminder: isReminder,
          reminderCount: options.reminderCount || 1,
          time: new Date().toISOString(),
        },
        time: new Date().toISOString(),
      },
    },
  };

  try {
    const response = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoApiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        revision: "2024-02-15",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Klaviyo] Failed to send Video_Upload_Required event:", response.status, errorText);
      return { success: false, error: errorText || `HTTP Error ${response.status}` };
    }

    console.log(`[Klaviyo] Successfully sent ${isReminder ? "Video_Upload_Reminder" : "Video_Upload_Required"} event to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("[Klaviyo] Network error sending Video_Upload_Required event:", error);
    return { success: false, error: error.message || "Network error" };
  }
}

/**
 * Sends a custom event to Klaviyo with the 3 free coupons for the Pro-Song Bundle.
 */
export async function sendKlaviyoBundleCoupons(klaviyoApiKey, email, coupons = [], orderNumber = "") {
  if (!klaviyoApiKey || !email) {
    return { success: false, error: "Missing API key or email." };
  }

  const cleanOrderNum = String(orderNumber || "").replace(/^#/, "").trim();
  const couponList = Array.isArray(coupons) ? coupons : [];

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: email.trim().toLowerCase(),
            },
          },
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: "Pro_Bundle_Coupons_Issued",
            },
          },
        },
        properties: {
          shopifyOrderId: cleanOrderNum ? `#${cleanOrderNum}` : "",
          shopifyOrderNumber: cleanOrderNum ? `#${cleanOrderNum}` : "",
          coupons: couponList,
          coupon1: couponList[0] || "",
          coupon2: couponList[1] || "",
          coupon3: couponList[2] || "",
          couponCount: couponList.length,
          time: new Date().toISOString(),
        },
        time: new Date().toISOString(),
      },
    },
  };

  try {
    const response = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoApiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        revision: "2024-02-15",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Klaviyo] Failed to send Pro_Bundle_Coupons_Issued event:", response.status, errorText);
      return { success: false, error: errorText || `HTTP Error ${response.status}` };
    }

    console.log(`[Klaviyo] Successfully sent Pro_Bundle_Coupons_Issued event to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("[Klaviyo] Network error sending Pro_Bundle_Coupons_Issued event:", error);
    return { success: false, error: error.message || "Network error" };
  }
}

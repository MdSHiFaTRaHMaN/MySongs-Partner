/**
 * Music Video Tool - Interactive Client Logic
 * Matches Custom Song Builder layout & design system.
 * Handles 3-step video creation:
 * Step 1: Upload Audio
 * Step 2: Upload Photos & Videos
 * Step 3: Package & Checkout
 */

(function () {
  "use strict";

  var STORAGE_KEY = "mvt_video_tool_draft";
  var DB_NAME = "MVT_Files_DB";
  var DB_VERSION = 1;
  var STORE_NAME = "draft_files";

  // --- IndexedDB Helper for Binary File Persistence Across Page Reloads ---
  function openDB() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
  }

  async function saveFileToDB(id, file, extra) {
    extra = extra || {};
    try {
      var db = await openDB();
      if (!db) return;
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      store.put(Object.assign({ id: id, file: file, savedAt: Date.now() }, extra));
    } catch (e) {}
  }

  async function deleteFileFromDB(id) {
    try {
      var db = await openDB();
      if (!db) return;
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      store.delete(id);
    } catch (e) {}
  }

  async function getAllDraftFilesFromDB() {
    try {
      var db = await openDB();
      if (!db) return [];
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, "readonly");
        var store = tx.objectStore(STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      });
    } catch (e) {
      return [];
    }
  }

  async function clearDraftFilesFromDB() {
    try {
      var db = await openDB();
      if (!db) return;
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      store.clear();
    } catch (e) {}
  }

  function formatMoney(cents) {
    if (typeof cents !== "number" || isNaN(cents)) return "";
    if (window.Shopify && typeof window.Shopify.formatMoney === "function") {
      try {
        return window.Shopify.formatMoney(cents, window.Shopify.money_format || "{{ amount }}");
      } catch (e) {}
    }
    var formatted = (cents / 100).toFixed(2);
    var moneyFormat = (window.Shopify && (window.Shopify.money_format || window.Shopify.money_with_currency_format)) || "";
    if (moneyFormat) {
      if (moneyFormat.indexOf("{{amount_no_decimals}}") !== -1) {
        return moneyFormat.replace("{{amount_no_decimals}}", Math.round(cents / 100));
      }
      if (moneyFormat.indexOf("{{amount_with_comma_separator}}") !== -1) {
        return moneyFormat.replace("{{amount_with_comma_separator}}", (cents / 100).toFixed(2).replace(".", ","));
      }
      if (moneyFormat.indexOf("{{amount}}") !== -1) {
        return moneyFormat.replace("{{amount}}", formatted);
      }
    }
    var currSymbol = (window.Shopify && window.Shopify.currency && window.Shopify.currency.symbol) || "€";
    return currSymbol + formatted;
  }

  function initMusicVideoTool(wrapper) {
    if (!wrapper || wrapper.dataset.mvtInitialized) return;
    wrapper.dataset.mvtInitialized = "true";

    var sectionId = wrapper.dataset.sectionId;
    var backendUrl = (wrapper.dataset.backendUrl || "").replace(/\/$/, "");
    var productId = wrapper.dataset.productId;
    var defaultVariantId = wrapper.dataset.variantId;
    var rushVariantId = wrapper.dataset.rushVariantId;

    var variantPricesJson = null;
    var pricesJsonEl = wrapper.querySelector("[data-mvt-variant-prices-json]");
    if (pricesJsonEl && pricesJsonEl.textContent) {
      try {
        variantPricesJson = JSON.parse(pricesJsonEl.textContent);
      } catch (e) {}
    }

    // Read URL query parameters for Secure Token, Order Number & Bypass Payment (Upsell Upload Link)
    var urlParams = new URLSearchParams(window.location.search);
    var tokenParam = (urlParams.get("token") || "").trim();
    var prefilledOrderNumber = (urlParams.get("orderNumber") || urlParams.get("order") || urlParams.get("shopifyOrderId") || urlParams.get("id") || "").replace(/^#/, "").trim();
    var prefilledEmail = urlParams.get("email") || "";
    var isInitialPortal = Boolean(tokenParam || prefilledOrderNumber);

    if (isInitialPortal) {
      wrapper.classList.add("is-portal");
    }

    // State
    var state = {
      currentStep: 1,
      token: tokenParam,
      canEdit: true, // Will be set by portal API
      portalStatus: "active",
      linkedOrderNumber: prefilledOrderNumber,
      bypassPayment: Boolean(prefilledOrderNumber || tokenParam),
      audioFile: null, // { file, name, size, type, localUrl, key, url, isAutoSelected, trackId }
      selectedTrackId: "",
      selectedVariationIndex: 0,
      mediaFiles: [],  // Array of { id, file, name, size, type, localThumbUrl, key, url, isExisting }
      videoFormat: "9:16", // "9:16" or "16:9"
      selectedPackage: "video_standard",
      rushOrder: false,
      agreeTerms: true,
      customerEmail: prefilledEmail,
      orderNotes: "",
      videoId: "",
      allowMusicRegeneration: false,
      availableTracks: [],
      isRegeneratingMusic: false,
    };

    var options = null;

    // DOM Elements
    var stepPanels = wrapper.querySelectorAll("[data-mvt-panel]");
    var stageItems = wrapper.querySelectorAll("[data-mvt-stage]");
    var stageLines = wrapper.querySelectorAll("[data-mvt-stage-line]");

    var audioInput = wrapper.querySelector("#mvt-audio-input");
    var audioDropzone = wrapper.querySelector("[data-mvt-audio-dropzone]");
    var audioCard = wrapper.querySelector("[data-mvt-audio-card]");
    var audioFilename = wrapper.querySelector("[data-mvt-audio-filename]");
    var audioFilesize = wrapper.querySelector("[data-mvt-audio-filesize]");
    var audioPlayer = wrapper.querySelector("[data-mvt-audio-player]");
    var changeAudioBtn = wrapper.querySelector("[data-mvt-change-audio]");

    var formatCards = wrapper.querySelectorAll(".mvt-format-card");

    var mediaInput = wrapper.querySelector("#mvt-media-input");
    var mediaDropzone = wrapper.querySelector("[data-mvt-media-dropzone]");
    var mediaSection = wrapper.querySelector("[data-mvt-media-section]");
    var mediaGrid = wrapper.querySelector("[data-mvt-media-grid]");
    var mediaCountEl = wrapper.querySelector("[data-mvt-media-count]");

    var packagesGrid = wrapper.querySelector("[data-mvt-packages-grid]");
    var rushCheckbox = wrapper.querySelector("#mvt-rush-checkbox");
    var rushTitleEl = wrapper.querySelector("[data-mvt-rush-title]");
    var rushDescEl = wrapper.querySelector("[data-mvt-rush-desc]");
    var rushPriceBadge = wrapper.querySelector("[data-mvt-rush-price]");

    var emailInput = wrapper.querySelector("#mvt-customer-email");
    var lockBox = wrapper.querySelector("[data-mvt-lock-box]");
    var lockShackle = wrapper.querySelector("[data-mvt-lock-shackle]");
    var notesInput = wrapper.querySelector("#mvt-order-notes");
    var agreeCheckbox = wrapper.querySelector("#mvt-agree-terms");

    var progressCard = wrapper.querySelector("[data-mvt-upload-progress]");
    var progressBar = wrapper.querySelector("[data-mvt-progress-bar]");
    var progressPct = wrapper.querySelector("[data-mvt-progress-pct]");
    var progressStatus = wrapper.querySelector("[data-mvt-progress-status]");
    var checkoutBtn = wrapper.querySelector("[data-mvt-checkout]");

    // Modals
    var previewModal = wrapper.querySelector("[data-mvt-preview-modal]");
    var previewImg = wrapper.querySelector("[data-mvt-preview-img]");
    var previewVideo = wrapper.querySelector("[data-mvt-preview-video]");
    var previewTitle = wrapper.querySelector("[data-mvt-preview-title]");
    var previewCloseBtn = wrapper.querySelector("[data-mvt-preview-modal-close]");

    var refreshModal = wrapper.querySelector("[data-mvt-refresh-modal]");
    var refreshKeepBtn = wrapper.querySelector("[data-mvt-refresh-keep]");
    var refreshNewBtn = wrapper.querySelector("[data-mvt-refresh-new]");
    var refreshModalClose = wrapper.querySelector("[data-mvt-refresh-modal-close]");

    var cartModal = wrapper.querySelector("[data-mvt-cart-modal]");
    var cartKeepBtn = wrapper.querySelector("[data-mvt-cart-keep]");
    var cartReplaceBtn = wrapper.querySelector("[data-mvt-cart-replace]");
    var cartViewBtn = wrapper.querySelector("[data-mvt-cart-view]");
    var cartModalClose = wrapper.querySelector("[data-mvt-cart-modal-close]");

    // Secure One-Time Portal DOM Refs
    var portalBanner = wrapper.querySelector("[data-mvt-portal-banner]");
    var portalOrderTitle = wrapper.querySelector("[data-mvt-portal-order-title]");
    var portalOrderSub = wrapper.querySelector("[data-mvt-portal-order-sub]");
    var portalBadge = wrapper.querySelector("[data-mvt-portal-badge]");
    var portalLockedNotice = wrapper.querySelector("[data-mvt-portal-locked]");

    // Music Regeneration DOM Refs
    var musicRegenBox = wrapper.querySelector("[data-mvt-music-regen-box]");
    var variationsBox = wrapper.querySelector("[data-mvt-variations-box]");
    var variationsList = wrapper.querySelector("[data-mvt-variations-list]");
    var regenMusicBtn = wrapper.querySelector("[data-mvt-btn-regen-music]");
    var regenMusicSpinner = wrapper.querySelector("[data-mvt-regen-spinner]");
    var regenMusicIcon = wrapper.querySelector("[data-mvt-regen-music-icon]");
    var regenMusicText = wrapper.querySelector("[data-mvt-regen-music-text]");
    var regenStatusBox = wrapper.querySelector("[data-mvt-regen-status]");
    var regenStatusText = wrapper.querySelector("[data-mvt-regen-status-text]");
    var upsellAudioNotice = wrapper.querySelector("[data-mvt-upsell-audio-notice]");
    var regenPollInterval = null;

    // Portal Direct Step 2 Submit Refs (Eliminates Step 3 when accessed via file upload link)
    var portalSubmitWrap = wrapper.querySelector("[data-mvt-portal-submit-wrap]");
    var portalNotesInput = wrapper.querySelector("[data-mvt-portal-notes]");
    var portalSubmitBtn = wrapper.querySelector("[data-mvt-portal-submit-btn]");
    var portalSubmitText = wrapper.querySelector("[data-mvt-portal-submit-text]");
    var portalUploadProgress = wrapper.querySelector("[data-mvt-portal-upload-progress]");
    var portalProgressBar = wrapper.querySelector("[data-mvt-portal-progress-bar]");
    var portalProgressPct = wrapper.querySelector("[data-mvt-portal-progress-pct]");
    var portalProgressStatus = wrapper.querySelector("[data-mvt-portal-progress-status]");
    var normalStep2Nav = wrapper.querySelector("[data-mvt-normal-step2-nav]");
    var stage3El = wrapper.querySelector("[data-mvt-stage='3']");
    var stageLine2El = wrapper.querySelector("[data-mvt-stage-line='2']");
    var step3Panel = wrapper.querySelector("[data-mvt-panel='3']");

    var toastEl = wrapper.querySelector("#mvt-toast");
    var toastTimer = null;

    function hideAlerts() {
      wrapper.querySelectorAll("[data-mvt-step-alert]").forEach(function (el) {
        el.setAttribute("hidden", "hidden");
      });
      if (toastEl) toastEl.setAttribute("hidden", "hidden");
      if (toastTimer) clearTimeout(toastTimer);
    }

    function showToast(opts) {
      opts = opts || {};
      var activePanel = wrapper.querySelector("[data-mvt-panel].active") || wrapper.querySelector("[data-mvt-panel='" + state.currentStep + "']");
      var alertEl = activePanel ? activePanel.querySelector("[data-mvt-step-alert]") : null;

      if (alertEl) {
        var aIcon = alertEl.querySelector("[data-mvt-step-alert-icon]");
        var aTitle = alertEl.querySelector("[data-mvt-step-alert-title]");
        var aMsg = alertEl.querySelector("[data-mvt-step-alert-msg]");

        if (aIcon) aIcon.textContent = opts.variant === "success" ? "✓" : opts.variant === "error" ? "✕" : "⚠️";
        if (aTitle) aTitle.textContent = opts.title ? (opts.title.endsWith(":") ? opts.title : (opts.title + ":")) : "";
        if (aMsg) aMsg.textContent = opts.message || "";

        alertEl.className = "mvt-step-alert mvt-step-alert-" + (opts.variant || "warning");
        alertEl.removeAttribute("hidden");

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
          alertEl.setAttribute("hidden", "hidden");
        }, 5000);
        return;
      }

      if (!toastEl) return;
      var icon = toastEl.querySelector("[data-mvt-toast-icon]");
      var title = toastEl.querySelector("[data-mvt-toast-title]");
      var msg = toastEl.querySelector("[data-mvt-toast-msg]");

      if (icon) icon.textContent = opts.variant === "success" ? "✓" : opts.variant === "error" ? "✕" : "⚠️";
      if (title) title.textContent = opts.title || "Notice";
      if (msg) msg.textContent = opts.message || "";

      toastEl.removeAttribute("hidden");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.setAttribute("hidden", "hidden");
      }, 5000);
    }

    // Step Navigation
    function goToStep(step) {
      var isPortalUser = Boolean(state.token || state.linkedOrderNumber || state.bypassPayment);
      if (isPortalUser && step > 2) {
        step = 2;
      }
      state.currentStep = step;

      stepPanels.forEach(function (panel) {
        var pNum = parseInt(panel.dataset.mvtPanel, 10);
        if (pNum === step) {
          panel.removeAttribute("hidden");
          panel.classList.add("active");
        } else {
          panel.setAttribute("hidden", "hidden");
          panel.classList.remove("active");
        }
      });

      stageItems.forEach(function (stage, idx) {
        var sNum = idx + 1;
        var iconEl = stage.querySelector(".mvt-stage-icon");
        if (sNum < step) {
          stage.classList.add("is-completed");
          stage.classList.remove("is-active");
          if (iconEl) iconEl.textContent = "✓";
        } else if (sNum === step) {
          stage.classList.add("is-active");
          stage.classList.remove("is-completed");
          if (iconEl) iconEl.textContent = String(sNum);
        } else {
          stage.classList.remove("is-active", "is-completed");
          if (iconEl) iconEl.textContent = String(sNum);
        }
      });

      stageLines.forEach(function (line, idx) {
        var lineNum = idx + 1;
        line.classList.toggle("is-completed", step > lineNum);
      });

      saveDraft();
      renderPortalStatusUI();

      // Scroll smoothly to top of card
      var rect = wrapper.getBoundingClientRect();
      if (rect.top < 0 || rect.top > 200) {
        window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: "smooth" });
      }
    }

    // Fetch Dashboard Options
    function fetchDashboardOptions() {
      if (!backendUrl) return;
      fetch(backendUrl + "/api/video-options")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.success && data.data) {
            options = data.data;
            renderDynamicOptions();
          }
        })
        .catch(function (err) {
          console.warn("[Music Video Tool] Could not fetch remote options:", err);
        });
    }

    function renderDynamicOptions() {
      if (!options) return;

      // Update Step Headings if provided
      if (options.step1Title) {
        var s1t = wrapper.querySelector("[data-mvt-step1-title]");
        if (s1t) s1t.textContent = options.step1Title;
      }
      if (options.step1Subtitle) {
        var s1s = wrapper.querySelector("[data-mvt-step1-subtitle]");
        if (s1s) s1s.textContent = options.step1Subtitle;
      }
      if (options.step2Title) {
        var s2t = wrapper.querySelector("[data-mvt-step2-title]");
        if (s2t) s2t.textContent = options.step2Title;
      }
      if (options.step2Subtitle) {
        var s2s = wrapper.querySelector("[data-mvt-step2-subtitle]");
        if (s2s) s2s.textContent = options.step2Subtitle;
      }
      if (options.step2FormatTitle) {
        var s2ft = wrapper.querySelector("[data-mvt-format-title]");
        if (s2ft) s2ft.textContent = options.step2FormatTitle;
      }
      if (options.step2FormatDesc) {
        var s2fd = wrapper.querySelector("[data-mvt-format-desc]");
        if (s2fd) s2fd.textContent = options.step2FormatDesc;
      }
      if (options.step3Title) {
        var s3t = wrapper.querySelector("[data-mvt-step3-title]");
        if (s3t) s3t.textContent = options.step3Title;
      }
      if (options.step3Subtitle) {
        var s3s = wrapper.querySelector("[data-mvt-step3-subtitle]");
        if (s3s) s3s.textContent = options.step3Subtitle;
      }

      // Update Rush settings & badge
      if (rushTitleEl && options.rushOrderTitle) rushTitleEl.textContent = options.rushOrderTitle;
      if (rushDescEl && options.rushOrderDescription) rushDescEl.textContent = options.rushOrderDescription;

      // Update Rush badge using active Shopify Market localized pricing
      if (rushPriceBadge && variantPricesJson) {
        var defV = variantPricesJson.default_variant;
        var rushV = null;
        if (variantPricesJson.variants) {
          var vKeys = Object.keys(variantPricesJson.variants);
          for (var i = 0; i < vKeys.length; i++) {
            var vObj = variantPricesJson.variants[vKeys[i]];
            var vTitle = (vObj.title || "").toLowerCase();
            if (vTitle.indexOf("rush") !== -1 || vTitle.indexOf("fast") !== -1 || vTitle.indexOf("2 hours") !== -1 || vTitle.indexOf("60") !== -1) {
              rushV = vObj;
              break;
            }
          }
          if (!rushV && vKeys.length > 1) {
            rushV = variantPricesJson.variants[vKeys[1]];
          }
        }
        if (rushV && defV && rushV.price && defV.price && rushV.price > defV.price) {
          rushPriceBadge.textContent = "+" + formatMoney(rushV.price - defV.price);
        } else if (rushV && rushV.formatted_price) {
          rushPriceBadge.textContent = "+" + rushV.formatted_price;
        }
      }

      // Render Packages with Shopify Market Localization
      if (packagesGrid && options.packages && options.packages.length > 0) {
        packagesGrid.innerHTML = "";
        options.packages.forEach(function (pkg, idx) {
          var isSel = state.selectedPackage === pkg.id || (idx === 0 && !state.selectedPackage);
          if (isSel) state.selectedPackage = pkg.id;

          var card = document.createElement("div");
          card.className = "mvt-package-card" + (isSel ? " is-selected" : "");
          card.setAttribute("data-package-id", pkg.id);

          if (pkg.shopifyVariantId) card.setAttribute("data-variant-id", pkg.shopifyVariantId);
          if (pkg.shopifyRushVariantId) card.setAttribute("data-rush-variant-id", pkg.shopifyRushVariantId);

          if (pkg.tagline) {
            var tag = document.createElement("div");
            tag.className = "mvt-package-tag";
            tag.textContent = pkg.tagline;
            card.appendChild(tag);
          }

          var body = document.createElement("div");
          body.className = "mvt-package-body";

          var title = document.createElement("h3");
          title.className = "mvt-package-title";
          title.textContent = (pkg.title && pkg.title.indexOf("🎬") === -1) ? ("🎬 " + pkg.title) : pkg.title;
          body.appendChild(title);

          var lengthBadge = document.createElement("div");
          lengthBadge.className = "mvt-package-length-badge";
          lengthBadge.textContent = "Full HD 1080p Video";
          body.appendChild(lengthBadge);

          if (pkg.features && pkg.features.length > 0) {
            var featWrap = document.createElement("div");
            featWrap.className = "mvt-package-features";
            var featLabel = document.createElement("div");
            featLabel.className = "mvt-package-features-label";
            featLabel.textContent = "📦 What's included?";
            featWrap.appendChild(featLabel);

            var ul = document.createElement("ul");
            pkg.features.forEach(function (f) {
              var li = document.createElement("li");
              li.textContent = f;
              ul.appendChild(li);
            });
            featWrap.appendChild(ul);
            body.appendChild(featWrap);
          }

          // Format prices strictly according to active Shopify Market
          var vInfo = null;
          if (variantPricesJson && variantPricesJson.variants) {
            vInfo = (pkg.shopifyVariantId && variantPricesJson.variants[pkg.shopifyVariantId]) || variantPricesJson.default_variant;
          }

          var vPrice = vInfo && typeof vInfo.price === "number" ? vInfo.price : 0;
          var vComp = vInfo && typeof (vInfo.compare_at_price || vInfo.compare_at) === "number" ? (vInfo.compare_at_price || vInfo.compare_at) : 0;

          var rawPriceNum = pkg.price ? parseFloat(String(pkg.price).replace(/[^0-9.]/g, "")) : 0;
          var rawCompNum = pkg.compareAtPrice ? parseFloat(String(pkg.compareAtPrice).replace(/[^0-9.]/g, "")) : 0;

          var formattedPrice = "";
          var formattedCompareAt = "";
          var discountPercent = 0;

          // 1. Regular Price
          if (vInfo && vPrice > 0 && vInfo.formatted_price) {
            formattedPrice = vInfo.formatted_price;
          } else if (rawPriceNum > 0) {
            formattedPrice = formatMoney(Math.round(rawPriceNum * 100));
          } else {
            formattedPrice = pkg.price || (vInfo ? vInfo.formatted_price : "") || "€49.95";
          }

          // 2. Compare At Price
          if (vInfo && vComp > 0 && (vInfo.formatted_compare_at || vInfo.formatted_default_compare_at)) {
            formattedCompareAt = vInfo.formatted_compare_at || vInfo.formatted_default_compare_at;
          } else if (rawCompNum > 0) {
            formattedCompareAt = formatMoney(Math.round(rawCompNum * 100));
          } else if (pkg.compareAtPrice) {
            formattedCompareAt = pkg.compareAtPrice;
          }

          // 3. Discount Percentage: Math.round(((compare_at - price) * 100) / compare_at)
          var effectivePrice = vPrice > 0 ? (vPrice / 100) : rawPriceNum;
          var effectiveComp = vComp > 0 ? (vComp / 100) : rawCompNum;

          if (effectiveComp > effectivePrice && effectiveComp > 0) {
            var diff = effectiveComp - effectivePrice;
            discountPercent = Math.round((diff * 100) / effectiveComp);
          }

          var priceWrap = document.createElement("div");
          priceWrap.className = "mvt-package-price-wrap";

          if (formattedCompareAt && formattedCompareAt !== formattedPrice) {
            var origPrice = document.createElement("span");
            origPrice.className = "mvt-package-original-price";
            origPrice.textContent = formattedCompareAt;
            priceWrap.appendChild(origPrice);
          }

          var price = document.createElement("div");
          price.className = "mvt-package-price";
          price.textContent = formattedPrice;
          priceWrap.appendChild(price);

          if (discountPercent > 0) {
            var discBadge = document.createElement("span");
            discBadge.className = "mvt-package-discount-badge";
            discBadge.textContent = discountPercent + "% OFF";
            priceWrap.appendChild(discBadge);
          }

          body.appendChild(priceWrap);
          card.appendChild(body);

          card.addEventListener("click", function () {
            state.selectedPackage = pkg.id;
            wrapper.querySelectorAll(".mvt-package-card").forEach(function (c) {
              c.classList.toggle("is-selected", c.getAttribute("data-package-id") === pkg.id);
            });
            saveDraft();
      renderPortalStatusUI();
          });

          packagesGrid.appendChild(card);
        });
      }
    }

    async function fetchPortalData() {
      if (!tokenParam && !prefilledOrderNumber) return;
      var queryParam = tokenParam
        ? ("token=" + encodeURIComponent(tokenParam))
        : ("id=" + encodeURIComponent(prefilledOrderNumber));
      var portalUrl = (backendUrl || "") + "/api/video-tool/portal?" + queryParam;

      try {
        var res = await fetch(portalUrl);
        var data = await res.json();
        if (data && data.success && data.order) {
          var ord = data.order;
          state.canEdit = ord.canEdit !== false;
          state.portalStatus = ord.tokenStatus || (ord.canEdit ? "active" : "consumed");
          state.linkedOrderNumber = ord.orderNumber ? String(ord.orderNumber).replace(/^#/, "") : state.linkedOrderNumber;
          state.bypassPayment = true;

          if (ord.email) {
            state.customerEmail = ord.email;
            if (emailInput) {
              emailInput.value = ord.email;
              emailInput.dispatchEvent(new Event("input"));
            }
          }

          if (ord.videoFormat) {
            state.videoFormat = ord.videoFormat;
            updateFormatSelectionUI(ord.videoFormat);
          }

          if (ord.orderNotes && notesInput) {
            state.orderNotes = ord.orderNotes;
            notesInput.value = ord.orderNotes;
          }

          // Music Regeneration & Tracks from linked order
          state.allowMusicRegeneration = ord.allowMusicRegeneration !== false;
          state.availableTracks = Array.isArray(ord.availableTracks) ? ord.availableTracks : [];

          // 1. Auto-selected or existing audio file
          if (ord.audioFile && (ord.audioFile.key || ord.audioFile.url)) {
            state.selectedVariationIndex = 0;
            state.selectedTrackId = ord.audioFile.trackId || ord.audioFile.key || (ord.availableTracks && ord.availableTracks[0] ? (ord.availableTracks[0].id || ord.availableTracks[0].key) : "");
            displayAudioFile({
              name: ord.audioFile.name || "Custom Audio Track",
              size: ord.audioFile.size || 0,
              type: "audio/mp3",
              key: ord.audioFile.key,
              url: ord.audioFile.url,
              localUrl: ord.audioFile.url,
              trackId: state.selectedTrackId,
              isAutoSelected: true,
            });

            if (upsellAudioNotice) {
              upsellAudioNotice.removeAttribute("hidden");
            }

            var s1Title = wrapper.querySelector("[data-mvt-step1-title]");
            if (s1Title) s1Title.textContent = "Step 1: Your Custom Song";
            var s1Subtitle = wrapper.querySelector("[data-mvt-step1-subtitle]");
            if (s1Subtitle) {
              s1Subtitle.textContent = "Your custom song is already connected to this order. Click Next to upload your photos and video memories.";
            }

            // Auto-advance to Step 2 so customer can upload photos directly
            if ((!ord.mediaFiles || ord.mediaFiles.length === 0) && state.currentStep === 1) {
              setTimeout(function () {
                goToStep(2);
                showToast({
                  variant: "success",
                  title: "Custom Song Connected! 🎵",
                  message: "Your song (" + (ord.audioFile.name || "Custom Song") + ") is already linked! Please upload your photos & videos below.",
                });
              }, 150);
            }
          }

          // 2. Existing media files
          if (Array.isArray(ord.mediaFiles) && ord.mediaFiles.length > 0) {
            state.mediaFiles = ord.mediaFiles.map(function (m, idx) {
              return {
                id: m.id || ("prev_" + idx),
                name: m.name || ("File " + (idx + 1)),
                size: m.size || 0,
                type: m.type || "image",
                key: m.key,
                url: m.url,
                localThumbUrl: m.url,
                isExisting: true,
              };
            });
            renderMediaGrid();
          }

          renderPortalStatusUI();
        } else {
          if (portalLockedNotice) {
            portalLockedNotice.removeAttribute("hidden");
            portalLockedNotice.innerHTML = '<span style="font-size: 24px; line-height: 1;">⚠️</span><div style="flex: 1;"><strong style="display: block; font-size: 14px; font-weight: 700; margin-bottom: 4px; color: #991b1b;">Order Link Not Recognized</strong><p style="margin: 0; font-size: 13px; line-height: 1.5; color: #7f1d1d;">We could not match this upload link to an active order. Please check the exact link sent to your email or contact support.</p></div>';
          }
        }
      } catch (err) {
        console.warn("[Portal Data Fetch Error]:", err);
      }
    }

    function renderPortalStatusUI() {
      if (portalBanner) {
        if (state.token || state.linkedOrderNumber) {
          portalBanner.removeAttribute("hidden");
          if (portalOrderTitle) {
            portalOrderTitle.textContent = "Order #" + (state.linkedOrderNumber || "") + " Media Portal";
          }
          if (portalOrderSub) {
            portalOrderSub.textContent = state.canEdit
              ? "Upload photos and videos for your music video (1 submission allowed)."
              : "Review your submitted photos, videos, and music.";
          }
          if (portalBadge) {
            if (state.canEdit) {
              portalBadge.innerHTML = '<span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #22c55e;"></span> Portal Active (1 Submission Allowed)</span>';
            } else {
              portalBadge.innerHTML = '<span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; background: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700;">🔒 Portal Closed / Locked</span>';
            }
          }
        } else {
          portalBanner.setAttribute("hidden", "hidden");
        }
      }

      if (portalLockedNotice) {
        if (!state.canEdit && (state.token || state.linkedOrderNumber)) {
          portalLockedNotice.removeAttribute("hidden");
        } else {
          portalLockedNotice.setAttribute("hidden", "hidden");
        }
      }

      // If portal is locked (canEdit === false), lock interactive upload/edit controls
      if (!state.canEdit && (state.token || state.linkedOrderNumber)) {
        if (audioDropzone) audioDropzone.setAttribute("hidden", "hidden");
        if (changeAudioBtn) changeAudioBtn.setAttribute("hidden", "hidden");
        if (mediaDropzone) mediaDropzone.setAttribute("hidden", "hidden");
        if (checkoutBtn) {
          checkoutBtn.disabled = true;
          checkoutBtn.style.opacity = "0.5";
          checkoutBtn.style.pointerEvents = "none";
          var txt = checkoutBtn.querySelector(".mvt-btn-checkout-text");
          if (txt) txt.textContent = "🔒 Submissions Closed / Locked";
        }
      } else if (state.bypassPayment || state.token || state.linkedOrderNumber) {
        if (checkoutBtn) {
          var btnTxt = checkoutBtn.querySelector(".mvt-btn-checkout-text");
          if (btnTxt) btnTxt.textContent = "Submit Video Media Files";
        }
      }

      var isPortal = Boolean(state.token || state.linkedOrderNumber || state.bypassPayment);
      if (isPortal) {
        wrapper.classList.add("is-portal");

        // ELIMINATE STEP 3 COMPLETELY FOR FILE UPLOAD LINK USERS
        // They already ordered and paid in Shopify. No package selection, no prices, no extra checkout step.
        if (step3Panel) {
          step3Panel.setAttribute("hidden", "hidden");
          step3Panel.classList.add("is-hidden");
          step3Panel.style.setProperty("display", "none", "important");
        }

        // Hide Step 3 & connection line from the top stepper
        if (stage3El) stage3El.style.setProperty("display", "none", "important");
        if (stageLine2El) stageLine2El.style.setProperty("display", "none", "important");

        var stage2Label = wrapper.querySelector("[data-mvt-stage='2'] .mvt-stage-label");
        if (stage2Label) stage2Label.textContent = "Upload Photos & Submit";

        // In Step 2, hide the normal "Next Step" to Step 3 and show direct portal submit section
        if (normalStep2Nav) {
          normalStep2Nav.setAttribute("hidden", "hidden");
          normalStep2Nav.classList.add("is-hidden");
          normalStep2Nav.style.setProperty("display", "none", "important");
        }
        if (portalSubmitWrap) {
          portalSubmitWrap.removeAttribute("hidden");
          portalSubmitWrap.classList.remove("is-hidden");
          portalSubmitWrap.style.setProperty("display", "block", "important");
        }

        // Sync notes from state if present
        if (portalNotesInput && state.orderNotes && !portalNotesInput.value) {
          portalNotesInput.value = state.orderNotes;
        }

        // Handle portal locked state
        if (!state.canEdit) {
          if (portalSubmitBtn) {
            portalSubmitBtn.disabled = true;
            portalSubmitBtn.style.opacity = "0.5";
            portalSubmitBtn.style.cursor = "not-allowed";
            if (portalSubmitText) portalSubmitText.textContent = "🔒 Submissions Closed / Locked";
          }
          if (portalNotesInput) portalNotesInput.disabled = true;
        } else {
          if (portalSubmitBtn) {
            portalSubmitBtn.disabled = false;
            portalSubmitBtn.style.opacity = "1";
            portalSubmitBtn.style.cursor = "pointer";
            if (portalSubmitText) portalSubmitText.textContent = "Submit Video Media Files ➜";
          }
          if (portalNotesInput) portalNotesInput.disabled = false;
        }
      } else {
        wrapper.classList.remove("is-portal");
        if (step3Panel) {
          step3Panel.removeAttribute("hidden");
          step3Panel.classList.remove("is-hidden");
          step3Panel.style.display = "";
        }
        if (stage3El) stage3El.style.display = "";
        if (stageLine2El) stageLine2El.style.display = "";
        if (normalStep2Nav) {
          normalStep2Nav.removeAttribute("hidden");
          normalStep2Nav.classList.remove("is-hidden");
          normalStep2Nav.style.display = "";
        }
        if (portalSubmitWrap) {
          portalSubmitWrap.setAttribute("hidden", "hidden");
          portalSubmitWrap.classList.add("is-hidden");
          portalSubmitWrap.style.setProperty("display", "none", "important");
        }
      }

      renderMusicRegenerationUI();
    }

    function renderMusicRegenerationUI() {
      if (!musicRegenBox) return;

      var isUpsellCustomer = Boolean(state.token || state.linkedOrderNumber);
      var allowed = isUpsellCustomer && state.allowMusicRegeneration;

      if (allowed) {
        musicRegenBox.removeAttribute("hidden");
      } else {
        musicRegenBox.setAttribute("hidden", "hidden");
        return;
      }

      // Render Available Song Variations
      if (variationsBox && variationsList) {
        var tracks = state.availableTracks || [];
        if (tracks.length > 0) {
          variationsBox.removeAttribute("hidden");
          variationsList.innerHTML = "";
          tracks.forEach(function (tr, idx) {
            var btn = document.createElement("button");
            btn.type = "button";

            // Determine if this exact track is selected (Never match identical track titles)
            var currentTrackId = state.selectedTrackId || (state.audioFile && (state.audioFile.trackId || state.audioFile.key || state.audioFile.url)) || "";
            var isActive = false;
            if (currentTrackId) {
              isActive = (tr.id && tr.id === currentTrackId) ||
                         (tr.key && tr.key === currentTrackId) ||
                         (tr.url && tr.url === currentTrackId);
            }
            if (!isActive && idx === (state.selectedVariationIndex || 0)) {
              isActive = true;
            }

            var varNum = idx + 1;
            var varLabel = tr.variationName || ("Variation " + varNum);

            btn.className = "mvt-variation-pill" + (isActive ? " is-active" : "");
            btn.style.cssText = "display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; border-radius: 9999px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; outline: none;" +
              (isActive 
                ? "background: #9333ea; color: white; border: 1.5px solid #7e22ce; box-shadow: 0 2px 8px rgba(147, 51, 234, 0.4);" 
                : "background: #ffffff; color: #4b5563; border: 1.5px solid #e5e7eb;");
            
            btn.innerHTML = (isActive ? "✓ " : "▶ ") + varLabel;
            btn.title = tr.title ? (tr.title + " (" + varLabel + ")") : varLabel;

            btn.addEventListener("click", function () {
              if (state.isRegeneratingMusic) return;
              state.selectedVariationIndex = idx;
              state.selectedTrackId = tr.id || tr.key || tr.url;

              displayAudioFile({
                name: (tr.title || "Custom Song") + " (" + varLabel + ")",
                size: 0,
                type: "audio/mp3",
                key: tr.key,
                url: tr.url,
                localUrl: tr.url,
                trackId: tr.id || tr.key,
                isAutoSelected: true,
              });

              renderMusicRegenerationUI();
              saveDraft();

              if (audioPlayer) {
                audioPlayer.currentTime = 0;
                audioPlayer.play().catch(function () {});
              }
            });

            variationsList.appendChild(btn);
          });
        } else {
          variationsBox.setAttribute("hidden", "hidden");
        }
      }

      // Regeneration button states
      if (regenMusicBtn) {
        if (!state.canEdit) {
          regenMusicBtn.disabled = true;
          regenMusicBtn.style.opacity = "0.5";
          regenMusicBtn.style.cursor = "not-allowed";
          regenMusicBtn.title = "Portal is locked";
        } else if (state.isRegeneratingMusic) {
          regenMusicBtn.disabled = true;
          regenMusicBtn.style.cursor = "wait";
          if (regenMusicSpinner) regenMusicSpinner.removeAttribute("hidden");
          if (regenMusicIcon) regenMusicIcon.setAttribute("hidden", "hidden");
          if (regenMusicText) regenMusicText.textContent = "Composing AI Music...";
        } else {
          regenMusicBtn.disabled = false;
          regenMusicBtn.style.opacity = "1";
          regenMusicBtn.style.cursor = "pointer";
          if (regenMusicSpinner) regenMusicSpinner.setAttribute("hidden", "hidden");
          if (regenMusicIcon) regenMusicIcon.removeAttribute("hidden");
          if (regenMusicText) regenMusicText.textContent = "Regenerate Music";
        }
      }
    }

    async function handleStartMusicRegeneration() {
      if (state.isRegeneratingMusic || !state.canEdit) return;

      var ok = window.confirm("Generate a fresh music variation using your order's custom story and lyrics? This takes about 1-2 minutes.");
      if (!ok) return;

      state.isRegeneratingMusic = true;
      renderMusicRegenerationUI();

      if (regenStatusBox) {
        regenStatusBox.removeAttribute("hidden");
        if (regenStatusText) regenStatusText.textContent = "Contacting AI composer... please wait...";
      }

      var regenUrl = (backendUrl || "") + "/api/video-tool/portal/regenerate-music";

      try {
        var res = await fetch(regenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: state.token,
            id: state.linkedOrderNumber,
          }),
        });

        var data = await res.json();
        if (!res.ok || !data.success || !data.taskId) {
          throw new Error(data.error || "Failed to initiate music regeneration.");
        }

        if (regenStatusText) {
          regenStatusText.textContent = "Composing new music with AI... this usually takes 1-2 minutes.";
        }

        pollMusicStatus(data.taskId);
      } catch (err) {
        console.error("[Music Regen Error]:", err);
        showToast({ title: "Regeneration Failed", message: err.message || "Could not regenerate music." });
        state.isRegeneratingMusic = false;
        if (regenStatusBox) regenStatusBox.setAttribute("hidden", "hidden");
        renderMusicRegenerationUI();
      }
    }

    function pollMusicStatus(encryptedTaskId) {
      if (regenPollInterval) clearInterval(regenPollInterval);

      var pollUrl = (backendUrl || "") + "/api/suno/status?taskId=" + encodeURIComponent(encryptedTaskId) + "&type=music";
      var attempts = 0;
      var maxAttempts = 60; // 60 * 4s = 240 seconds max

      regenPollInterval = setInterval(async function () {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(regenPollInterval);
          state.isRegeneratingMusic = false;
          if (regenStatusBox) regenStatusBox.setAttribute("hidden", "hidden");
          renderMusicRegenerationUI();
          showToast({ title: "Timeout", message: "Generation took longer than expected. Please refresh the page in a moment." });
          return;
        }

        try {
          var res = await fetch(pollUrl);
          var data = await res.json();

          if (data && data.status === "SUCCESS" && Array.isArray(data.tracks) && data.tracks.length > 0) {
            clearInterval(regenPollInterval);
            state.isRegeneratingMusic = false;

            // Formulate newly generated tracks
            var newTracks = data.tracks.map(function (t, idx) {
              return {
                id: t.id || ("new_track_" + idx),
                title: t.title || ("Variation " + (idx + 1)),
                variationName: "Variation " + (idx + 1),
                url: t.streamAudioUrl || t.audioUrl || "",
                key: t.streamAudioUrl || t.audioUrl || "",
                duration: t.duration || 0,
              };
            });

            state.availableTracks = newTracks;
            state.selectedVariationIndex = 0;
            state.selectedTrackId = newTracks[0] ? (newTracks[0].id || newTracks[0].key) : "";

            // Auto-select Track 1
            if (newTracks[0]) {
              displayAudioFile({
                name: (newTracks[0].title || "Fresh AI Track") + " (Variation 1)",
                size: 0,
                type: "audio/mp3",
                key: newTracks[0].key,
                url: newTracks[0].url,
                localUrl: newTracks[0].url,
                trackId: state.selectedTrackId,
                isAutoSelected: true,
              });
            }

            if (regenStatusBox) regenStatusBox.setAttribute("hidden", "hidden");
            renderMusicRegenerationUI();
            saveDraft();

            showToast({
              title: "Music Ready!",
              message: "Fresh music variation generated and attached to your video order!",
            });
          } else if (data && data.status === "FAILED") {
            clearInterval(regenPollInterval);
            state.isRegeneratingMusic = false;
            if (regenStatusBox) regenStatusBox.setAttribute("hidden", "hidden");
            renderMusicRegenerationUI();
            showToast({
              title: "Music Generation Failed",
              message: data.error || "The AI encountered an issue generating music. Please try again.",
            });
          }
        } catch (pollErr) {
          console.warn("[Music Poll Error]:", pollErr);
        }
      }, 4000);
    }

    var MAX_AUDIO_BYTES = 15 * 1024 * 1024;   // 15MB
    var MAX_TOTAL_BYTES = 300 * 1024 * 1024;  // 300MB

    function getTotalUploadSize() {
      var total = (state.audioFile && state.audioFile.size) ? state.audioFile.size : 0;
      state.mediaFiles.forEach(function (m) {
        total += (m.size || (m.file && m.file.size) || 0);
      });
      return total;
    }

    // Step 1: Audio handling
    function handleAudioFile(file, isRestoring) {
      if (!file) return;

      var validExts = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"];
      var nameLower = file.name.toLowerCase();
      var isValid = validExts.some(function (ext) { return nameLower.endsWith(ext); }) || file.type.startsWith("audio/");

      if (!isValid) {
        showToast({ variant: "error", title: "Invalid File", message: "Please select an audio file (MP3, WAV, M4A, AAC, FLAC)." });
        return;
      }

      if (file.size > MAX_AUDIO_BYTES) {
        showToast({ variant: "error", title: "Audio Too Large", message: "Audio file must be under 15MB." });
        return;
      }

      if (audioPlayer) {
        audioPlayer.pause();
      }

      var blobUrl = URL.createObjectURL(file);
      state.audioFile = {
        file: file,
        name: file.name,
        size: file.size,
        type: file.type,
        localUrl: blobUrl,
      };

      if (audioFilename) audioFilename.textContent = file.name;
      if (audioFilesize) audioFilesize.textContent = (file.size / (1024 * 1024)).toFixed(1) + " MB (Max 15MB)";
      if (audioPlayer) audioPlayer.src = blobUrl;

      if (audioDropzone) audioDropzone.setAttribute("hidden", "hidden");
      if (audioCard) audioCard.removeAttribute("hidden");
      renderMusicRegenerationUI();

      if (!isRestoring) {
        saveFileToDB("audio_track", file, { name: file.name, size: file.size, type: file.type });
        saveDraft();
      renderPortalStatusUI();
        showToast({ variant: "success", title: "Audio Ready", message: "Audio file loaded successfully!" });
      }
    }

    function displayAudioFile(audioObj) {
      if (!audioObj) return;
      state.audioFile = audioObj;
      if (audioObj.trackId) {
        state.selectedTrackId = audioObj.trackId;
      }
      if (audioFilename) audioFilename.textContent = audioObj.name || "Custom Audio Track";
      if (audioFilesize) {
        if (audioObj.isAutoSelected) {
          audioFilesize.textContent = "✓ Auto-selected from your Music Order";
          audioFilesize.style.color = "#10B981";
          audioFilesize.style.fontWeight = "600";
        } else if (audioObj.size) {
          audioFilesize.textContent = (audioObj.size / (1024 * 1024)).toFixed(1) + " MB";
        } else {
          audioFilesize.textContent = "Attached Audio Track";
        }
      }
      var playUrl = audioObj.localUrl || audioObj.url;
      if (audioPlayer && playUrl) {
        audioPlayer.src = playUrl;
      }
      if (audioDropzone) audioDropzone.setAttribute("hidden", "hidden");
      if (audioCard) audioCard.removeAttribute("hidden");
      renderMusicRegenerationUI();
    }

    if (audioInput) {
      audioInput.addEventListener("change", function (e) {
        if (e.target.files && e.target.files[0]) {
          handleAudioFile(e.target.files[0]);
        }
      });
    }

    // Audio Dropzone — Drag & Drop
    if (audioDropzone) {
      audioDropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        audioDropzone.classList.add("is-dragover");
      });
      audioDropzone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        audioDropzone.classList.remove("is-dragover");
      });
      audioDropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        audioDropzone.classList.remove("is-dragover");
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) {
          handleAudioFile(files[0]);
        }
      });
    }

    if (changeAudioBtn) {
      changeAudioBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (audioInput) {
          audioInput.value = "";
          audioInput.click();
        }
      });
    }

    if (regenMusicBtn) {
      regenMusicBtn.addEventListener("click", handleStartMusicRegeneration);
    }

    // Step 2: Media handling
    function handleMediaFiles(filesList, isRestoring) {
      if (!filesList || filesList.length === 0) return;

      var currentTotal = getTotalUploadSize();
      var addedCount = 0;

      Array.from(filesList).forEach(function (file) {
        var isImg = file.type.startsWith("image/") || /\.(jpg|jpeg|png|heic|webp)$/i.test(file.name);
        var isVid = file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);

        if (!isImg && !isVid) return;

        if (file.size > MAX_TOTAL_BYTES) {
          showToast({ variant: "error", title: "File Too Large", message: '"' + file.name + '" exceeds the 300MB limit.' });
          return;
        }

        if (currentTotal + file.size > MAX_TOTAL_BYTES) {
          var remainingMB = Math.max(0, ((MAX_TOTAL_BYTES - currentTotal) / (1024 * 1024))).toFixed(1);
          showToast({
            variant: "error",
            title: "Total 300MB Exceeded",
            message: 'Adding "' + file.name + '" exceeds the total 300MB limit. Remaining space: ' + remainingMB + ' MB.',
          });
          return;
        }

        currentTotal += file.size;
        var mId = "media_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
        var blobUrl = URL.createObjectURL(file);

        var mediaItem = {
          id: mId,
          file: file,
          name: file.name,
          size: file.size,
          type: isVid ? "video" : "image",
          localThumbUrl: blobUrl,
        };

        state.mediaFiles.push(mediaItem);
        addedCount++;

        if (!isRestoring) {
          saveFileToDB(mId, file, { name: file.name, size: file.size, type: mediaItem.type });
        }
      });

      renderMediaGrid();
      if (!isRestoring && addedCount > 0) {
        saveDraft();
      renderPortalStatusUI();
      }
    }

    var draggedMediaIndex = null;

    function renderMediaGrid() {
      if (!mediaGrid) return;
      mediaGrid.innerHTML = "";

      if (state.mediaFiles.length === 0) {
        if (mediaSection) mediaSection.setAttribute("hidden", "hidden");
        if (mediaCountEl) mediaCountEl.textContent = "0 files";
        return;
      }

      var totalBytes = getTotalUploadSize();
      var totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

      if (mediaSection) mediaSection.removeAttribute("hidden");
      if (mediaCountEl) {
        mediaCountEl.textContent = state.mediaFiles.length + " file" + (state.mediaFiles.length > 1 ? "s" : "") + " (" + totalMB + " MB / 300 MB max)";
      }

      state.mediaFiles.forEach(function (item, idx) {
        var thumb = document.createElement("div");
        thumb.className = "mvt-media-thumb";
        thumb.setAttribute("data-media-id", item.id);
        thumb.setAttribute("data-index", idx);
        thumb.setAttribute("data-type", item.type);
        if (state.canEdit !== false) {
          thumb.setAttribute("draggable", "true");
          thumb.title = "Drag to reorder (#" + (idx + 1) + " " + (item.type === "video" ? "Video" : "Photo") + ")";
        } else {
          thumb.setAttribute("draggable", "false");
          thumb.title = "Click to preview (#" + (idx + 1) + " " + (item.type === "video" ? "Video" : "Photo") + ")";
          thumb.style.cursor = "pointer";
        }

        // Numbered Order Badge (e.g. #1 Photo, #2 Video)
        var orderBadge = document.createElement("div");
        orderBadge.className = "mvt-media-order-badge";
        var typeLabel = item.type === "video" ? "Video" : "Photo";
        orderBadge.innerHTML = "#" + (idx + 1) + ' <span class="mvt-media-order-type">' + typeLabel + "</span>";
        thumb.appendChild(orderBadge);

        if (item.type === "video") {
          var vid = document.createElement("video");
          vid.src = item.localThumbUrl;
          vid.preload = "metadata";
          thumb.appendChild(vid);
        } else {
          var img = document.createElement("img");
          img.src = item.localThumbUrl;
          img.alt = item.name || "Photo";
          thumb.appendChild(img);
        }

        if (state.canEdit !== false) {
          // Delete Button
          var delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "mvt-media-delete-btn";
          delBtn.innerHTML = "&times;";
          delBtn.title = "Remove File";
          delBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            var removeId = item.id;
            var removeIdx = state.mediaFiles.findIndex(function (m) { return m.id === removeId; });
            if (removeIdx !== -1) state.mediaFiles.splice(removeIdx, 1);
            deleteFileFromDB(removeId);
            renderMediaGrid();
            saveDraft();
      renderPortalStatusUI();
          });
          thumb.appendChild(delBtn);

          // Grip icon
          var gripIcon = document.createElement("div");
          gripIcon.className = "mvt-media-grip-icon";
          gripIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg>';
          thumb.appendChild(gripIcon);

          // Reorder arrows (◀ ▶) for mobile & click accessibility
          var reorderNav = document.createElement("div");
          reorderNav.className = "mvt-media-reorder-nav";

          var leftBtn = document.createElement("button");
          leftBtn.type = "button";
          leftBtn.className = "mvt-media-move-btn";
          leftBtn.title = "Move Earlier (#" + idx + ")";
          leftBtn.innerHTML = "◀";
          leftBtn.disabled = idx === 0;
          leftBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            if (idx > 0) {
              var temp = state.mediaFiles[idx];
              state.mediaFiles[idx] = state.mediaFiles[idx - 1];
              state.mediaFiles[idx - 1] = temp;
              renderMediaGrid();
              saveDraft();
      renderPortalStatusUI();
            }
          });

          var rightBtn = document.createElement("button");
          rightBtn.type = "button";
          rightBtn.className = "mvt-media-move-btn";
          rightBtn.title = "Move Later (#" + (idx + 2) + ")";
          rightBtn.innerHTML = "▶";
          rightBtn.disabled = idx === state.mediaFiles.length - 1;
          rightBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            if (idx < state.mediaFiles.length - 1) {
              var temp = state.mediaFiles[idx];
              state.mediaFiles[idx] = state.mediaFiles[idx + 1];
              state.mediaFiles[idx + 1] = temp;
              renderMediaGrid();
              saveDraft();
      renderPortalStatusUI();
            }
          });

          reorderNav.appendChild(leftBtn);
          reorderNav.appendChild(rightBtn);
          thumb.appendChild(reorderNav);
        }

        // Drag and Drop Event Listeners
        thumb.addEventListener("dragstart", function (e) {
          draggedMediaIndex = idx;
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(idx));
          }
          thumb.classList.add("is-dragging");
        });

        thumb.addEventListener("dragover", function (e) {
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "move";
          }
          if (draggedMediaIndex !== null && draggedMediaIndex !== idx) {
            thumb.classList.add("is-drag-over");
          }
        });

        thumb.addEventListener("dragleave", function () {
          thumb.classList.remove("is-drag-over");
        });

        thumb.addEventListener("drop", function (e) {
          e.preventDefault();
          e.stopPropagation();
          thumb.classList.remove("is-drag-over");
          var fromIdx = draggedMediaIndex;
          if (fromIdx === null && e.dataTransfer) {
            var rawIdx = e.dataTransfer.getData("text/plain");
            if (rawIdx !== "") fromIdx = parseInt(rawIdx, 10);
          }
          if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== idx && fromIdx >= 0 && fromIdx < state.mediaFiles.length) {
            var moved = state.mediaFiles.splice(fromIdx, 1)[0];
            state.mediaFiles.splice(idx, 0, moved);
            draggedMediaIndex = null;
            renderMediaGrid();
            saveDraft();
      renderPortalStatusUI();
          }
        });

        thumb.addEventListener("dragend", function () {
          draggedMediaIndex = null;
          if (mediaGrid) {
            mediaGrid.querySelectorAll(".mvt-media-thumb").forEach(function (el) {
              el.classList.remove("is-dragging", "is-drag-over");
            });
          }
        });

        // Click to preview in lightbox
        thumb.addEventListener("click", function (e) {
          if (e.target.closest(".mvt-media-delete-btn") || e.target.closest(".mvt-media-reorder-nav")) {
            return;
          }
          openPreviewModal(item);
        });

        mediaGrid.appendChild(thumb);
      });
    }

    if (mediaInput) {
      mediaInput.addEventListener("change", function (e) {
        if (e.target.files && e.target.files.length > 0) {
          handleMediaFiles(e.target.files);
        }
      });
    }

    // Media Dropzone — Drag & Drop
    if (mediaDropzone) {
      mediaDropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        mediaDropzone.classList.add("is-dragover");
      });
      mediaDropzone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        mediaDropzone.classList.remove("is-dragover");
      });
      mediaDropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        mediaDropzone.classList.remove("is-dragover");
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
          handleMediaFiles(files);
        }
      });
    }

    function openPreviewModal(item) {
      if (!previewModal) return;
      if (previewTitle) previewTitle.textContent = item.name || "Media Preview";

      if (item.type === "video") {
        if (previewImg) previewImg.setAttribute("hidden", "hidden");
        if (previewVideo) {
          previewVideo.src = item.localThumbUrl;
          previewVideo.removeAttribute("hidden");
        }
      } else {
        if (previewVideo) {
          previewVideo.pause();
          previewVideo.setAttribute("hidden", "hidden");
        }
        if (previewImg) {
          previewImg.src = item.localThumbUrl;
          previewImg.removeAttribute("hidden");
        }
      }
      previewModal.removeAttribute("hidden");
    }

    if (previewCloseBtn) {
      previewCloseBtn.addEventListener("click", function () {
        if (previewVideo) previewVideo.pause();
        if (previewModal) previewModal.setAttribute("hidden", "hidden");
      });
    }

    // Step 3: Inputs & Email lock
    if (emailInput) {
      emailInput.addEventListener("input", function (e) {
        state.customerEmail = e.target.value;
        var isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value);
        if (lockBox) lockBox.classList.toggle("is-unlocked", isValid);
        if (lockShackle) {
          lockShackle.setAttribute("d", isValid ? "M7 11V7a5 5 0 0 1 9.9-2" : "M7 11V7a5 5 0 0 1 10 0v4");
        }
        saveDraft();
      renderPortalStatusUI();
      });
    }

    if (notesInput) {
      notesInput.addEventListener("input", function (e) {
        state.orderNotes = e.target.value;
        saveDraft();
      renderPortalStatusUI();
      });
    }

    if (rushCheckbox) {
      rushCheckbox.addEventListener("change", function (e) {
        state.rushOrder = e.target.checked;
        saveDraft();
      renderPortalStatusUI();
      });
    }

    if (agreeCheckbox) {
      agreeCheckbox.addEventListener("change", function (e) {
        state.agreeTerms = e.target.checked;
        if (checkoutBtn) checkoutBtn.disabled = !state.agreeTerms;
      });
    }

    if (packagesGrid) {
      packagesGrid.addEventListener("click", function (e) {
        var card = e.target.closest(".mvt-package-card");
        if (!card) return;
        packagesGrid.querySelectorAll(".mvt-package-card").forEach(function (c) {
          c.classList.remove("is-selected");
        });
        card.classList.add("is-selected");
        state.selectedPackage = card.dataset.packageId || "video_standard";
        saveDraft();
      renderPortalStatusUI();
      });
    }

    // Video Format Selection Event Wiring
    function updateFormatSelectionUI(format) {
      state.videoFormat = format || "9:16";
      formatCards.forEach(function (c) {
        var isThis = c.getAttribute("data-mvt-format") === state.videoFormat;
        c.classList.toggle("is-selected", isThis);
        c.setAttribute("aria-pressed", isThis ? "true" : "false");
      });
      saveDraft();
      renderPortalStatusUI();
    }

    formatCards.forEach(function (card) {
      card.addEventListener("click", function () {
        var fmt = card.getAttribute("data-mvt-format");
        if (fmt) {
          updateFormatSelectionUI(fmt);
        }
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          var fmt = card.getAttribute("data-mvt-format");
          if (fmt) updateFormatSelectionUI(fmt);
        }
      });
    });

    // Navigation Buttons Event Wiring
    wrapper.querySelectorAll("[data-mvt-next]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        var targetStep = parseInt(btn.getAttribute("data-mvt-next"), 10);
        var isPortalUser = Boolean(state.token || state.linkedOrderNumber || state.bypassPayment);
        if (isPortalUser && targetStep > 2) {
          return;
        }
        if (state.currentStep === 1) {
          if (!state.audioFile) {
            showToast({ variant: "warning", title: "Audio Required", message: "Please upload an audio track to proceed." });
            return;
          }
        } else if (state.currentStep === 2) {
          if (!state.videoFormat) {
            showToast({ variant: "warning", title: "Format Required", message: "Please choose your video format (9:16 or 16:9) to proceed." });
            return;
          }
          if (state.mediaFiles.length === 0) {
            showToast({ variant: "warning", title: "Media Required", message: "Please upload at least 1 photo or video clip." });
            return;
          }
        }
        goToStep(targetStep);
      });
    });

    wrapper.querySelectorAll("[data-mvt-prev]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        var targetStep = parseInt(btn.getAttribute("data-mvt-prev"), 10);
        goToStep(targetStep);
      });
    });

    // Helper for XMLHttpRequest upload with progress event
    function uploadWithXHR(url, method, headers, body, onProgress) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        if (headers) {
          Object.keys(headers).forEach(function (k) {
            xhr.setRequestHeader(k, headers[k]);
          });
        }
        if (xhr.upload && typeof onProgress === "function") {
          xhr.upload.onprogress = function (e) {
            if (e.lengthComputable && e.total > 0) {
              onProgress(e.loaded, e.total);
            }
          };
        }
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var resJson = JSON.parse(xhr.responseText);
              resolve(resJson);
            } catch (err) {
              resolve({ success: true, text: xhr.responseText });
            }
          } else {
            var errMsg = "Upload failed (Status " + xhr.status + ")";
            try {
              var errJson = JSON.parse(xhr.responseText);
              if (errJson && errJson.error) errMsg = errJson.error;
            } catch (e) {}
            reject(new Error(errMsg));
          }
        };
        xhr.onerror = function () {
          reject(new Error("Network connection error. Retrying upload..."));
        };
        xhr.ontimeout = function () {
          reject(new Error("Upload timed out. Please try again."));
        };
        xhr.timeout = 300000; // 5 minutes max per file
        xhr.send(body);
      });
    }

    // Single File Upload Helper: Presigned S3 Direct Upload -> Server Fallback -> Auto-Retry
    async function uploadSingleFile(fileObj, fileType, orderId, onProgress) {
      if (fileObj.key && fileObj.url) {
        if (typeof onProgress === "function") onProgress(fileObj.size || 1, fileObj.size || 1);
        return {
          key: fileObj.key,
          url: fileObj.url,
          name: fileObj.name || "file",
          size: fileObj.size || 0,
          type: fileObj.type || fileType,
        };
      }

      var file = fileObj.file;
      if (!file) {
        throw new Error("File data is missing for " + (fileObj.name || "item"));
      }

      var currentOrderId = orderId || state.videoId || "";
      var maxRetries = 2;
      var lastError = null;

      for (var attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // 1. Preferred: S3 Direct Presigned Upload (Bypasses server/proxy buffer limits, fastest & smoothest)
          var presignUrl = (backendUrl || "") + "/api/video-tool/upload-url";
          try {
            var presignRes = await fetch(presignUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filename: file.name,
                contentType: file.type || "application/octet-stream",
                fileType: fileType,
                orderId: currentOrderId,
              }),
            });

            if (presignRes.ok) {
              var presignData = await presignRes.json();
              if (presignData && presignData.success && presignData.uploadUrl) {
                await uploadWithXHR(
                  presignData.uploadUrl,
                  "PUT",
                  { "Content-Type": file.type || "application/octet-stream" },
                  file,
                  onProgress
                );
                fileObj.key = presignData.key;
                fileObj.url = presignData.url;
                return {
                  key: presignData.key,
                  url: presignData.url,
                  name: file.name,
                  size: file.size,
                  type: fileType,
                };
              }
            }
          } catch (presignErr) {
            console.warn("[Direct S3 upload warning, trying server route]:", presignErr);
          }

          // 2. Fallback: Upload via backend server route (/api/video-tool/upload-file) with progress
          var uploadEndpoint = (backendUrl || "") + "/api/video-tool/upload-file";
          var formData = new FormData();
          formData.append("file", file, file.name);
          formData.append("fileType", fileType);
          if (currentOrderId) formData.append("orderId", currentOrderId);

          var serverData = await uploadWithXHR(uploadEndpoint, "POST", null, formData, onProgress);
          if (serverData && serverData.success) {
            fileObj.key = serverData.key;
            fileObj.url = serverData.url;
            return {
              key: serverData.key,
              url: serverData.url,
              name: file.name,
              size: file.size,
              type: fileType,
            };
          }
          throw new Error((serverData && serverData.error) || ("Failed to upload " + file.name));
        } catch (err) {
          lastError = err;
          console.warn("[Upload Attempt " + attempt + " Failed for " + file.name + "]:", err);
          if (attempt < maxRetries) {
            await new Promise(function (r) { setTimeout(r, 1200); });
          }
        }
      }

      throw lastError || new Error("Failed to upload " + file.name);
    }

    // Check if cart already has music video orders
    async function checkExistingCartItems() {
      try {
        var res = await fetch("/cart.js");
        if (!res.ok) return [];
        var cart = await res.json();
        if (!cart || !Array.isArray(cart.items)) return [];
        return cart.items.filter(function (item) {
          var props = item.properties || {};
          return (
            props._Order_Type === "Music Video" ||
            !!props._Video_ID ||
            item.product_id === parseInt(productId, 10) ||
            item.variant_id === parseInt(defaultVariantId, 10) ||
            (rushVariantId && item.variant_id === parseInt(rushVariantId, 10))
          );
        });
      } catch (e) {
        return [];
      }
    }

    var pendingCheckoutOpts = null;

    // Step 3 Checkout Submission
    async function handleCheckout() {
      if (!state.audioFile) {
        showToast({ variant: "warning", title: "Missing Audio", message: "Please go back to Step 1 and upload an audio file." });
        goToStep(1);
        return;
      }
      if (!state.videoFormat) {
        showToast({ variant: "warning", title: "Missing Format", message: "Please go back to Step 2 and select a video format." });
        goToStep(2);
        return;
      }
      if (state.mediaFiles.length === 0) {
        showToast({ variant: "warning", title: "Missing Media", message: "Please go back to Step 2 and upload your photos or videos." });
        goToStep(2);
        return;
      }

      var emailVal = (emailInput && emailInput.value ? emailInput.value : state.customerEmail).trim();
      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        if (!state.token && !state.bypassPayment) {
          showToast({ variant: "warning", title: "Email Required", message: "Please enter a valid email address." });
          if (emailInput) emailInput.focus();
          return;
        }
      }

      if (agreeCheckbox && !agreeCheckbox.checked) {
        showToast({ variant: "warning", title: "Agreement Required", message: "Please accept the Terms & Conditions to proceed." });
        return;
      }

      // Check if items already exist in cart
      var existingItems = await checkExistingCartItems();
      if (existingItems.length > 0 && cartModal) {
        pendingCheckoutOpts = { existingItems: existingItems };
        cartModal.removeAttribute("hidden");
        return;
      }

      await executeCheckout({ mode: "normal" });
    }

    async function executeCheckout(checkoutOpts) {
      checkoutOpts = checkoutOpts || {};
      var emailVal = (emailInput && emailInput.value ? emailInput.value : state.customerEmail).trim();

      // Guard: re-validate email before uploading (edge case if DOM element is missing)
      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        if (!state.token && !state.bypassPayment) {
          showToast({ variant: "warning", title: "Email Required", message: "Please enter a valid email address to proceed." });
          if (emailInput) emailInput.focus();
          return;
        }
      }

      var prevBtns = wrapper.querySelectorAll("[data-mvt-prev]");
      prevBtns.forEach(function (btn) {
        btn.disabled = true;
        btn.classList.add("disabled");
        btn.style.pointerEvents = "none";
        btn.style.opacity = "0.5";
      });

      if (checkoutBtn) {
        checkoutBtn.disabled = true;
        checkoutBtn.classList.add("disabled");
        checkoutBtn.style.pointerEvents = "none";
        checkoutBtn.style.opacity = "0.7";
        var txt = checkoutBtn.querySelector(".mvt-btn-checkout-text");
        if (txt) txt.textContent = "Uploading files...";
      }

      if (portalSubmitBtn) {
        portalSubmitBtn.disabled = true;
        portalSubmitBtn.classList.add("disabled");
        portalSubmitBtn.style.pointerEvents = "none";
        portalSubmitBtn.style.opacity = "0.7";
        if (portalSubmitText) portalSubmitText.textContent = "Uploading files...";
      }

      if (progressCard) progressCard.removeAttribute("hidden");
      updateProgress(5, "Preparing your media package...");

      try {
        state.videoId = state.videoId || ("vid_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 6));

        // Calculate total payload size to drive smooth byte-level progress bar (0% - 85%)
        var totalBytes = (state.audioFile && state.audioFile.size ? state.audioFile.size : 1024 * 1024);
        state.mediaFiles.forEach(function (m) {
          totalBytes += (m.size || (m.file && m.file.size) || 1024 * 1024);
        });

        var uploadedBytesMap = {};
        function updateByteProgress(fileId, loadedBytes, statusMsg) {
          uploadedBytesMap[fileId] = loadedBytes;
          var sumUploaded = 0;
          Object.keys(uploadedBytesMap).forEach(function (k) {
            sumUploaded += (uploadedBytesMap[k] || 0);
          });
          var ratio = Math.min(sumUploaded / totalBytes, 1);
          var currentPct = Math.min(85, Math.round(5 + ratio * 80));
          updateProgress(currentPct, statusMsg);
        }

        // 1. Upload Audio File into video-tool/{videoId}/audio/...
        updateProgress(5, "Uploading audio track: " + state.audioFile.name + "...");
        var uploadedAudio = await uploadSingleFile(
          state.audioFile,
          "audio",
          state.videoId,
          function (loaded) {
            updateByteProgress("audio", loaded, "Uploading audio track: " + state.audioFile.name + " (" + (loaded / (1024 * 1024)).toFixed(1) + "MB)...");
          }
        );
        uploadedBytesMap["audio"] = (state.audioFile.size || 1);
        updateProgress(Math.min(85, Math.round(5 + ((state.audioFile.size || 1) / totalBytes) * 80)), "Audio track uploaded successfully!");

        // 2. Upload Media Files (images -> image/, videos -> video/)
        var uploadedMediaFiles = [];
        var totalMedia = state.mediaFiles.length;
        for (var mIdx = 0; mIdx < totalMedia; mIdx++) {
          var mItem = state.mediaFiles[mIdx];
          var mType = mItem.type === "video" ? "video" : "image";
          var fileLabel = "Uploading file " + (mIdx + 1) + " of " + totalMedia + ": " + mItem.name;

          var uploadedItem = await uploadSingleFile(
            mItem,
            mType,
            state.videoId,
            function (loaded) {
              updateByteProgress("media_" + mItem.id, loaded, fileLabel + " (" + (loaded / (1024 * 1024)).toFixed(1) + "MB)...");
            }
          );
          uploadedBytesMap["media_" + mItem.id] = (mItem.size || (mItem.file && mItem.file.size) || 1);
          uploadedItem.order = mIdx + 1;
          uploadedItem.displayOrder = mIdx + 1;
          uploadedMediaFiles.push(uploadedItem);
        }

        updateProgress(88, "Saving order details to cloud...");

        var resolvedNotes = (
          (portalNotesInput && portalNotesInput.value ? portalNotesInput.value : "") ||
          (notesInput && notesInput.value ? notesInput.value : "") ||
          state.orderNotes ||
          ""
        ).trim();

        // 3. Create or Update Video Order record in MongoDB backend
        if (state.token || state.linkedOrderNumber) {
          var portalSubmitUrl = (backendUrl || "") + "/api/video-tool/portal";
          try {
            await fetch(portalSubmitUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: state.token,
                orderNumber: state.linkedOrderNumber,
                customerEmail: emailVal,
                videoFormat: state.videoFormat || "9:16",
                audioFile: uploadedAudio,
                mediaFiles: uploadedMediaFiles,
                orderNotes: resolvedNotes,
              }),
            });
          } catch (pErr) {
            console.warn("[Portal Submit Error]:", pErr);
          }
        }

        var createOrderUrl = (backendUrl || "") + "/api/video-tool/create-order";
        try {
          var orderPayload = {
            videoId: state.videoId,
            shopifyOrderNumber: state.linkedOrderNumber,
            orderNumber: state.linkedOrderNumber,
            isUpsellUpload: Boolean(state.bypassPayment || state.linkedOrderNumber),
            email: emailVal,
            videoFormat: state.videoFormat || "9:16",
            audioFile: uploadedAudio,
            mediaFiles: uploadedMediaFiles,
            selectedPackage: state.selectedPackage,
            packagePrice: 0,
            currency: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "EUR",
            orderNotes: resolvedNotes,
            shopifyProductId: productId || "",
            shopifyVariantId: defaultVariantId || "",
          };

          var orderRes = await fetch(createOrderUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderPayload),
          });
          var orderData = await orderRes.json();
          if (orderData && orderData.videoId) {
            state.videoId = orderData.videoId;
          }
        } catch (orderErr) {
          console.warn("[Video Order Backend Notification Warning]:", orderErr);
        }

        // IF UPSELL UPLOAD: BYPASS PAYMENT AND COMPLETE
        if (state.bypassPayment || state.token || state.linkedOrderNumber) {
          updateProgress(100, "Media files successfully connected to Order #" + state.linkedOrderNumber + "!");
          localStorage.removeItem(STORAGE_KEY);
          await clearDraftFilesFromDB();

          state.canEdit = false;
          state.portalStatus = "consumed";

          var toolCard = wrapper.querySelector(".mvt-card") || wrapper;
          toolCard.innerHTML = 
            '<div style="text-align: center; padding: 48px 24px; max-width: 580px; margin: 0 auto;">' +
              '<div style="width: 76px; height: 76px; line-height: 76px; border-radius: 50%; background: #10B981; color: white; font-size: 38px; margin: 0 auto 24px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3);">✓</div>' +
              '<h2 style="font-size: 26px; font-weight: 800; margin-bottom: 12px; color: #111827;">Upload Complete!</h2>' +
              '<p style="font-size: 15px; color: #4B5563; line-height: 1.6; margin-bottom: 20px;">Your photos, audio, and videos have been successfully attached to <strong>Order #' + state.linkedOrderNumber + '</strong>. Our video editors have received your media and will craft your custom video!</p>' +
              '<div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 14px; border-radius: 12px; font-size: 13px; color: #92400E; margin-bottom: 24px; line-height: 1.5;">🔒 <strong>Portal Locked:</strong> This single-use link is now closed for editing. If you need to make changes or add more files, please contact support to request a new link.</div>' +
              '<a href="/" style="display: inline-block; background: #6366F1; color: white; padding: 13px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);">Back to Homepage</a>' +
            '</div>';
          return;
        }

        // 4. If replacing existing items, remove them first
        if (checkoutOpts.mode === "replace" && Array.isArray(checkoutOpts.removeItems) && checkoutOpts.removeItems.length > 0) {
          updateProgress(86, "Updating cart items...");
          var updates = {};
          checkoutOpts.removeItems.forEach(function (itm) {
            updates[itm.key || itm.id] = 0;
          });
          try {
            await fetch("/cart/update.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ updates: updates }),
            });
          } catch (updateErr) {
            console.warn("[Cart replace update warning]:", updateErr);
          }
        }

        updateProgress(90, "Adding music video to cart...");

        // 5. Resolve Target Variant for Shopify Cart
        var targetCard = wrapper.querySelector('.mvt-package-card[data-package-id="' + state.selectedPackage + '"]') || wrapper.querySelector(".mvt-package-card");
        var selectedVariantId = defaultVariantId;

        if (state.rushOrder && targetCard && targetCard.getAttribute("data-rush-variant-id")) {
          selectedVariantId = targetCard.getAttribute("data-rush-variant-id");
        } else if (state.rushOrder && rushVariantId) {
          selectedVariantId = rushVariantId;
        } else if (targetCard && targetCard.getAttribute("data-variant-id")) {
          selectedVariantId = targetCard.getAttribute("data-variant-id");
        }

        var formatLabel = state.videoFormat === "16:9" ? "16:9 (Landscape)" : "9:16 (Instagram / Vertical)";
        var mediaSequenceSummary = state.mediaFiles.map(function (m, i) {
          return "#" + (i + 1) + " " + (m.type === "video" ? "Video" : "Photo");
        }).join(" ➔ ");

        var lineItemProperties = {
          "_Order_Type": "Music Video",
          "_Video_ID": state.videoId,
          "_Video_Format": formatLabel,
          "_Aspect_Ratio": state.videoFormat || "9:16",
          "_Audio_Filename": state.audioFile.name,
          "_Audio_S3_Key": uploadedAudio.key || "",
          "_Customer_Email": emailVal,
          "_Media_Count": state.mediaFiles.length + " files",
          "_Media_Sequence": mediaSequenceSummary || "Standard",
          "_Notes": (notesInput ? notesInput.value : state.orderNotes).trim() || "None",
          "_Rush_Delivery": state.rushOrder ? "Yes (Under 2 Hours)" : "Standard (24-48 Hours)",
        };

        var cartFormData = {
          items: [
            {
              id: parseInt(selectedVariantId, 10) || defaultVariantId,
              quantity: 1,
              properties: lineItemProperties,
            },
          ],
        };

        var cartRes = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cartFormData),
        });

        if (!cartRes.ok) {
          throw new Error("Failed to add video order to cart");
        }

        // Clean draft storage upon successful checkout transition
        localStorage.removeItem(STORAGE_KEY);
        await clearDraftFilesFromDB();
        state.videoId = "";

        updateProgress(100, "Redirecting to checkout...");
        window.location.href = "/checkout";
      } catch (error) {
        console.error("[Music Video Tool Checkout Error]:", error);
        showToast({ variant: "error", title: "Checkout Error", message: error.message || "Failed to upload files. Please try again." });
        if (progressCard) progressCard.setAttribute("hidden", "hidden");
        
        var prevBtns = wrapper.querySelectorAll("[data-mvt-prev]");
        prevBtns.forEach(function (btn) {
          btn.disabled = false;
          btn.classList.remove("disabled");
          btn.style.pointerEvents = "auto";
          btn.style.opacity = "1";
        });

        if (checkoutBtn) {
          checkoutBtn.disabled = false;
          checkoutBtn.classList.remove("disabled");
          checkoutBtn.style.pointerEvents = "auto";
          checkoutBtn.style.opacity = "1";
          var textSpan = checkoutBtn.querySelector(".mvt-btn-checkout-text");
          if (textSpan) textSpan.textContent = "Proceed to Checkout";
        }

        if (portalSubmitBtn) {
          portalSubmitBtn.disabled = false;
          portalSubmitBtn.classList.remove("disabled");
          portalSubmitBtn.style.pointerEvents = "auto";
          portalSubmitBtn.style.opacity = "1";
          if (portalSubmitText) portalSubmitText.textContent = "Submit Video Media Files ➜";
        }
        if (portalUploadProgress) portalUploadProgress.setAttribute("hidden", "hidden");
      }
    }

    if (cartKeepBtn) {
      cartKeepBtn.addEventListener("click", function () {
        if (cartModal) cartModal.setAttribute("hidden", "hidden");
        executeCheckout({ mode: "keep_both" });
      });
    }

    if (cartReplaceBtn) {
      cartReplaceBtn.addEventListener("click", function () {
        if (cartModal) cartModal.setAttribute("hidden", "hidden");
        var toRemove = (pendingCheckoutOpts && pendingCheckoutOpts.existingItems) || [];
        executeCheckout({ mode: "replace", removeItems: toRemove });
      });
    }

    if (cartViewBtn) {
      cartViewBtn.addEventListener("click", function () {
        window.location.href = "/cart";
      });
    }

    if (cartModalClose) {
      cartModalClose.addEventListener("click", function () {
        if (cartModal) cartModal.setAttribute("hidden", "hidden");
      });
    }

    function updateProgress(pct, status) {
      var cleanPct = Math.max(0, Math.min(100, Math.round(pct)));
      if (progressPct) progressPct.textContent = cleanPct + "%";
      if (progressBar) {
        progressBar.style.setProperty("width", cleanPct + "%", "important");
        progressBar.style.width = cleanPct + "%";
        progressBar.setAttribute(
          "style",
          "width: " + cleanPct + "% !important; height: 100% !important; min-height: 8px !important; display: block !important; background: #ff5b00 !important; border-radius: 9999px !important; border: none !important; box-shadow: none !important; transition: width 0.25s ease-out !important;"
        );
      }
      if (progressStatus) progressStatus.textContent = status;

      // Also update Portal progress bar on Step 2
      if (portalUploadProgress) portalUploadProgress.removeAttribute("hidden");
      if (portalProgressPct) portalProgressPct.textContent = cleanPct + "%";
      if (portalProgressBar) portalProgressBar.style.width = cleanPct + "%";
      if (portalProgressStatus) portalProgressStatus.textContent = status;
    }

    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", handleCheckout);
    }

    if (portalSubmitBtn) {
      portalSubmitBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (portalNotesInput) {
          state.orderNotes = portalNotesInput.value.trim();
        }
        handleCheckout();
      });
    }

    if (portalNotesInput) {
      portalNotesInput.addEventListener("input", function (e) {
        state.orderNotes = e.target.value;
        saveDraft();
      });
    }

    // Save/Load Draft
    function saveDraft() {
      try {
        var draft = {
          currentStep: state.currentStep,
          selectedPackage: state.selectedPackage,
          videoFormat: state.videoFormat,
          rushOrder: state.rushOrder,
          customerEmail: emailInput ? emailInput.value : state.customerEmail,
          orderNotes: notesInput ? notesInput.value : state.orderNotes,
          videoId: state.videoId,
          hasAudio: !!state.audioFile,
          audioName: state.audioFile ? state.audioFile.name : "",
          mediaCount: state.mediaFiles.length,
          mediaOrder: state.mediaFiles.map(function (m) { return m.id; }),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      } catch (e) {}
    }

    async function checkSavedDraft() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        var dbFiles = await getAllDraftFilesFromDB();

        if (!raw && dbFiles.length === 0) return;

        var draft = raw ? JSON.parse(raw) : null;
        var hasSavedContent = (draft && (draft.hasAudio || draft.mediaCount > 0 || draft.videoFormat)) || dbFiles.length > 0;

        if (hasSavedContent && refreshModal) {
          refreshModal.removeAttribute("hidden");
        }
      } catch (e) {}
    }

    if (refreshKeepBtn) {
      refreshKeepBtn.addEventListener("click", async function () {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          var dbFiles = await getAllDraftFilesFromDB();

          for (var i = 0; i < dbFiles.length; i++) {
            var item = dbFiles[i];
            if (item.id === "audio_track" && item.file) {
              handleAudioFile(item.file, true);
            } else if (item.id.startsWith("media_") && item.file) {
              handleMediaFiles([item.file], true);
            }
          }

          if (raw) {
            var draft = JSON.parse(raw);
            if (draft.mediaOrder && Array.isArray(draft.mediaOrder) && state.mediaFiles.length > 1) {
              state.mediaFiles.sort(function (a, b) {
                var idxA = draft.mediaOrder.indexOf(a.id);
                var idxB = draft.mediaOrder.indexOf(b.id);
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
              });
              renderMediaGrid();
            }
            if (draft.videoFormat) {
              updateFormatSelectionUI(draft.videoFormat);
            }
            if (draft.customerEmail && emailInput) {
              emailInput.value = draft.customerEmail;
              emailInput.dispatchEvent(new Event("input"));
            }
            if (draft.orderNotes && notesInput) notesInput.value = draft.orderNotes;
            if (draft.videoId) state.videoId = draft.videoId;
            if (draft.currentStep && draft.currentStep > 1) {
              goToStep(draft.currentStep);
            }
          }
        } catch (e) {
          console.error("Error restoring saved draft:", e);
        }
        if (refreshModal) refreshModal.setAttribute("hidden", "hidden");
      });
    }

    if (refreshNewBtn) {
      refreshNewBtn.addEventListener("click", async function () {
        localStorage.removeItem(STORAGE_KEY);
        await clearDraftFilesFromDB();
        state.audioFile = null;
        state.mediaFiles = [];
        updateFormatSelectionUI("9:16");
        if (audioPlayer) audioPlayer.pause();
        if (audioInput) audioInput.value = "";
        if (mediaInput) mediaInput.value = "";
        if (audioDropzone) audioDropzone.removeAttribute("hidden");
        if (audioCard) audioCard.setAttribute("hidden", "hidden");
        if (mediaSection) mediaSection.setAttribute("hidden", "hidden");
        if (mediaGrid) mediaGrid.innerHTML = "";
        if (emailInput) {
          emailInput.value = "";
          emailInput.dispatchEvent(new Event("input"));
        }
        if (notesInput) notesInput.value = "";
        if (refreshModal) refreshModal.setAttribute("hidden", "hidden");
        goToStep(1);
      });
    }

    if (refreshModalClose) {
      refreshModalClose.addEventListener("click", function () {
        if (refreshModal) refreshModal.setAttribute("hidden", "hidden");
      });
    }

    // Init
    fetchDashboardOptions();
    fetchPortalData();
    checkSavedDraft();
  }

  // Auto initialize on DOM ready or Shopify theme section load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll(".mvt-wrapper").forEach(initMusicVideoTool);
    });
  } else {
    document.querySelectorAll(".mvt-wrapper").forEach(initMusicVideoTool);
  }

  document.addEventListener("shopify:section:load", function (e) {
    var wrapper = e.target.querySelector(".mvt-wrapper");
    if (wrapper) initMusicVideoTool(wrapper);
  });
})();

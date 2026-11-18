(function () {
  "use strict";

  var LYRICS_FAILED_STATUSES = ["CREATE_TASK_FAILED", "GENERATE_LYRICS_FAILED", "GENERATE_LYRIC_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"];
  var MUSIC_FAILED_STATUSES = ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"];
  var MUSIC_SUCCESS_STATUSES = ["FIRST_SUCCESS", "SUCCESS"];
  var TOTAL_STEPS = 8;

  function initSection(root) {
    var backendUrl = (root.getAttribute("data-backend-url") || "").replace(/\/$/, "");
    var productId = root.getAttribute("data-product-id") || "";
    var variantId = root.getAttribute("data-variant-id") || "";
    var productHandle = root.getAttribute("data-product-handle") || "";
    var sectionId = root.getAttribute("data-section-id") || "";

    function apiUrl(path) {
      return backendUrl + path;
    }

    // ---- State ----
    var turnstileToken = "";
    var visitorId = "";

    window.onTurnstileSuccess = function (token) {
      turnstileToken = token;
    };

    function showTurnstileWidget() {
      var wrap = root.querySelector("[data-csb-turnstile-wrap]");
      if (wrap) wrap.hidden = false;
    }

    function resetTurnstile() {
      if (window.turnstile && typeof window.turnstile.reset === "function") {
        try {
          window.turnstile.reset();
        } catch (e) {
          console.warn("[Custom Song Builder] Turnstile reset error:", e);
        }
      }
    }

    function initFingerprint() {
      var script = document.createElement("script");
      script.src = "https://openfpcdn.io/fingerprintjs/v4";
      script.async = true;
      script.onload = function () {
        if (window.FingerprintJS) {
          window.FingerprintJS.load().then(function (fp) {
            fp.get().then(function (result) {
              visitorId = result.visitorId;
            });
          });
        }
      };
      document.head.appendChild(script);
    }

    var fetchedClientIp = "";

    function initClientIp() {
      fetch("https://api64.ipify.org?format=json")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.ip) {
            fetchedClientIp = data.ip;
          }
        })
        .catch(function () { /* fallback to server IP */ });
    }

    if (window.requestIdleCallback) {
      requestIdleCallback(function () {
        initFingerprint();
        initClientIp();
      });
    } else {
      setTimeout(function () {
        initFingerprint();
        initClientIp();
      }, 500);
    }

    function detectLanguageFromUrl() {
      var path = (window.location.pathname || "").toLowerCase();
      var host = (window.location.hostname || "").toLowerCase();
      var search = (window.location.search || "").toLowerCase();
      var shopifyLocale = (window.Shopify && window.Shopify.locale ? String(window.Shopify.locale).toLowerCase() : "");
      var htmlLang = (document.documentElement && document.documentElement.lang ? document.documentElement.lang.toLowerCase() : "");

      // 1. Check explicit URL query parameter
      if (search.indexOf("locale=en") !== -1 || search.indexOf("lang=en") !== -1) return "English";
      if (search.indexOf("locale=nl") !== -1 || search.indexOf("lang=nl") !== -1) return "Dutch";
      if (search.indexOf("locale=de") !== -1 || search.indexOf("lang=de") !== -1) return "German";
      if (search.indexOf("locale=fr") !== -1 || search.indexOf("lang=fr") !== -1) return "French";
      if (search.indexOf("locale=es") !== -1 || search.indexOf("lang=es") !== -1) return "Spanish";
      if (search.indexOf("locale=it") !== -1 || search.indexOf("lang=it") !== -1) return "Italian";

      // 2. Check URL path prefixes
      if (path.indexOf("/nl") === 0 || path.indexOf("/nl/") !== -1) return "Dutch";
      if (path.indexOf("/de") === 0 || path.indexOf("/de/") !== -1) return "German";
      if (path.indexOf("/fr") === 0 || path.indexOf("/fr/") !== -1) return "French";
      if (path.indexOf("/es") === 0 || path.indexOf("/es/") !== -1) return "Spanish";
      if (path.indexOf("/it") === 0 || path.indexOf("/it/") !== -1) return "Italian";
      if (path.indexOf("/en") === 0 || path.indexOf("/en/") !== -1) return "English";

      // 3. Check Shopify locale and HTML lang attribute (the most accurate indication of storefront language)
      var activeCode = shopifyLocale || htmlLang;
      if (activeCode) {
        if (activeCode.indexOf("en") === 0) return "English";
        if (activeCode.indexOf("nl") === 0) return "Dutch";
        if (activeCode.indexOf("de") === 0) return "German";
        if (activeCode.indexOf("fr") === 0) return "French";
        if (activeCode.indexOf("es") === 0) return "Spanish";
        if (activeCode.indexOf("it") === 0) return "Italian";
      }

      // 4. Check header localization switcher text if present
      try {
        var switcher = document.querySelector(".localization-form__select, [data-disclosure-locale], .header-localization, .disclosure__button, .header__localization-button");
        if (switcher && switcher.textContent) {
          var switchText = switcher.textContent.trim().toUpperCase();
          if (switchText.indexOf("EN") !== -1) return "English";
          if (switchText.indexOf("NL") !== -1) return "Dutch";
          if (switchText.indexOf("DE") !== -1) return "German";
          if (switchText.indexOf("FR") !== -1) return "French";
          if (switchText.indexOf("ES") !== -1) return "Spanish";
          if (switchText.indexOf("IT") !== -1) return "Italian";
        }
      } catch (e) { /* ignore */ }

      // 5. Fallback based on domain
      if (host.endsWith(".nl")) return "Dutch";
      if (host.endsWith(".de")) return "German";
      if (host.endsWith(".fr")) return "French";
      if (host.endsWith(".es")) return "Spanish";
      if (host.endsWith(".it")) return "Italian";

      return "English";
    }

    function trackKlaviyoLanguage() {
      var lang = detectLanguageFromUrl();
      var path = (window.location.pathname || "").toLowerCase();
      var locale = "en";
      if (path.indexOf("/nl") === 0 || path.indexOf("/nl/") !== -1) locale = "nl";
      else if (path.indexOf("/de") === 0 || path.indexOf("/de/") !== -1) locale = "de";
      else if (path.indexOf("/fr") === 0 || path.indexOf("/fr/") !== -1) locale = "fr";
      else if (path.indexOf("/es") === 0 || path.indexOf("/es/") !== -1) locale = "es";

      try {
        window._klaviyo = window._klaviyo || [];
        if (state.email) {
          window._klaviyo.push(["identify", { "$email": state.email, "$locale": locale, "Language": lang }]);
        }
        window._klaviyo.push(["track", "Customer Language", { language: lang, locale: locale, email: state.email || "" }]);
      } catch (e) {
        console.warn("[Custom Song Builder] Klaviyo tracking error:", e);
      }
    }

    var state = {
      currentStep: 1,
      occasion: "",
      occasionIsOther: false,
      customOccasion: "",
      recipients: [{ name: "", pronunciationMode: "Original", pronunciation: "" }],
      creationMethod: "write_for_us",
      storyText: "",
      lyricsLanguage: detectLanguageFromUrl(),
      language: detectLanguageFromUrl(),
      ownLyrics: "",
      generatedLyrics: "",
      lyrics: "",
      email: "",
      genre: "",
      voice: "",
      mood: "",
      selectedDemo: "",
      selectedPackage: "standard",
      rushOrder: true,
      selectedUpsells: {},
      agreeTerms: false,
      taskId: ""
    };

    var lyricsVariations = [];
    var selectedLyricsIndex = null;
    var lyricsLoading = false;
    var lyricsError = "";

    var isAudioReady = true;
    var backgroundPollingTaskId = null;
    var backgroundPollTimer = null;

    var musicTracks = [];
    var generationProgress = 0;
    var generationError = "";
    var generationErrorIsTimeout = false;
    var isSubmitting = false;

    // ---- Regeneration Trackers ----
    var lastGeneratedLyricsState = null;
    var lastGeneratedMusicState = null;

    var STORAGE_KEY = "csb_wizard_" + (productId || productHandle || "default") + "_" + sectionId;
    var STORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    var pendingLyricsTaskId = null;

    var optionsLoading = true;
    var options = { occasions: [], genres: [], voices: [], moods: [], packages: [] };

    var packageProductMap = {};

    // ---- DOM refs ----
    var $ = function (sel) { return root.querySelector(sel); };
    var $$ = function (sel) { return root.querySelectorAll(sel); };

    var stepLabel = $("[data-csb-step-label]");
    var percentLabel = $("[data-csb-percent-label]");
    var progressFill = $("[data-csb-progress-fill]");
    var progressWrap = $("[data-csb-progress-wrap]");
    var navWrap = $("[data-csb-nav]");
    var backBtn = $("[data-csb-back]");
    var nextBtn = $("[data-csb-next]");
    var checkoutBtn = $("[data-csb-checkout]");
    var checkoutSpinner = $("[data-csb-checkout-spinner]");
    var checkoutLabel = $("[data-csb-checkout-label]");

    function showToast(opts) {
      var navErrorContainer = root.querySelector("[data-csb-nav-error]");
      if (navErrorContainer) {
        navErrorContainer.innerHTML = "";
        navErrorContainer.hidden = false;
        var box = document.createElement("div");
        box.className = "csb-inline-toast csb-inline-toast-" + (opts.variant || "warning");
        box.innerHTML = "<strong>" + (opts.title ? (opts.title + ": ") : "") + "</strong><span>" + (opts.message || "") + "</span>";
        navErrorContainer.appendChild(box);
        if (!opts.preventScroll) {
          try {
            navErrorContainer.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (e) { }
        }
        return;
      }
      var existing = root.querySelector(".csb-toast");
      if (existing) existing.remove();
      var el = document.createElement("div");
      el.className = "csb-toast csb-toast-" + (opts.variant || "info");
      el.style.position = "fixed";
      el.style.bottom = "1.5rem";
      el.style.right = "1.5rem";
      el.style.zIndex = "9999";
      el.style.maxWidth = "320px";
      el.style.padding = "0.875rem 1.125rem";
      el.style.borderRadius = "0.75rem";
      el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      el.style.fontSize = "0.875rem";
      el.style.color = "#fff";
      el.style.background =
        opts.variant === "error" ? "#f04438" :
          opts.variant === "warning" ? "#f79009" :
            opts.variant === "success" ? "#12b76a" : "#475467";
      el.innerHTML = "<strong>" + (opts.title || "") + "</strong><div>" + (opts.message || "") + "</div>";
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 4000);
    }

    function clearToast() {
      var navErrorContainer = root.querySelector("[data-csb-nav-error]");
      if (navErrorContainer) {
        navErrorContainer.innerHTML = "";
        navErrorContainer.hidden = true;
      }
    }

    function saveProgress() {
      try {
        var payload = {
          savedAt: Date.now(),
          state: state,
          lyricsVariations: lyricsVariations,
          selectedLyricsIndex: selectedLyricsIndex,
          musicTracks: musicTracks,
          isAudioReady: isAudioReady,
          backgroundPollingTaskId: backgroundPollingTaskId,
          lyricsLoading: lyricsLoading,
          pendingLyricsTaskId: pendingLyricsTaskId,
          generationProgress: generationProgress,
          lastGeneratedLyricsState: lastGeneratedLyricsState,
          lastGeneratedMusicState: lastGeneratedMusicState
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        console.warn("[Custom Song Builder] Could not save progress", e);
      }
    }

    function loadProgress() {
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || !parsed.savedAt || (Date.now() - parsed.savedAt) > STORAGE_MAX_AGE_MS) {
          window.localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return parsed;
      } catch (e) {
        return null;
      }
    }

    function clearProgress() {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }

    function pollStatus(taskId, type, onProgress, initialProgress) {
      return new Promise(function (resolve, reject) {
        if (!taskId) {
          var noTaskErr = new Error("No taskId returned from API");
          noTaskErr.isTimeout = false;
          reject(noTaskErr);
          return;
        }
        var attempts = 0;
        if (initialProgress && initialProgress > 0 && initialProgress < 92) {
          attempts = Math.max(0, Math.round(-25 * Math.log(1 - initialProgress / 92)));
        }
        var maxAttempts = 120; // 120 * 2s = 4 minutes (prevents customer freezing at 92% for 30 minutes)
        var interval = setInterval(function () {
          attempts++;
          if (onProgress) {
            var targetProgress = Math.min(92, Math.round(92 * (1 - Math.exp(-attempts / 25))));
            onProgress(targetProgress);
          }
          fetch(apiUrl("/api/suno/status?taskId=" + encodeURIComponent(taskId) + "&type=" + type))
            .then(function (res) { return res.json(); })
            .then(function (data) {
              var failedSet = type === "lyrics" ? LYRICS_FAILED_STATUSES : MUSIC_FAILED_STATUSES;
              var successSet = type === "lyrics" ? ["SUCCESS"] : MUSIC_SUCCESS_STATUSES;

              if (successSet.indexOf(data.status) !== -1) {
                clearInterval(interval);
                if (onProgress) onProgress(100);
                resolve(data);
              } else if (data.failed || failedSet.indexOf(data.status) !== -1) {
                clearInterval(interval);
                var explicitErr = new Error(data.errorMessage || data.error || ("Generation " + (data.status || "failed")));
                explicitErr.isTimeout = false;
                reject(explicitErr);
              } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                var timeoutErr = new Error("Generation is taking longer than expected. Please try again in a few minutes.");
                timeoutErr.isTimeout = true;
                reject(timeoutErr);
              }
            })
            .catch(function (err) {
              console.warn("[Custom Song Builder] Status check attempt failed, will retry:", err);
              if (attempts >= maxAttempts) {
                clearInterval(interval);
                var networkErr = new Error("Generation is taking longer than expected. Please try again in a few minutes.");
                networkErr.isTimeout = true;
                reject(networkErr);
              }
            });
        }, 2000);
      });
    }

    // ---- Load dynamic form options ----
    function fetchOptions() {
      fetch(apiUrl("/api/form-options"))
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success && json.data) {
            options = json.data;
            var wrap = $("[data-csb-packages-grid]");
            var existingCards = wrap ? wrap.querySelectorAll(".csb-package-card") : [];
            if (existingCards.length > 0) {
              var validCardIds = [];
              existingCards.forEach(function (c) {
                var cid = c.dataset.packageId || c.dataset.csbPackageCard;
                if (cid) validCardIds.push(cid);
              });
              if (validCardIds.indexOf(state.selectedPackage) === -1) {
                state.selectedPackage = validCardIds[0] || "standard";
              }
            } else if (options.packages && options.packages.length > 0) {
              var hasValidSelection = state.selectedPackage &&
                options.packages.some(function (p) { return p.id === state.selectedPackage; });
              if (!hasValidSelection) {
                state.selectedPackage = options.packages[0].id;
              }
            }

            packageProductMap = {};
            (options.packages || []).forEach(function (pkg) {
              if (pkg.shopifyVariantId) {
                packageProductMap[pkg.id] = {
                  productId: pkg.shopifyProductId || "",
                  variantId: pkg.shopifyVariantId,
                  rushVariantId: pkg.shopifyRushVariantId || ""
                };
              }
            });
          }
        })
        .catch(function (err) { console.error("Failed to load options", err); })
        .finally(function () {
          optionsLoading = false;
          renderOccasions();
          renderRecipients();
          renderStyleGroups();
          renderLanguages();
          renderPackages();
          renderUpsells();
          fetchVariantPrices();
        });
    }

    // ---- Renderers ----
    function isOtherOccasionLabel(val) {
      return typeof val === "string" && val.trim().toLowerCase().indexOf("other") === 0;
    }

    function toggleOtherOccasionField() {
      var otherWrap = $("[data-csb-occasion-other-wrap]");
      if (otherWrap) otherWrap.hidden = !state.occasionIsOther;
    }


    function formatRecipients(arr, includePronunciation) {
      if (!arr || arr.length === 0) return "someone special";
      return arr.map(function (r) {
        var res = r.name || "";
        if (includePronunciation && r.pronunciationMode === "Manual" && r.pronunciation) {
          res += " (pronounced: " + r.pronunciation + ")";
        }
        return res;
      }).filter(Boolean).join(", ");
    }

    function renderRecipients() {
      var wrap = $("[data-csb-recipients-wrap]");
      if (!wrap) return;
      wrap.innerHTML = "";
      state.recipients.forEach(function (rec, idx) {
        var row = document.createElement("div");
        row.className = "csb-recipient-row csb-gap-top";

        var nameDiv = document.createElement("div");
        nameDiv.innerHTML = '<label class="csb-label">Name</label><input type="text" class="csb-input" placeholder="e.g. John" value="' + (rec.name || '').replace(/"/g, '&quot;') + '">';
        var nameInput = nameDiv.querySelector("input");
        nameInput.addEventListener("input", function (e) {
          state.recipients[idx].name = e.target.value;
          saveProgress();
        });
        row.appendChild(nameDiv);

        var modeDiv = document.createElement("div");
        modeDiv.className = "csb-gap-top-sm";
        modeDiv.innerHTML = '<label class="csb-label">How do you pronounce this name?</label><select class="csb-select"><option value="Original">Original</option><option value="Manual">Enter manually</option></select>';
        var select = modeDiv.querySelector("select");
        select.value = rec.pronunciationMode || "Original";
        select.addEventListener("change", function (e) {
          state.recipients[idx].pronunciationMode = e.target.value;
          renderRecipients();
          saveProgress();
        });
        row.appendChild(modeDiv);

        if (rec.pronunciationMode === "Manual") {
          var pronDiv = document.createElement("div");
          pronDiv.className = "csb-gap-top-sm";
          pronDiv.innerHTML = '<input type="text" class="csb-input" placeholder="e.g. J-on" value="' + (rec.pronunciation || '').replace(/"/g, '&quot;') + '">';
          var pronInput = pronDiv.querySelector("input");
          pronInput.addEventListener("input", function (e) {
            state.recipients[idx].pronunciation = e.target.value;
            saveProgress();
          });
          row.appendChild(pronDiv);
        }

        if (state.recipients.length > 1) {
          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "csb-btn-outline csb-gap-top-sm";
          removeBtn.textContent = "Remove";
          removeBtn.addEventListener("click", function () {
            state.recipients.splice(idx, 1);
            renderRecipients();
            saveProgress();
          });
          row.appendChild(removeBtn);
        }

        wrap.appendChild(row);
      });
    }

    function renderOccasions() {
      var wrap = $("[data-csb-occasions]");
      if (!wrap) return;
      if (optionsLoading) {
        wrap.innerHTML = '<div class="csb-loading-text">Loading occasions...</div>';
        return;
      }
      wrap.innerHTML = "";
      (options.occasions || []).forEach(function (occ) {
        var isOtherPill = isOtherOccasionLabel(occ);
        var isSelected = isOtherPill ? state.occasionIsOther : (!state.occasionIsOther && state.occasion === occ);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "csb-pill" + (isSelected ? " is-selected" : "");
        btn.textContent = occ;
        btn.addEventListener("click", function () {
          if (isOtherPill) {
            state.occasionIsOther = true;
            state.occasion = state.customOccasion || "";
            renderOccasions();
            syncFieldInputs();
            // Give the newly-shown text field focus so the customer can type right away.
            var otherInput = root.querySelector('[data-csb-field="customOccasion"]');
            if (otherInput) otherInput.focus();
          } else {
            state.occasionIsOther = false;
            state.customOccasion = "";
            state.occasion = occ;
            renderOccasions();
          }
          saveProgress();
        });
        wrap.appendChild(btn);
      });
      toggleOtherOccasionField();
    }

    var step4ValidationAttempted = false;

    function getStyleValidationNotice(field) {
      if (field === "genre") {
        return (root && root.getAttribute("data-error-genre")) || "Please select a genre to continue.";
      }
      if (field === "voice") {
        return (root && root.getAttribute("data-error-voice")) || "Please select a voice to continue.";
      }
      if (field === "mood") {
        return (root && root.getAttribute("data-error-mood")) || "Please select a mood to continue.";
      }
      return "Please make a selection to continue.";
    }

    function renderStyleGroups() {
      var wrap = $("[data-csb-style-groups]");
      if (!wrap) return;
      if (optionsLoading) {
        wrap.innerHTML = '<div class="csb-loading-text csb-center">Loading style options...</div>';
        return;
      }
      var groups = [
        { label: "Genre", field: "genre", list: options.genres || [] },
        { label: "Voice", field: "voice", list: options.voices || [] },
        { label: "Mood", field: "mood", list: options.moods || [] }
      ];
      wrap.innerHTML = "";
      groups.forEach(function (g) {
        var isCompleted = !!state[g.field];
        var hasError = step4ValidationAttempted && !isCompleted;

        var section = document.createElement("div");
        section.className = "csb-style-group" + (isCompleted ? " is-completed" : "") + (hasError ? " has-error" : "");
        section.setAttribute("data-style-field", g.field);

        var h = document.createElement("h3");
        h.className = "csb-style-group-label" + (isCompleted ? " is-completed" : "") + (hasError ? " has-error" : "");

        var titleSpan = document.createElement("span");
        titleSpan.textContent = g.label;
        h.appendChild(titleSpan);

        if (isCompleted) {
          var checkIcon = document.createElement("span");
          checkIcon.className = "csb-style-check-icon";
          checkIcon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"></path></svg>';
          h.appendChild(checkIcon);
        }

        section.appendChild(h);

        if (hasError) {
          var errorMsg = document.createElement("div");
          errorMsg.className = "csb-style-error-msg";
          errorMsg.innerHTML = '<span class="csb-style-error-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></span><span>' + getStyleValidationNotice(g.field) + '</span>';
          section.appendChild(errorMsg);
        }

        var pillRow = document.createElement("div");
        pillRow.className = "csb-pill-group";

        g.list.forEach(function (opt) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "csb-pill" + (state[g.field] === opt ? " is-selected" : "");
          btn.textContent = opt;
          btn.addEventListener("click", function () {
            state[g.field] = opt;
            renderStyleGroups();
            saveProgress();

            if (state.genre && state.voice && state.mood) {
              step4ValidationAttempted = false;
              clearToast();
              setTimeout(function () {
                var targetBtn = nextBtn || root.querySelector("[data-csb-next]");
                if (targetBtn) {
                  targetBtn.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }, 150);
            }
          });
          pillRow.appendChild(btn);
        });

        section.appendChild(pillRow);
        wrap.appendChild(section);
      });
    }

    function renderLanguages() {
      if (!state.lyricsLanguage) {
        state.lyricsLanguage = detectLanguageFromUrl() || "Dutch";
      }
      var select = root.querySelector('[data-csb-field="lyricsLanguage"]');
      if (select && select.value !== state.lyricsLanguage) {
        select.value = state.lyricsLanguage;
      }
    }

    function getCompareAtPrice(pkg) {
      return pkg.compareAtPrice || pkg.originalPrice || pkg.compare_at_price || "";
    }


    var variantPriceCache = {};

    function getShopifyRootPath() {
      return "/";
    }

    function getEmbeddedVariantPrices() {
      var jsonEl = root.querySelector("[data-csb-variant-prices-json]") || document.querySelector("[data-csb-variant-prices-json]");
      if (!jsonEl) return { variants: {}, product_variants: [], rush_variant: {} };
      try {
        var parsed = JSON.parse(jsonEl.textContent || "{}");
        if (parsed.variants) return parsed;
        return { variants: parsed, product_variants: [], rush_variant: {} };
      } catch (e) {
        return { variants: {}, product_variants: [], rush_variant: {} };
      }
    }

    function formatShopifyMoney(priceVal, isPresentment) {
      if (priceVal === null || priceVal === undefined || priceVal === "") return "";
      var str = String(priceVal).trim();

      var num = parseFloat(str.replace(/[^\d.,]/g, "").replace(",", "."));
      if (isNaN(num)) return str;

      // If price is passed in cents (e.g. 5995 cents from Shopify API)
      if (num >= 500 && num === Math.round(num)) {
        num = num / 100;
      }

      var activeCurr = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "";
      var rate = (window.Shopify && window.Shopify.currency && window.Shopify.currency.rate && !isNaN(window.Shopify.currency.rate)) ? parseFloat(window.Shopify.currency.rate) : 1;
      var currSymbol = (window.Shopify && window.Shopify.currency && window.Shopify.currency.symbol) || "";
      var countryCode = (window.Shopify && window.Shopify.country) || "";

      // If priceVal is already presentment price from Shopify variant API, use num directly; otherwise convert by exchange rate
      var convertedAmount = isPresentment ? num : (num * rate);

      // Apply Shopify Markets Price Rounding Rule when converting base prices
      if (!isPresentment && rate !== 1) {
        var roundedInt = Math.ceil(convertedAmount);
        if (Math.abs(convertedAmount - roundedInt) > 0.001) {
          convertedAmount = roundedInt;
        }
      }

      if (activeCurr) {
        try {
          var locale = countryCode ? ("en-" + countryCode) : (navigator.language || "en-US");
          var intlFormatter = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: activeCurr,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
          var intlResult = intlFormatter.format(convertedAmount);
          if (intlResult) return intlResult;
        } catch (err) {
          /* fallback below */
        }
      }

      var formattedNum = convertedAmount.toFixed(2);
      if (currSymbol) {
        if (/^[A-Za-z]+$/.test(currSymbol.trim())) {
          return currSymbol.trim() + " " + formattedNum;
        }
        return currSymbol.trim() + formattedNum;
      }

      return (activeCurr ? (activeCurr + " ") : "$") + formattedNum;
    }

    function formatCurrencyPrice(priceVal) {
      return formatShopifyMoney(priceVal, false);
    }

    function getPackageKey() {
      if (state.selectedPackage === "pro") return "pro";
      if (state.selectedPackage === "standard") return "standard";
      if (state.selectedPackage === "pkg3") return "pkg3";
      if (options.packages && options.packages.length > 0) {
        var idx = options.packages.findIndex(function (p) { return p.id === state.selectedPackage; });
        if (idx === 0) return "standard";
        if (idx === 1) return "pro";
        if (idx === 2) return "pkg3";
      }
      return "";
    }

    function fetchVariantPrices() {

      // fetchVariantPrices() call করার আগে log করুন
      options.packages.forEach(function (pkg, idx) {
        console.log("Package " + idx + " variantId:", pkg.shopifyVariantId);
      });



      if (!options.packages || options.packages.length === 0) return Promise.resolve();
      var embeddedData = getEmbeddedVariantPrices();
      var embeddedPrices = embeddedData.variants || {};
      var productVariantsArr = embeddedData.product_variants || [];
      var rootPath = getShopifyRootPath();

      var promises = options.packages.map(function (pkg, idx) {
        var vId = String(pkg.shopifyVariantId || "");

        // 1. If variant ID exists in embedded Shopify Liquid map
        if (vId && embeddedPrices[vId]) {
          variantPriceCache[vId] = {
            price: embeddedPrices[vId].price,
            compareAtPrice: embeddedPrices[vId].compare_at_price,
            formattedPrice: embeddedPrices[vId].formatted_price,
            formattedCompareAt: embeddedPrices[vId].formatted_compare_at
          };
          return Promise.resolve();
        }

        // 2. If shopifyVariantId is provided from dashboard API, fetch variant directly from Shopify AJAX API
        if (vId) {
          var variantUrl = rootPath + "variants/" + encodeURIComponent(vId) + ".json";
          return fetch(variantUrl)
            .then(function (res) {
              if (!res.ok) throw new Error("Variant 404");
              return res.json();
            })
            .then(function (data) {
              if (data && data.variant) {
                var v = data.variant;
                variantPriceCache[vId] = {
                  price: v.price,
                  compareAtPrice: v.compare_at_price,
                  formattedPrice: formatShopifyMoney(v.price, true),
                  formattedCompareAt: v.compare_at_price ? formatShopifyMoney(v.compare_at_price, true) : ""
                };
              }
            })
            .catch(function (err) {

              console.error("Variant fetch failed for pkg " + idx + ":", vId, err);

              // If pkg.price is configured from backend API, use it first!
              if (pkg.price) {
                var formattedPrice = formatShopifyMoney(pkg.price, false);
                var rawCompare = getCompareAtPrice(pkg);
                var formattedCompare = rawCompare ? formatShopifyMoney(rawCompare, false) : "";

                var cacheKey = "pkg_" + idx;
                variantPriceCache[cacheKey] = {
                  price: pkg.price,
                  compareAtPrice: rawCompare,
                  formattedPrice: formattedPrice,
                  formattedCompareAt: formattedCompare
                };
                if (vId) {
                  variantPriceCache[vId] = variantPriceCache[cacheKey];
                }
              } else if (productVariantsArr[idx]) {
                var targetV = productVariantsArr[idx];
                var cacheKey = "pkg_" + idx;
                variantPriceCache[cacheKey] = {
                  price: targetV.price,
                  compareAtPrice: targetV.compare_at_price,
                  formattedPrice: targetV.formatted_price,
                  formattedCompareAt: targetV.formatted_compare_at
                };
                variantPriceCache[vId] = variantPriceCache[cacheKey];
              }
            });
        }

        // 3. Prioritize raw package price from backend API (merchant configured price)
        if (pkg.price) {
          var formattedPrice = formatShopifyMoney(pkg.price, false);
          var rawCompare = getCompareAtPrice(pkg);
          var formattedCompare = rawCompare ? formatShopifyMoney(rawCompare, false) : "";

          var key = "pkg_" + idx;
          variantPriceCache[key] = {
            price: pkg.price,
            compareAtPrice: rawCompare,
            formattedPrice: formattedPrice,
            formattedCompareAt: formattedCompare
          };
          if (vId) variantPriceCache[vId] = variantPriceCache[key];
          return Promise.resolve();
        }

        // 4. Fallback: Match by index position against Shopify product variants (0 -> Standard, 1 -> Pro)
        if (productVariantsArr[idx]) {
          var targetV = productVariantsArr[idx];
          var cacheKey = "pkg_" + idx;
          variantPriceCache[cacheKey] = {
            price: targetV.price,
            compareAtPrice: targetV.compare_at_price,
            formattedPrice: targetV.formatted_price,
            formattedCompareAt: targetV.formatted_compare_at
          };
          return Promise.resolve();
        }

        return Promise.resolve();
      });

      return Promise.all(promises).then(function () {
        renderPackages();
      });
    }

    function calcDiscountLabel(pkg, currentPriceStr, comparePriceStr) {
      if (pkg && pkg.discount) {
        var numMatch = String(pkg.discount).match(/(\d+)[.,]?(\d*)/);
        if (numMatch) {
          var num = parseFloat(numMatch[1] + (numMatch[2] ? ("." + numMatch[2]) : ""));
          if (!isNaN(num)) {
            var rounded = Math.round(num);
            return rounded > 0 ? (rounded + "% OFF") : "";
          }
        }
        return pkg.discount;
      }
      var compareStr = comparePriceStr || (pkg ? getCompareAtPrice(pkg) : "");
      var priceStr = currentPriceStr || (pkg ? pkg.price : "");
      if (!compareStr || !priceStr) return "";
      var compare = parseFloat(String(compareStr).replace(/[^\d.,]/g, "").replace(",", "."));
      var current = parseFloat(String(priceStr).replace(/[^\d.,]/g, "").replace(",", "."));
      if (isNaN(compare) || isNaN(current) || compare <= current) return "";
      var pct = Math.round(((compare - current) / compare) * 100);
      return pct > 0 ? (pct + "% OFF") : "";
    }

    function getSelectedTrackLengthText() {
      var selectedTrack = null;
      if (musicTracks && musicTracks.length > 0) {
        selectedTrack = musicTracks.find(function (t) { return t.id === state.selectedDemo; }) || musicTracks[0];
      }
      if (selectedTrack) {
        var rawDur = selectedTrack.duration || selectedTrack.audio_duration || selectedTrack.durationSeconds;
        var durText = formatFullDuration(rawDur);
        if (durText) {
          return "Full song length: " + durText;
        }
      }
      return "Full song length: ~2-3 min";
    }

    function updatePackageSongLengthBadges() {
      var lengthText = getSelectedTrackLengthText();
      var lengthEls = root.querySelectorAll(".csb-package-song-length");
      lengthEls.forEach(function (el) {
        el.textContent = lengthText;
      });
    }

    function renderPackages() {
      var wrap = $("[data-csb-packages-grid]");
      if (!wrap) return;

      // Update Rush order title and description if provided from dashboard options
      if (options) {
        var rushTitleEl = root.querySelector("[data-csb-rush-title]");
        if (rushTitleEl && options.rushOrderTitle) {
          rushTitleEl.textContent = options.rushOrderTitle;
        }
        var rushDescEl = root.querySelector("[data-csb-rush-desc]");
        if (rushDescEl && options.rushOrderDescription) {
          rushDescEl.textContent = options.rushOrderDescription;
        }
      }

      if (optionsLoading) {
        wrap.innerHTML = '<div class="csb-loading-text csb-center">Loading packages...</div>';
        return;
      }

      // If options.packages is available from dashboard API, render dynamically with updated features & layout
      if (options.packages && options.packages.length > 0) {
        var hasValidSelection = state.selectedPackage &&
          options.packages.some(function (p) { return p.id === state.selectedPackage; });
        if (!hasValidSelection) {
          state.selectedPackage = options.packages[0].id;
        }

        wrap.innerHTML = "";
        var embeddedData = getEmbeddedVariantPrices();
        var embeddedPrices = embeddedData.variants || {};
        var productVariantsArr = embeddedData.product_variants || [];

        options.packages.forEach(function (pkg, idx) {
          var card = document.createElement("div");
          var isSelected = (state.selectedPackage === pkg.id);
          card.className = "csb-package-card" + (isSelected ? " is-selected" : "");
          card.setAttribute("data-package-id", pkg.id);
          card.setAttribute("data-csb-package-card", pkg.id);

          var vId = String(pkg.shopifyVariantId || "");
          if (vId) card.setAttribute("data-variant-id", vId);
          if (pkg.shopifyRushVariantId) card.setAttribute("data-rush-variant-id", pkg.shopifyRushVariantId);

          if (pkg.tagline) {
            var tag = document.createElement("div");
            tag.className = "csb-package-tag";
            tag.textContent = pkg.tagline;
            card.appendChild(tag);
          }

          var body = document.createElement("div");
          body.className = "csb-package-body";

          var title = document.createElement("h3");
          title.className = "csb-package-title";
          title.textContent = (pkg.title && pkg.title.indexOf("🔒") === -1) ? ("🔒 " + pkg.title) : pkg.title;
          body.appendChild(title);

          var songLength = document.createElement("div");
          songLength.className = "csb-package-song-length";
          songLength.textContent = getSelectedTrackLengthText();
          body.appendChild(songLength);

          // Features List (Displayed first before price!)
          if (pkg.features && pkg.features.length > 0) {
            var featuresWrap = document.createElement("div");
            featuresWrap.className = "csb-package-features";
            var label = document.createElement("div");
            label.className = "csb-package-features-label";
            label.textContent = "📦 What's included?";
            featuresWrap.appendChild(label);
            var ul = document.createElement("ul");
            pkg.features.forEach(function (f) {
              var li = document.createElement("li");
              li.textContent = f;
              ul.appendChild(li);
            });
            featuresWrap.appendChild(ul);
            body.appendChild(featuresWrap);
          }

          // Price Wrap (Placed at bottom of card!)
          var priceWrap = document.createElement("div");
          priceWrap.className = "csb-package-price-wrap";

          var vPriceData = (vId && embeddedPrices[vId]) ? embeddedPrices[vId] : (vId && variantPriceCache[vId]) ? variantPriceCache[vId] : variantPriceCache["pkg_" + idx] || (pkg.price ? null : productVariantsArr[idx]);

          var displayPrice = (vPriceData && (vPriceData.formatted_price || vPriceData.formattedPrice)) ? (vPriceData.formatted_price || vPriceData.formattedPrice) : formatCurrencyPrice(pkg.price);
          var rawCompare = getCompareAtPrice(pkg);
          var displayCompare = (vPriceData && (vPriceData.formatted_compare_at || vPriceData.formattedCompareAt)) ? (vPriceData.formatted_compare_at || vPriceData.formattedCompareAt) : (rawCompare ? formatCurrencyPrice(rawCompare) : "");

          if (displayCompare && displayCompare !== displayPrice) {
            var originalPrice = document.createElement("span");
            originalPrice.className = "csb-package-original-price";
            originalPrice.textContent = displayCompare;
            priceWrap.appendChild(originalPrice);
          }

          var price = document.createElement("div");
          price.className = "csb-package-price";
          price.setAttribute("data-csb-package-price", "");
          price.textContent = displayPrice;
          priceWrap.appendChild(price);

          var discountLabel = calcDiscountLabel(pkg, displayPrice, displayCompare);
          if (discountLabel) {
            var discountBadge = document.createElement("span");
            discountBadge.className = "csb-package-discount-badge";
            discountBadge.textContent = discountLabel;
            priceWrap.appendChild(discountBadge);
          }

          body.appendChild(priceWrap);
          card.appendChild(body);

          card.addEventListener("click", function () {
            state.selectedPackage = pkg.id;
            renderPackages();
            saveProgress();
          });
          wrap.appendChild(card);
        });
        updatePackageSongLengthBadges();
        renderUpsells();
        return;
      }

      // Fallback if no dynamic packages: bind static Liquid cards
      var existingCards = wrap.querySelectorAll(".csb-package-card");
      if (existingCards.length > 0) {
        var validCardIds = [];
        existingCards.forEach(function (c) {
          var cid = c.dataset.packageId || c.dataset.csbPackageCard;
          if (cid) validCardIds.push(cid);
        });

        if (!state.selectedPackage || validCardIds.indexOf(state.selectedPackage) === -1) {
          state.selectedPackage = validCardIds[0] || "standard";
        }

        existingCards.forEach(function (card) {
          var pkgId = card.dataset.packageId || card.dataset.csbPackageCard;
          if (state.selectedPackage === pkgId) {
            card.classList.add("is-selected");
          } else {
            card.classList.remove("is-selected");
          }

          var priceEl = card.querySelector("[data-csb-package-price]");
          if (priceEl && card.dataset.price) {
            priceEl.textContent = card.dataset.price;
          }

          if (!card.dataset.csbBound) {
            card.dataset.csbBound = "true";
            card.addEventListener("click", function () {
              state.selectedPackage = pkgId;
              renderPackages();
              renderSummary();
              saveProgress();
            });
          }
        });
        updatePackageSongLengthBadges();
        renderUpsells();
      }
    }

    function renderUpsells() {
      var container = root.querySelector("[data-csb-upsells-container]");
      if (!container) return;

      if (!options.upsells || options.upsells.length === 0) {
        var staticRushCheck = container.querySelector('[data-csb-field="rushOrder"]');
        if (staticRushCheck && !staticRushCheck.dataset.csbBound) {
          staticRushCheck.dataset.csbBound = "true";
          staticRushCheck.checked = !!state.rushOrder;
          staticRushCheck.addEventListener("change", function () {
            state.rushOrder = staticRushCheck.checked;
            renderSummary();
            saveProgress();
          });
        }
        return;
      }

      var activeUpsells = (options.upsells || []).filter(function (u) {
        return u.enabled !== false;
      });

      if (activeUpsells.length === 0) {
        container.innerHTML = "";
        return;
      }

      container.innerHTML = "";
      state.selectedUpsells = state.selectedUpsells || {};

      activeUpsells.forEach(function (upsell) {
        var uId = upsell.id || ("upsell_" + upsell.type);
        if (state.selectedUpsells[uId] === undefined) {
          state.selectedUpsells[uId] = (upsell.defaultSelected === true);
        }
        if (upsell.type === "rush") {
          state.rushOrder = !!state.selectedUpsells[uId];
        }

        var isChecked = !!state.selectedUpsells[uId];

        var box = document.createElement("div");
        box.className = "csb-rush-order-box" + (isChecked ? " is-selected" : "");
        box.setAttribute("data-upsell-id", uId);

        var label = document.createElement("label");
        label.className = "csb-checkbox-row " + (upsell.type === "rush" ? "csb-checkbox-rush" : "csb-checkbox-upsell");

        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = isChecked;
        input.className = "csb-upsell-checkbox";

        var infoDiv = document.createElement("div");
        infoDiv.className = "csb-rush-order-info";

        var titleSpan = document.createElement("span");
        titleSpan.className = "csb-rush-order-title";
        titleSpan.textContent = upsell.title;

        var descText = (upsell.subtext || upsell.description || "").trim();
        var descSpan = document.createElement("span");
        descSpan.className = "csb-rush-order-text";
        descSpan.textContent = descText;

        infoDiv.appendChild(titleSpan);
        if (descText) {
          infoDiv.appendChild(descSpan);
        }

        var priceSpan = document.createElement("span");
        priceSpan.className = "csb-rush-order-price";

        var priceStr = "";
        if (upsell.price) {
          priceStr = formatShopifyMoney(upsell.price, false);
        }
        if (priceStr) {
          priceSpan.textContent = "+" + priceStr.replace(/^\+/, "");
        }

        input.addEventListener("change", function () {
          state.selectedUpsells[uId] = input.checked;
          if (upsell.type === "rush") {
            state.rushOrder = input.checked;
          }
          if (input.checked) {
            box.classList.add("is-selected");
          } else {
            box.classList.remove("is-selected");
          }
          renderSummary();
          saveProgress();
        });

        label.appendChild(input);
        label.appendChild(infoDiv);
        if (priceStr) label.appendChild(priceSpan);
        box.appendChild(label);
        container.appendChild(box);
      });
    }

    function renderLyricsVariations() {
      var panel = $("[data-csb-lyrics-variations]");
      var grid = $("[data-csb-variations-grid]");
      if (!panel || !grid) return;

      // Filter out any empty variations
      lyricsVariations = (lyricsVariations || []).filter(function (v) {
        return v && v.text && v.text.trim().length > 0;
      });

      // Rehydrate from state if variations array is empty but lyrics exist
      if (lyricsVariations.length === 0 && (state.lyrics || state.generatedLyrics)) {
        var existingText = (state.lyrics || state.generatedLyrics || "").trim();
        if (existingText) {
          lyricsVariations = [{ title: "Generated Lyrics", text: existingText }];
        }
      }

      var hasValidLyrics = lyricsVariations.length > 0 && !!lyricsVariations[0].text.trim();

      if (!hasValidLyrics) {
        panel.hidden = true;
        grid.innerHTML = "";
        setLyricsButtonState();
        return;
      }

      panel.hidden = false;
      grid.innerHTML = "";

      var variation = lyricsVariations[0];
      if (!variation) return;

      var card = document.createElement("div");
      card.className = "csb-variation-card is-selected";

      var header = document.createElement("div");
      header.className = "csb-variation-header";
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.marginBottom = "0.75rem";

      var h3 = document.createElement("h3");
      h3.style.margin = "0";
      h3.textContent = variation.title || "Generated Lyrics";
      header.appendChild(h3);

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "csb-btn-edit-inline";
      editBtn.innerHTML = "✏️ Edit";
      header.appendChild(editBtn);

      card.appendChild(header);

      var isEditing = false;

      var textDiv = document.createElement("div");
      textDiv.className = "csb-variation-text";
      textDiv.style.whiteSpace = "pre-wrap";
      textDiv.textContent = variation.text;
      card.appendChild(textDiv);

      var textarea = document.createElement("textarea");
      textarea.className = "csb-textarea csb-variation-edit-textarea";
      textarea.rows = 14;
      textarea.value = variation.text;
      textarea.style.display = "none";
      card.appendChild(textarea);

      function autoExpandTextarea() {
        textarea.style.height = "auto";
        var scrollH = textarea.scrollHeight;
        textarea.style.height = Math.max(280, scrollH + 20) + "px";
      }

      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        isEditing = !isEditing;
        if (isEditing) {
          textDiv.style.display = "none";
          textarea.style.display = "block";
          autoExpandTextarea();
          textarea.focus();
          editBtn.classList.add("is-active");
          editBtn.innerHTML = "✓ Done";
        } else {
          var val = textarea.value.trim();
          if (!val) {
            // User deleted all lyrics: Reset AI variations so user must regenerate or type!
            lyricsVariations = [];
            state.generatedLyrics = "";
            state.lyrics = "";
            renderLyricsVariations();
            setLyricsButtonState();
            saveProgress();
            return;
          }
          variation.text = textarea.value;
          state.generatedLyrics = textarea.value;
          state.lyrics = textarea.value;
          textDiv.textContent = textarea.value;
          textDiv.style.display = "block";
          textarea.style.display = "none";
          editBtn.classList.remove("is-active");
          editBtn.innerHTML = "✏️ Edit";
          syncFieldInputs();
          saveProgress();
        }
      });

      textarea.addEventListener("input", function () {
        autoExpandTextarea();
        var val = textarea.value;
        variation.text = val;
        state.generatedLyrics = val;
        state.lyrics = val;
        textDiv.textContent = val;
        syncFieldInputs();
        saveProgress();
      });

      grid.appendChild(card);
      syncFieldInputs();
      setLyricsButtonState();
    }

    function createCustomAudioPlayer(audioSrc, rootEl) {
      var container = document.createElement("div");
      container.className = "csb-audio-player";

      var playSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      var pauseSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      var soundOnSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
      var soundOffSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "csb-player-play-btn";
      playBtn.setAttribute("aria-label", "Play Audio");
      playBtn.innerHTML = playSvg;

      var currentTimeEl = document.createElement("span");
      currentTimeEl.className = "csb-player-current-time";
      currentTimeEl.textContent = "0:00";

      var progressInput = document.createElement("input");
      progressInput.type = "range";
      progressInput.className = "csb-player-progress";
      progressInput.value = "0";
      progressInput.min = "0";
      progressInput.max = "100";

      var muteBtn = document.createElement("button");
      muteBtn.type = "button";
      muteBtn.className = "csb-player-mute-btn";
      muteBtn.setAttribute("aria-label", "Mute Audio");
      muteBtn.innerHTML = soundOnSvg;

      var audio = document.createElement("audio");
      audio.preload = "metadata";

      var source = document.createElement("source");
      source.src = audioSrc;
      source.type = "audio/mpeg";
      audio.appendChild(source);

      function formatTime(sec) {
        if (isNaN(sec) || !isFinite(sec)) return "0:00";
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ":" + (s < 10 ? "0" : "") + s;
      }

      playBtn.onclick = function (e) {
        e.stopPropagation();
        if (audio.paused) {
          if (rootEl) {
            rootEl.querySelectorAll("audio").forEach(function (a) {
              if (a !== audio) {
                a.pause();
                if (typeof a._updateCustomPlayer === "function") a._updateCustomPlayer();
              }
            });
          }
          audio.play();
        } else {
          audio.pause();
        }
      };

      audio.onplay = function () {
        playBtn.innerHTML = pauseSvg;
        playBtn.classList.add("is-playing");
      };

      audio.onpause = function () {
        playBtn.innerHTML = playSvg;
        playBtn.classList.remove("is-playing");
      };

      audio.onended = function () {
        playBtn.innerHTML = playSvg;
        playBtn.classList.remove("is-playing");
        progressInput.value = "0";
        currentTimeEl.textContent = "0:00";
      };

      audio.ontimeupdate = function () {
        if (audio.duration && !isNaN(audio.duration)) {
          progressInput.value = (audio.currentTime / audio.duration) * 100;
        }
        currentTimeEl.textContent = formatTime(audio.currentTime);
      };

      progressInput.oninput = function (e) {
        e.stopPropagation();
        if (audio.duration && !isNaN(audio.duration)) {
          audio.currentTime = (progressInput.value / 100) * audio.duration;
        }
      };

      progressInput.onclick = function (e) {
        e.stopPropagation();
      };

      muteBtn.onclick = function (e) {
        e.stopPropagation();
        audio.muted = !audio.muted;
        muteBtn.innerHTML = audio.muted ? soundOffSvg : soundOnSvg;
        muteBtn.classList.toggle("is-muted", audio.muted);
      };

      audio._updateCustomPlayer = function () {
        if (audio.paused) {
          playBtn.innerHTML = playSvg;
          playBtn.classList.remove("is-playing");
        }
      };

      container.appendChild(playBtn);
      container.appendChild(currentTimeEl);
      container.appendChild(progressInput);
      container.appendChild(muteBtn);
      container.appendChild(audio);

      return container;
    }

    function formatFullDuration(sec) {
      var num = parseFloat(sec);
      if (!num || isNaN(num) || !isFinite(num) || num <= 45) return "";
      var totalSec = Math.round(num);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      return m + ":" + (s < 10 ? "0" : "") + s + " min";
    }

    function renderTracks() {
      var grid = $("[data-csb-tracks-grid]");
      var countLabel = $("[data-csb-tracks-count]");
      if (!grid) return;

      var hasRealTracks = musicTracks.length > 0;
      var displayTracks = hasRealTracks ? musicTracks : [
        { id: "demo1", title: "Version 1" },
        { id: "demo2", title: "Version 2" }
      ];

      // Pre-select 1st demo version by default when music is ready
      var demoExists = displayTracks.some(function (t) { return t.id === state.selectedDemo; });
      if (!demoExists && displayTracks.length > 0) {
        state.selectedDemo = displayTracks[0].id;
      }

      if (countLabel && !countLabel.textContent.trim()) {
        countLabel.textContent = "Choose your favorite. Your full song will be unlocked after checkout.";
      }

      grid.innerHTML = "";
      displayTracks.forEach(function (track, idx) {
        var isSelected = state.selectedDemo === track.id;
        var card = document.createElement("div");
        card.className = "csb-track-card" + (isSelected ? " is-selected" : "");

        var headerRow = document.createElement("div");
        headerRow.className = "csb-track-header-row";

        var titleBox = document.createElement("div");
        titleBox.className = "csb-track-title-box";

        var versionTitle = document.createElement("h3");
        versionTitle.className = "csb-track-version-title";
        versionTitle.textContent = "Version " + (idx + 1);
        titleBox.appendChild(versionTitle);

        var subtitle = document.createElement("p");
        subtitle.className = "csb-track-subtitle";
        var trackName = track.title || (state.occasion ? (state.occasion + " Song") : "Custom Song");
        subtitle.textContent = trackName;
        titleBox.appendChild(subtitle);

        var rawDur = track.duration || track.audio_duration || track.durationSeconds;
        var durText = formatFullDuration(rawDur);
        if (durText) {
          var durationTag = document.createElement("div");
          durationTag.className = "csb-track-full-length";
          durationTag.textContent = "Full song length: " + durText;
          titleBox.appendChild(durationTag);
        }

        headerRow.appendChild(titleBox);

        var badge = document.createElement("button");
        badge.type = "button";
        badge.className = "csb-track-badge " + (isSelected ? "is-selected" : "is-not-selected");
        badge.textContent = isSelected ? "✓ Selected" : "Select";
        headerRow.appendChild(badge);

        card.appendChild(headerRow);

        if (track.streamAudioUrl) {
          var audioWrap = document.createElement("div");
          audioWrap.className = "csb-track-audio";
          audioWrap.addEventListener("click", function (e) { e.stopPropagation(); });
          var customPlayer = createCustomAudioPlayer(track.streamAudioUrl, root);
          audioWrap.appendChild(customPlayer);
          card.appendChild(audioWrap);
        } else {
          var fallback = document.createElement("div");
          fallback.className = "csb-track-play-fallback";
          var playSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          playSvg.setAttribute("viewBox", "0 0 24 24");
          playSvg.setAttribute("fill", "currentColor");
          playSvg.style.width = "1.5rem";
          playSvg.style.height = "1.5rem";
          playSvg.style.marginLeft = "2px";
          playSvg.innerHTML = '<path d="M8 5v14l11-7z" />';
          fallback.appendChild(playSvg);
          card.appendChild(fallback);
        }

        if (hasRealTracks) {
          card.addEventListener("click", function () {
            state.selectedDemo = track.id;
            renderTracks();
            updatePackageSongLengthBadges();
            saveProgress();
          });
          badge.addEventListener("click", function (e) {
            e.stopPropagation();
            state.selectedDemo = track.id;
            renderTracks();
            updatePackageSongLengthBadges();
            saveProgress();
          });
        } else {
          card.style.cursor = "default";
        }

        grid.appendChild(card);
      });
      updatePackageSongLengthBadges();
    }

    function renderSummary() {
      var list = $("[data-csb-summary-list]");
      if (!list) return;
      var rows = [
        ["Occasion", state.occasion],
        ["Recipients", formatRecipients(state.recipients, false)],
        ["Music Style", [state.genre, state.voice, state.mood].filter(Boolean).join(" • ")],
        ["Email", state.email]
      ];
      list.innerHTML = "";
      rows.forEach(function (row) {
        var li = document.createElement("li");
        var label = document.createElement("span");
        label.textContent = row[0] + ":";
        var value = document.createElement("span");
        value.textContent = row[1] || "—";
        li.appendChild(label);
        li.appendChild(value);
        list.appendChild(li);
      });

      renderSummarySong();
      renderSummaryPackage();

      var totalValueEl = $("[data-csb-total-price]");
      if (totalValueEl) {
        var embeddedData = getEmbeddedVariantPrices();
        var embeddedPrices = embeddedData.variants || {};
        var pkgVariants = embeddedData.package_variants || {};
        var productVariantsArr = embeddedData.product_variants || [];
        var isRush = !!state.rushOrder;
        var pkgIdx = (options.packages || []).findIndex(function (p) { return p.id === state.selectedPackage; });
        if (pkgIdx < 0) pkgIdx = 0;
        var pkg = (options.packages || [])[pkgIdx];
        var vId = (pkg && pkg.shopifyVariantId) ? String(pkg.shopifyVariantId) : "";

        var total = "";
        var totalCompareAt = "";

        var pkgKey = getPackageKey();
        if (pkgKey && pkgVariants[pkgKey]) {
          var pVar = pkgVariants[pkgKey];
          if (isRush && pVar.rush_id) {
            total = pVar.formatted_rush_price || formatCurrencyPrice(pVar.rush_price);
            totalCompareAt = pVar.formatted_rush_compare_at || "";
          } else if (pVar.default_id) {
            total = pVar.formatted_default_price || formatCurrencyPrice(pVar.default_price);
            totalCompareAt = pVar.formatted_default_compare_at || "";
          }
        }

        if (!total) {
          var vPriceData = (vId && embeddedPrices[vId]) ? embeddedPrices[vId] : (productVariantsArr[pkgIdx] || (vId && variantPriceCache[vId] ? variantPriceCache[vId] : variantPriceCache["pkg_" + pkgIdx]));
          var pkgPriceStr = (vPriceData && (vPriceData.formatted_price || vPriceData.formattedPrice)) ? (vPriceData.formatted_price || vPriceData.formattedPrice) : ((pkg && pkg.price) ? formatCurrencyPrice(pkg.price) : "");
          total = pkgPriceStr;

          if (state.rushOrder) {
            var rushPriceEl = $("[data-csb-rush-price]");
            var rushPriceStr = rushPriceEl ? rushPriceEl.textContent : "";
            if (pkgPriceStr && rushPriceStr) {
              var p1 = parseFloat(pkgPriceStr.replace(/[^\d.,]/g, "").replace(",", "."));
              var p2 = parseFloat(rushPriceStr.replace(/[^\d.,]/g, "").replace(",", "."));
              if (!isNaN(p1) && !isNaN(p2)) {
                var symbol = pkgPriceStr.replace(/[\d.,\s]/g, "");
                var isCommaDecimal = pkgPriceStr.indexOf(",") !== -1;
                var sumStr = (p1 + p2).toFixed(2);
                if (isCommaDecimal) sumStr = sumStr.replace(".", ",");

                if (pkgPriceStr.indexOf(symbol) === 0) {
                  total = symbol + sumStr;
                } else {
                  total = sumStr + " " + symbol;
                }
              }
            }
          }
        }

        var extraUpsellsPrice = 0;
        state.selectedUpsells = state.selectedUpsells || {};
        (options.upsells || []).forEach(function (u) {
          var uId = u.id || ("upsell_" + u.type);
          if (state.selectedUpsells[uId] && u.type !== "rush") {
            var upVal = parseFloat(String(u.price || "0").replace(/[^\d.,]/g, "").replace(",", "."));
            if (!isNaN(upVal) && upVal > 0) {
              extraUpsellsPrice += upVal;
            }
          }
        });

        if (extraUpsellsPrice > 0 && total) {
          var curNum = parseFloat(total.replace(/[^\d.,]/g, "").replace(",", "."));
          if (!isNaN(curNum)) {
            var sym = total.replace(/[\d.,\s]/g, "");
            var isComma = total.indexOf(",") !== -1;
            var newSum = (curNum + extraUpsellsPrice).toFixed(2);
            if (isComma) newSum = newSum.replace(".", ",");
            total = (total.indexOf(sym) === 0) ? (sym + newSum) : (newSum + " " + sym);
          }
        }

        totalValueEl.innerHTML = "";
        var totalCompareAt = pkg ? getCompareAtPrice(pkg) : "";
        var hasDiscount = totalCompareAt && totalCompareAt !== (pkg && pkg.price);

        if (hasDiscount) {
          var origTotal = totalCompareAt;
          if (state.rushOrder) {
            var rushPriceEl2 = $("[data-csb-rush-price]");
            var rushPriceStr2 = rushPriceEl2 ? rushPriceEl2.textContent : "";
            if (origTotal && rushPriceStr2) {
              var op1 = parseFloat(origTotal.replace(/[^\d.,]/g, "").replace(",", "."));
              var op2 = parseFloat(rushPriceStr2.replace(/[^\d.,]/g, "").replace(",", "."));
              if (!isNaN(op1) && !isNaN(op2)) {
                var oSymbol = origTotal.replace(/[\d.,\s]/g, "");
                var oIsComma = origTotal.indexOf(",") !== -1;
                var oSumStr = (op1 + op2).toFixed(2);
                if (oIsComma) oSumStr = oSumStr.replace(".", ",");
                origTotal = origTotal.indexOf(oSymbol) === 0 ? (oSymbol + oSumStr) : (oSumStr + " " + oSymbol);
              }
            }
          }
          if (extraUpsellsPrice > 0 && origTotal) {
            var origNum = parseFloat(origTotal.replace(/[^\d.,]/g, "").replace(",", "."));
            if (!isNaN(origNum)) {
              var sym2 = origTotal.replace(/[\d.,\s]/g, "");
              var isComma2 = origTotal.indexOf(",") !== -1;
              var newOrigSum = (origNum + extraUpsellsPrice).toFixed(2);
              if (isComma2) newOrigSum = newOrigSum.replace(".", ",");
              origTotal = origTotal.indexOf(sym2) === 0 ? (sym2 + newOrigSum) : (newOrigSum + " " + sym2);
            }
          }

          var origSpan = document.createElement("span");
          origSpan.className = "csb-total-original-price";
          origSpan.textContent = origTotal;
          totalValueEl.appendChild(origSpan);

          var currentSpan = document.createElement("span");
          currentSpan.className = "csb-total-current-price";
          currentSpan.textContent = total || "—";
          totalValueEl.appendChild(currentSpan);

          var totalDiscLabel = pkg ? calcDiscountLabel(pkg) : "";
          if (totalDiscLabel) {
            var saveBadge = document.createElement("span");
            saveBadge.className = "csb-total-discount-badge";
            saveBadge.textContent = totalDiscLabel;
            totalValueEl.appendChild(saveBadge);
          }
        } else {
          totalValueEl.textContent = total || "—";
        }
      }
    }

    function renderSummarySong() {
      var wrap = $("[data-csb-summary-song]");
      var artWrap = $("[data-csb-summary-song-art]");
      var titleEl = $("[data-csb-summary-song-title]");
      var audioWrap = $("[data-csb-summary-song-audio]");
      if (!wrap) return;

      var chosen = musicTracks.filter(function (t) { return t.id === state.selectedDemo; })[0];

      if (!chosen) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;

      if (titleEl) titleEl.textContent = chosen.title || "Your custom song";

      if (artWrap) {
        artWrap.innerHTML = "";
        if (chosen.imageUrl) {
          var img = document.createElement("img");
          img.src = chosen.imageUrl;
          img.alt = chosen.title || "Song cover art";
          img.addEventListener("error", function () { img.style.display = "none"; });
          artWrap.appendChild(img);
        } else {
          artWrap.textContent = "🎵";
        }
      }

      if (audioWrap) {
        audioWrap.innerHTML = "";
        if (chosen.streamAudioUrl) {
          var customPlayer = createCustomAudioPlayer(chosen.streamAudioUrl, root);
          audioWrap.appendChild(customPlayer);
        } else {
          var noAudio = document.createElement("p");
          noAudio.className = "csb-hint";
          noAudio.textContent = "Audio preview is still processing — it will be ready in your order email.";
          audioWrap.appendChild(noAudio);
        }
      }
    }

    function renderSummaryPackage() {
      var wrap = $("[data-csb-summary-package]");
      var cardWrap = $("[data-csb-summary-package-card]");
      if (!wrap || !cardWrap) return;

      var pkg = (options.packages || []).filter(function (p) { return p.id === state.selectedPackage; })[0];

      if (!pkg) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      cardWrap.innerHTML = "";

      var info = document.createElement("div");
      info.className = "csb-summary-package-info";

      var titleRow = document.createElement("div");
      titleRow.className = "csb-summary-package-title-row";
      var title = document.createElement("span");
      title.className = "csb-summary-package-title";
      title.textContent = pkg.title || state.selectedPackage;

      var priceCol = document.createElement("div");
      priceCol.className = "csb-summary-package-price-col";

      var pkgCompareAt = getCompareAtPrice(pkg);
      if (pkgCompareAt && pkgCompareAt !== pkg.price) {
        var origPrice = document.createElement("span");
        origPrice.className = "csb-summary-package-original-price";
        origPrice.textContent = pkgCompareAt;
        priceCol.appendChild(origPrice);
      }

      var price = document.createElement("span");
      price.className = "csb-summary-package-price";
      price.textContent = pkg.price || "";
      priceCol.appendChild(price);

      var pkgDiscLabel = calcDiscountLabel(pkg);
      if (pkgDiscLabel) {
        var discBadge = document.createElement("span");
        discBadge.className = "csb-summary-package-discount-badge";
        discBadge.textContent = pkgDiscLabel;
        priceCol.appendChild(discBadge);
      }

      titleRow.appendChild(title);
      titleRow.appendChild(priceCol);
      info.appendChild(titleRow);

      if (pkg.features && pkg.features.length > 0) {
        var ul = document.createElement("ul");
        ul.className = "csb-summary-package-features";
        pkg.features.forEach(function (f) {
          var li = document.createElement("li");
          li.textContent = f;
          ul.appendChild(li);
        });
        info.appendChild(ul);
      }

      cardWrap.appendChild(info);
    }

    function syncFieldInputs() {
      $$("[data-csb-field]").forEach(function (el) {
        var field = el.getAttribute("data-csb-field");

        if (el.type === "checkbox") {
          el.checked = !!state[field];
        } else if (field === "ownLyrics" || field === "lyrics") {
          if (document.activeElement !== el) {
            el.value = state.ownLyrics || (state.creationMethod === "own_lyrics" ? state.lyrics : "") || "";
          }
        } else {
          if (document.activeElement !== el) {
            el.value = state[field] || "";
          }
        }
      });
    }

    function renderMethodCards() {
      $$("[data-csb-method]").forEach(function (btn) {
        var method = btn.getAttribute("data-csb-method");
        btn.classList.toggle("is-selected", state.creationMethod === method);
      });
      $$("[data-csb-panel]").forEach(function (panel) {
        var name = panel.getAttribute("data-csb-panel");
        panel.hidden = state.creationMethod !== name;
      });
    }

    // ---- Progress / step visibility ----
    function renderProgress() {
      var section1Bar = root.querySelector("[data-csb-section-1-bar]");
      var stageBar = root.querySelector("[data-csb-stage-bar]");

      if (state.currentStep <= 4) {
        if (section1Bar) section1Bar.hidden = false;
        if (stageBar) stageBar.hidden = true;
        if (stepLabel) stepLabel.textContent = "Step " + state.currentStep + " of 4";
        var pct = Math.round((state.currentStep / 4) * 100);
        if (percentLabel) percentLabel.textContent = pct + "% Complete";
        if (progressFill) progressFill.style.width = pct + "%";
      } else {
        if (section1Bar) section1Bar.hidden = true;
        if (stageBar) stageBar.hidden = false;

        var stages = root.querySelectorAll("[data-csb-stage]");
        var lines = root.querySelectorAll("[data-csb-stage-line]");

        // Stage 1 (Create)
        if (stages[0]) {
          stages[0].classList.add("is-completed");
          var s1Icon = stages[0].querySelector(".csb-stage-icon");
          if (s1Icon) s1Icon.textContent = "✓";
        }
        if (lines[0]) lines[0].classList.add("is-completed");

        // Stage 2 (Preview)
        if (stages[1]) {
          var s2Icon = stages[1].querySelector(".csb-stage-icon");
          if (state.currentStep === 5 || state.currentStep === 6) {
            stages[1].classList.remove("is-completed");
            stages[1].classList.add("is-active");
            if (s2Icon) s2Icon.textContent = "2";
          } else if (state.currentStep >= 7) {
            stages[1].classList.remove("is-active");
            stages[1].classList.add("is-completed");
            if (s2Icon) s2Icon.textContent = "✓";
          }
        }
        if (lines[1]) {
          lines[1].classList.toggle("is-completed", state.currentStep >= 8);
        }

        // Stage 3 (Unlock Song)
        if (stages[2]) {
          if (state.currentStep >= 8) {
            stages[2].classList.add("is-active");
          } else {
            stages[2].classList.remove("is-active", "is-completed");
          }
        }
      }
      if (progressWrap) progressWrap.style.display = "block";
    }

    function renderStepVisibility() {
      $$("[data-csb-step]").forEach(function (stepEl) {
        var n = parseInt(stepEl.getAttribute("data-csb-step"), 10);
        stepEl.hidden = n !== state.currentStep;
      });
      if (navWrap) {
        navWrap.classList.remove("is-hidden");
      }

      if (backBtn) {
        backBtn.disabled = state.currentStep === 6 || lyricsLoading;
        backBtn.classList.toggle("is-invisible", state.currentStep === 1);
      }
      var hasValidGeneratedLyrics = (lyricsVariations && lyricsVariations.length > 0 && lyricsVariations[0].text && lyricsVariations[0].text.trim().length > 0) || (!!state.lyrics && state.lyrics.trim().length > 0 && state.creationMethod === "write_for_us");
      var regenLyricsBtn = $("[data-csb-generate-lyrics-again]");
      if (regenLyricsBtn) {
        regenLyricsBtn.disabled = lyricsLoading;
        regenLyricsBtn.hidden = state.currentStep !== 3 || state.creationMethod !== "write_for_us" || !hasValidGeneratedLyrics;
      }
      var regenSongsBtn = $("[data-csb-regen-songs]");
      if (regenSongsBtn) {
        regenSongsBtn.hidden = state.currentStep !== 7;
      }
      if (nextBtn) {
        nextBtn.disabled = state.currentStep === 6 || lyricsLoading;
        nextBtn.hidden = state.currentStep === 8;
      }
      if (checkoutBtn) checkoutBtn.hidden = state.currentStep !== 8;
      var trustText = root.querySelector("[data-csb-trust-subtext]");
      if (trustText) trustText.hidden = state.currentStep !== 8;
    }

    function render() {
      renderProgress();
      renderStepVisibility();
      renderRecipients();
      syncFieldInputs();
      renderMethodCards();
      renderLanguages();
      setEmailLockState();
      if (state.currentStep === 3) {
        renderLyricsVariations();
        setLyricsButtonState();
      }
      if (state.currentStep === 4) renderStyleGroups();
      if (state.currentStep === 8) {
        renderPackages();
        renderUpsells();
      }
      saveProgress();
    }

    // ---- Step 5: Email lock icon ----
    var LOCK_CLOSED_D = "M7 11V7a5 5 0 0 1 10 0v4";
    var LOCK_OPEN_D = "M7 11V7a5 5 0 0 1 9.9-2";

    function setEmailLockState() {
      var box = $("[data-csb-lock-box]");
      if (!box) return;
      var shackle = $("[data-csb-lock-shackle]");
      var isValidEmail = !!state.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email);

      box.classList.toggle("is-unlocked", isValidEmail);
      if (shackle) shackle.setAttribute("d", isValidEmail ? LOCK_OPEN_D : LOCK_CLOSED_D);
    }

    // ---- Step 3: Generate lyrics ----
    function setLyricsButtonState() {
      var btn = $("[data-csb-generate-lyrics]");
      var spinner = $("[data-csb-lyrics-spinner]");
      var label = $("[data-csb-generate-lyrics-label]");
      var btn2 = $("[data-csb-generate-lyrics-again]");
      var spinner2 = $("[data-csb-lyrics-spinner-2]");
      var regenLabel = $("[data-csb-regen-label]");
      var errorEl = $("[data-csb-lyrics-error]");

      var hasValidGeneratedLyrics = (lyricsVariations && lyricsVariations.length > 0 && lyricsVariations[0].text && lyricsVariations[0].text.trim().length > 0) || (!!state.lyrics && state.lyrics.trim().length > 0 && state.creationMethod === "write_for_us");

      var genRow = $("[data-csb-generate-row]");
      if (genRow) {
        genRow.hidden = hasValidGeneratedLyrics;
      }
      if (btn) {
        btn.disabled = lyricsLoading || !state.storyText || !state.storyText.trim();
        btn.hidden = hasValidGeneratedLyrics;
      }
      if (spinner) spinner.hidden = !lyricsLoading;
      if (label) label.textContent = lyricsLoading ? "Generating lyrics..." : "✨ Generate Lyrics";

      if (btn2) {
        btn2.disabled = lyricsLoading;
        btn2.hidden = state.currentStep !== 3 || state.creationMethod !== "write_for_us" || !hasValidGeneratedLyrics;
      }
      if (spinner2) spinner2.hidden = !lyricsLoading;
      if (regenLabel) regenLabel.textContent = lyricsLoading ? "Regenerating..." : "↻ Regenerate Lyrics";

      if (errorEl) {
        errorEl.hidden = !lyricsError;
        errorEl.textContent = lyricsError || "";
      }

      renderStepVisibility();
    }

    function generateLyrics(autoAdvance) {
      if (!state.storyText || !state.storyText.trim()) return;
      lyricsLoading = true;
      lyricsError = "";
      musicTracks = [];
      state.taskId = "";
      setLyricsButtonState();
      saveProgress();

      var lang = state.lyricsLanguage || detectLanguageFromUrl() || "Dutch";
      var recipientsText = formatRecipients(state.recipients, false);
      var occasionText = (state.occasion || "Song").trim();
      var styleText = ((state.mood ? state.mood + " " : "") + (state.genre || "pop")).trim();

      // Construct rich descriptive prompt with full customer details and story
      var prefix = occasionText + (recipientsText && recipientsText !== "someone special" ? " for " + recipientsText : "") + ". ";
      var suffix = (styleText ? styleText + " style. " : "") + "Write all lyrics in " + lang + ".";
      var story = (state.storyText || "").trim().replace(/[\r\n\t]+/g, " ");
      if (story.length > 1500) {
        story = story.substring(0, 1500).trim();
      }
      var prompt = (prefix + (story ? story + ". " : "") + suffix).trim();

      fetch(apiUrl("/api/suno/generate-lyrics"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt, language: lang })
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (wrapped) {
          if (!wrapped.ok || !wrapped.data.taskId) {
            throw new Error(wrapped.data.error || "Failed to generate lyrics");
          }
          pendingLyricsTaskId = wrapped.data.taskId;
          saveProgress();

          // If the lyrics were returned immediately (e.g. Mureka AI synchronous generation)
          if (wrapped.data.status === "SUCCESS" && (wrapped.data.lyrics || (wrapped.data.allVariations && wrapped.data.allVariations.length > 0))) {
            return wrapped.data;
          }

          return pollStatus(wrapped.data.taskId, "lyrics", null);
        })
        .then(function (result) {
          if (result.allVariations && result.allVariations.length > 0 && result.allVariations[0].text) {
            lyricsVariations = [result.allVariations[0]];
            selectedLyricsIndex = 0;
            state.generatedLyrics = result.allVariations[0].text;
            state.lyrics = result.allVariations[0].text;
            renderLyricsVariations();
          } else if (result.lyrics) {
            lyricsVariations = [{ title: "Generated Lyrics", text: result.lyrics }];
            selectedLyricsIndex = 0;
            state.generatedLyrics = result.lyrics;
            state.lyrics = result.lyrics;
            renderLyricsVariations();
          } else {
            throw new Error("Lyrics generated but no text returned");
          }
          lastGeneratedLyricsState = {
            occasion: state.occasion,
            occasionIsOther: state.occasionIsOther,
            customOccasion: state.customOccasion,
            recipients: JSON.parse(JSON.stringify(state.recipients)),
            storyText: state.storyText
          };
        })
        .catch(function (err) {
          var msg = err.message || "";
          if (msg.indexOf("200 characters") !== -1 || msg.indexOf("prompt length") !== -1) {
            msg = lang === "Dutch"
              ? "Het verhaal is iets te lang. We hebben het automatisch ingekort, klik nogmaals op Generate Lyrics."
              : "Please shorten the story slightly and try again.";
          }
          lyricsError = msg;
        })
        .finally(function () {
          lyricsLoading = false;
          pendingLyricsTaskId = null;
          setLyricsButtonState();
          saveProgress();
        });
    }

    // ---- Step 7: Generate music ----
    function startMusicGeneration() {
      generationProgress = 0;
      generationError = "";
      generationErrorIsTimeout = false;
      musicTracks = [];
      state.taskId = "";
      state.selectedDemo = "";
      lastGeneratedMusicState = {
        genre: state.genre,
        voice: state.voice,
        mood: state.mood
      };
      updateGeneratingUI();

      var rawStyle = [state.genre, state.voice, state.mood].filter(Boolean).join(", ");
      var style = rawStyle.substring(0, 200) || "Pop";
      var rawTitle = state.occasion + " song for " + formatRecipients(state.recipients, false);
      var title = rawTitle.substring(0, 80);

      var honeypotEl = root.querySelector("[data-csb-field='hp_website']");
      var honeypot = honeypotEl ? honeypotEl.value : "";

      fetch(apiUrl("/api/suno/generate-music"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lyrics: state.lyrics || "[Verse]\nA beautiful song\n[Chorus]\nFull of love and joy",
          style: style,
          title: title,
          formData: state,
          resumeBaseUrl: window.location.href.split("?")[0],
          turnstileToken: turnstileToken,
          visitorId: visitorId,
          clientIp: fetchedClientIp,
          hp_website: honeypot
        })
      })
        .then(function (res) {
          resetTurnstile();
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (wrapped) {
          if (!wrapped.ok || !wrapped.data.taskId) {
            var errStr = (wrapped.data && wrapped.data.error) || "";
            if (errStr.toLowerCase().indexOf("turnstile") !== -1 || errStr.toLowerCase().indexOf("human verification") !== -1) {
              showTurnstileWidget();
            }
            var startErr = new Error(errStr || "Failed to start music generation");
            startErr.isTimeout = false;
            throw startErr;
          }
          state.taskId = wrapped.data.taskId;
          generationProgress = 5;
          updateGeneratingUI();
          saveProgress();
          return pollStatus(wrapped.data.taskId, "music", function (p) {
            generationProgress = p;
            updateGeneratingUI();
          }, generationProgress);
        })
        .then(function (result) {
          musicTracks = result.tracks || [];
          isAudioReady = !!result.isFullySaved;
          if (!isAudioReady) {
            startBackgroundPolling(state.taskId);
          }
          triggerMetaAdsSongEvent(musicTracks);
          renderTracks();
          goToStep(7);
        })
        .catch(function (err) {
          generationError = err.message;
          generationErrorIsTimeout = !!err.isTimeout;
          updateGeneratingUI();
          saveProgress();
        });
    }

    function triggerMetaAdsSongEvent(tracks) {
      var eventData = {
        occasion: state.occasion || "",
        genre: state.genre || "",
        voice: state.voice || "",
        mood: state.mood || "",
        taskId: state.taskId || ""
      };

      if (typeof window.fbq === "function") {
        try {
          window.fbq("trackCustom", "GenerateSong", eventData);
        } catch (e) {
          console.warn("[Custom Song Builder] Meta Pixel tracking error:", e);
        }
      }

      try {
        var customEvent = new CustomEvent("csb_song_generated", {
          bubbles: true,
          detail: Object.assign({}, eventData, { tracks: tracks || [] })
        });
        window.dispatchEvent(customEvent);
        root.dispatchEvent(customEvent);
      } catch (e) {
        console.warn("[Custom Song Builder] Custom event trigger error:", e);
      }
    }

    function retryAfterTimeout() {
      var btn = $("[data-csb-gen-back]");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Checking...";
      }

      if (!state.taskId) {
        startMusicGeneration();
        return;
      }

      fetch(apiUrl("/api/suno/status?taskId=" + encodeURIComponent(state.taskId) + "&type=music"))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (MUSIC_SUCCESS_STATUSES.indexOf(data.status) !== -1) {
            musicTracks = data.tracks || [];
            isAudioReady = !!data.isFullySaved;
            if (!isAudioReady) {
              startBackgroundPolling(state.taskId);
            }
            renderTracks();
            goToStep(7);
            return;
          }
          if (MUSIC_FAILED_STATUSES.indexOf(data.status) !== -1 || data.failed) {
            startMusicGeneration();
            return;
          }
          generationError = "";
          generationErrorIsTimeout = false;
          updateGeneratingUI();
          pollStatus(state.taskId, "music", function (p) {
            generationProgress = p;
            updateGeneratingUI();
          }, generationProgress)
            .then(function (result) {
              musicTracks = result.tracks || [];
              isAudioReady = !!result.isFullySaved;
              if (!isAudioReady) {
                startBackgroundPolling(state.taskId);
              }
              renderTracks();
              goToStep(7);
            })
            .catch(function (err) {
              generationError = err.message;
              generationErrorIsTimeout = !!err.isTimeout;
              updateGeneratingUI();
              saveProgress();
            });
        })
        .catch(function (err) {
          console.warn("[Custom Song Builder] Status check failed on resume:", err);
          generationError = "Could not check generation status. Please try again.";
          generationErrorIsTimeout = true;
          updateGeneratingUI();
          saveProgress();
        });
    }

    function updateGeneratingUI() {
      var ok = $("[data-csb-generating-ok]");
      var errBox = $("[data-csb-generating-error]");
      var fill = $("[data-csb-gen-progress-fill]");
      var text = $("[data-csb-gen-progress-text]");
      var errText = $("[data-csb-gen-error-text]");
      var backBtn2 = $("[data-csb-gen-back]");

      if (generationError) {
        if (ok) ok.hidden = true;
        if (errBox) errBox.hidden = false;
        if (errText) errText.textContent = generationError;
        if (backBtn2) {
          backBtn2.disabled = false;
          backBtn2.textContent = generationErrorIsTimeout ? "Try Again" : "Go Back & Try Again";
        }
      } else {
        if (ok) ok.hidden = false;
        if (errBox) errBox.hidden = true;
        if (fill) {
          fill.style.width = generationProgress + "%";
          fill.classList.add("is-animating");
        }
        if (text) text.textContent = Math.round(generationProgress) + "%";
      }
    }

    function startBackgroundPolling(taskId) {
      backgroundPollingTaskId = taskId;
      if (backgroundPollTimer) clearInterval(backgroundPollTimer);
      backgroundPollTimer = setInterval(function () {
        fetch(apiUrl("/api/suno/status?taskId=" + encodeURIComponent(taskId) + "&type=music"))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data.isFullySaved) {
              isAudioReady = true;
              backgroundPollingTaskId = null;
              clearInterval(backgroundPollTimer);
              backgroundPollTimer = null;
              saveProgress();
            }
          })
          .catch(function (err) { console.error("Background polling error:", err); });
      }, 5000);
    }

    function goToStep(n) {
      clearToast();
      if (n !== 4) {
        step4ValidationAttempted = false;
      }
      if (n === 6 && musicTracks.length > 0) {
        n = 7;
      }
      state.currentStep = n;
      render();
      if (n === 6) {
        startMusicGeneration();
      }
      if (root) {
        var y = root.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }

    function validateStep(step) {
      if (step === 1 && state.occasionIsOther && !state.customOccasion) {
        showToast({ variant: "warning", title: "Required", message: "Please type in your occasion." });
        return false;
      }
      if (step === 1 && !state.occasion) {
        showToast({ variant: "warning", title: "Required", message: "Please select an occasion." });
        return false;
      }
      if (step === 2) {
        var hasEmpty = state.recipients.some(function (r) { return !r.name.trim(); });
        if (hasEmpty) {
          showToast({ variant: "warning", title: "Required", message: "Please enter a name for all recipients." });
          return false;
        }
      }
      if (step === 3) {
        if (state.creationMethod === "write_for_us") {
          var hasAiLyrics = (lyricsVariations && lyricsVariations.length > 0 && lyricsVariations[0].text && lyricsVariations[0].text.trim().length > 0);
          if (!hasAiLyrics && (!state.storyText || !state.storyText.trim())) {
            showToast({ variant: "warning", title: "Required", message: "Please tell us your story so we can write your lyrics." });
            return false;
          }
        } else if (state.creationMethod === "own_lyrics") {
          var ownVal = (state.ownLyrics || (state.creationMethod === "own_lyrics" ? state.lyrics : "") || "").trim();
          if (!ownVal) {
            showToast({ variant: "warning", title: "Required", message: "Please paste your lyrics." });
            return false;
          }
        }
      }
      if (step === 4) {
        var isMissingStyle = (!state.genre || !state.voice || !state.mood);
        if (isMissingStyle) {
          clearToast();
          step4ValidationAttempted = true;
          renderStyleGroups();
          setTimeout(function () {
            var firstMissingGroup = root.querySelector(".csb-style-group.has-error");
            if (firstMissingGroup) {
              try {
                firstMissingGroup.scrollIntoView({ behavior: "smooth", block: "center" });
              } catch (e) {
                firstMissingGroup.scrollIntoView();
              }
            }
          }, 60);
          return false;
        } else {
          step4ValidationAttempted = false;
          clearToast();
        }
      }
      if (step === 5 && !state.email) {
        showToast({ variant: "warning", title: "Required", message: "Please enter an email address." });
        return false;
      }
      if (step === 5 && state.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)) {
        showToast({ variant: "warning", title: "Invalid email", message: "Please enter a valid email address." });
        return false;
      }
      if (step === 7 && !state.selectedDemo) {
        showToast({ variant: "warning", title: "Required", message: "Please select one of the generated songs." });
        return false;
      }
      if (step === 8 && !state.selectedPackage) {
        showToast({ variant: "warning", title: "Required", message: "Please choose a package." });
        return false;
      }
      return true;
    }

    function generateMusicId() {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
      // Fallback UUID v4 generator for older browsers
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    function buildLineItemProperties(musicId) {
      var chosenTrack = (musicTracks || []).filter(function (t) { return t.id === state.selectedDemo; })[0] || (musicTracks && musicTracks[0]);
      var streamUrl = chosenTrack ? (chosenTrack.streamAudioUrl || chosenTrack.audioUrl || chosenTrack.audio_url || "") : "";

      var props = {
        "_Occasion": state.occasion || "",
        "_Recipients": formatRecipients(state.recipients, true),
        "_Song Title": (function () {
          if (chosenTrack && chosenTrack.title) return chosenTrack.title;
          return state.occasion ? (state.occasion + " song") : "Custom Song";
        })(),
        "_Lyrics": state.lyrics || "",
        "_Lyrics Language": state.lyricsLanguage || "English",
        "_Genre": state.genre || "",
        "_Voice": state.voice || "",
        "_Mood": state.mood || "",
        "_Package": (function () {
          var pkg = (options.packages || []).filter(function (p) { return p.id === state.selectedPackage; })[0];
          return pkg ? (pkg.title || state.selectedPackage) : state.selectedPackage;
        })() || "",
        "Full Song": formatFullDuration(chosenTrack ? (chosenTrack.duration || chosenTrack.audio_duration || chosenTrack.durationSeconds) : ""),
        "_Music_ID": musicId || "",
        "_Audio_Url": streamUrl || ""
      };
      var cleaned = {};
      Object.keys(props).forEach(function (key) {
        if (props[key]) {
          if (key === "_Audio_Url") {
            cleaned[key] = String(props[key]);
          } else {
            cleaned[key] = String(props[key]).substring(0, 500);
          }
        }
      });
      return cleaned;
    }

    function addToShopifyCart(musicId) {
      var targetVariantId = resolveTargetVariantId();

      if (!targetVariantId) {
        return Promise.reject(new Error("The selected package isn't linked to a Shopify product yet. Please link it in the admin panel."));
      }

      var rushPriceText = "";
      var rushPriceBadge = root.querySelector("[data-csb-rush-price]");
      if (rushPriceBadge && rushPriceBadge.textContent.trim()) {
        rushPriceText = rushPriceBadge.textContent.trim();
      }
      var embeddedData = getEmbeddedVariantPrices();
      var pkgVariants = embeddedData.package_variants || {};
      var pkgKey = getPackageKey();
      if (!rushPriceText && pkgKey && pkgVariants[pkgKey] && pkgVariants[pkgKey].rush_price && pkgVariants[pkgKey].default_price) {
        var delta = pkgVariants[pkgKey].rush_price - pkgVariants[pkgKey].default_price;
        if (delta > 0) {
          rushPriceText = formatCurrencyPrice(delta);
        }
      }

      var lineItemProperties = buildLineItemProperties(musicId);
      if (state.rushOrder) {
        lineItemProperties["_Rush Delivery"] = "Yes";
      }

      var items = [
        {
          id: parseInt(targetVariantId, 10),
          quantity: 1,
          properties: lineItemProperties
        }
      ];

      // Single item flow: if a product variant was found for the package (either regular or rush),
      // we do not add a duplicate rush product. We only add standalone rush product if NO rush variant exists for this product.
      var embeddedData = getEmbeddedVariantPrices();
      var pkgVariants = embeddedData.package_variants || {};
      var pkgKey = getPackageKey();
      var selectedCard = root.querySelector('.csb-package-card.is-selected') ||
        root.querySelector('.csb-package-card[data-package-id="' + state.selectedPackage + '"]') ||
        root.querySelector('.csb-package-card[data-csb-package-card="' + state.selectedPackage + '"]');
      var hasPackageRushVariant = (pkgKey && pkgVariants[pkgKey] && pkgVariants[pkgKey].rush_id) || (selectedCard && selectedCard.dataset.rushVariantId);

      var standaloneRushVariantId = root.getAttribute("data-rush-variant-id");
      if (state.rushOrder && !hasPackageRushVariant && standaloneRushVariantId && parseInt(standaloneRushVariantId, 10) !== parseInt(targetVariantId, 10)) {
        items.push({
          id: parseInt(standaloneRushVariantId, 10),
          quantity: 1
        });
      }

      // Dynamic upsells from admin dashboard
      state.selectedUpsells = state.selectedUpsells || {};
      (options.upsells || []).forEach(function (upsell) {
        var uId = upsell.id || ("upsell_" + upsell.type);
        if (state.selectedUpsells[uId]) {
          if (upsell.type === "rush") {
            lineItemProperties["_Rush Delivery"] = "Yes";
            if (upsell.shopifyVariantId && !hasPackageRushVariant && parseInt(upsell.shopifyVariantId, 10) !== parseInt(targetVariantId, 10)) {
              var alreadyAdded = items.some(function (it) { return it.id === parseInt(upsell.shopifyVariantId, 10); });
              if (!alreadyAdded) {
                items.push({
                  id: parseInt(upsell.shopifyVariantId, 10),
                  quantity: 1,
                  properties: {
                    "_Original Song": state.occasion ? (state.occasion + " Song") : "Custom Song",
                    "_Music_ID": musicId || ""
                  }
                });
              }
            }
          } else {
            // Product upsell e.g. "Song on Spotify & Apple Music"
            lineItemProperties[upsell.title] = "Yes";
            lineItemProperties["_Upsell_" + upsell.title] = "Yes";
            if (upsell.shopifyVariantId) {
              var vInt = parseInt(upsell.shopifyVariantId, 10);
              if (!isNaN(vInt) && vInt > 0) {
                items.push({
                  id: vInt,
                  quantity: 1,
                  properties: {
                    "_Original Song": state.occasion ? (state.occasion + " Song") : "Custom Song",
                    "_Music_ID": musicId || "",
                    "streaming_package": upsell.title,
                    "Recipient": formatRecipients(state.recipients, false)
                  }
                });
              }
            }
          }
        }
      });

      return fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ items: items })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            var msg = (data && data.description) || (data && data.message) || "Failed to add product to cart";
            throw new Error(msg);
          }
          if (typeof window.refreshHeaderCartBubble === "function") {
            window.refreshHeaderCartBubble();
          }
          return data;
        });
      });
    }

    function setCheckoutButtonState() {
      if (checkoutSpinner) checkoutSpinner.hidden = !isSubmitting;
      if (checkoutLabel) checkoutLabel.textContent = isSubmitting ? "Processing..." : "Checkout & Pay";
      if (checkoutBtn) checkoutBtn.disabled = isSubmitting;
    }

    function resolveTargetVariantId() {
      var isRush = !!state.rushOrder;

      var pkgIdx = (options.packages || []).findIndex(function (p) {
        return p.id === state.selectedPackage;
      });
      if (pkgIdx >= 0) {
        var pkg = options.packages[pkgIdx];
        if (isRush && pkg && (pkg.shopifyRushVariantId || pkg.rushVariantId)) {
          return String(pkg.shopifyRushVariantId || pkg.rushVariantId);
        }
        if (pkg && pkg.shopifyVariantId) {
          return String(pkg.shopifyVariantId);
        }
      }

      var embeddedData = getEmbeddedVariantPrices();
      var pkgVariants = embeddedData.package_variants || {};
      var pkgKey = getPackageKey();
      if (pkgKey && pkgVariants[pkgKey]) {
        if (isRush && pkgVariants[pkgKey].rush_id) {
          return String(pkgVariants[pkgKey].rush_id);
        }
        if (pkgVariants[pkgKey].default_id) {
          return String(pkgVariants[pkgKey].default_id);
        }
      }

      // 3. Check options.packages for shopifyRushVariantId / shopifyVariantId matching selected package
      var pkgIdx = (options.packages || []).findIndex(function (p) { return p.id === state.selectedPackage; });
      if (pkgIdx >= 0) {
        var pkg = options.packages[pkgIdx];
        if (isRush && pkg && (pkg.shopifyRushVariantId || pkg.rushVariantId)) {
          return String(pkg.shopifyRushVariantId || pkg.rushVariantId);
        }
        if (pkg && pkg.shopifyVariantId) {
          return String(pkg.shopifyVariantId);
        }
      }

      // 4. Check embedded Shopify Liquid product variants by package index (0 -> Standard, 1 -> Pro)
      var productVariantsArr = embeddedData.product_variants || [];
      var targetIdx = pkgIdx >= 0 ? pkgIdx : (state.selectedPackage === "pro" ? 1 : 0);
      if (productVariantsArr[targetIdx] && productVariantsArr[targetIdx].id) {
        return String(productVariantsArr[targetIdx].id);
      }

      // 5. Fallback to section default variantId
      return variantId;
    }

    function submitOrder() {
      if (!resolveTargetVariantId()) {
        showToast({ variant: "error", title: "Configuration Error", message: "The selected package isn't linked to a Shopify product yet. Please contact support." });
        return;
      }

      trackKlaviyoLanguage();

      // Check if cart already has items
      fetch("/cart.js")
        .then(function (res) { return res.json(); })
        .then(function (cartData) {
          if (cartData && cartData.item_count && cartData.item_count > 0) {
            showCartModal(
              function () {
                proceedSubmitOrder("/cart");
              },
              function () {
                proceedSubmitOrder("/checkout");
              }
            );
          } else {
            proceedSubmitOrder("/checkout");
          }
        })
        .catch(function () {
          proceedSubmitOrder("/checkout");
        });
    }

    function proceedSubmitOrder(targetUrl) {
      isSubmitting = true;
      setCheckoutButtonState();

      var musicId = generateMusicId();

      function waitForAudioThenSubmit() {
        return new Promise(function (resolve) {
          if (isAudioReady || !state.taskId) {
            resolve();
            return;
          }
          var attempts = 0;
          var maxAttempts = 30;
          var interval = setInterval(function () {
            attempts++;
            fetch(apiUrl("/api/suno/status?taskId=" + encodeURIComponent(state.taskId) + "&type=music"))
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (data.isFullySaved || attempts >= maxAttempts) {
                  clearInterval(interval);
                  resolve();
                }
              })
              .catch(function (e) {
                console.error("Silent polling error:", e);
                if (attempts >= maxAttempts) {
                  clearInterval(interval);
                  resolve();
                }
              });
          }, 2000);
        });
      }

      waitForAudioThenSubmit()
        .then(function () {
          return fetch(apiUrl("/api/orders"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              formData: state,
              musicTracks: musicTracks,
              taskId: state.taskId,
              musicId: musicId,
              productId: productId,
              variantId: variantId
            })
          });
        })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (wrapped) {
          if (!wrapped.ok) throw new Error(wrapped.data.error || "Failed to save order");
          return addToShopifyCart(musicId);
        })
        .then(function () {
          clearProgress();
          showToast({ variant: "success", title: "Added to cart!", message: "Your custom song has been added to your cart. Redirecting..." });
          setTimeout(function () {
            window.location.href = targetUrl || "/checkout";
          }, 900);
        })
        .catch(function (err) {
          showToast({ variant: "error", title: "Error", message: err.message });
        })
        .finally(function () {
          isSubmitting = false;
          setCheckoutButtonState();
        });
    }

    // ---- Regeneration Modal Controllers & Change Helpers ----
    var lyricsModalOverlay = $("[data-csb-lyrics-modal]");
    var lyricsModalChangedFields = $("[data-csb-lyrics-changed-fields]");
    var lyricsModalStoryInput = $("[data-csb-modal-story-input]");
    var lyricsModalNoBtn = $("[data-csb-lyrics-modal-no]");
    var lyricsModalYesBtn = $("[data-csb-lyrics-modal-yes]");
    var lyricsModalCloseBtn = $("[data-csb-lyrics-modal-close]");

    var musicModalOverlay = $("[data-csb-music-modal]");
    var musicModalChangedStyle = $("[data-csb-music-changed-style]");
    var musicModalNoBtn = $("[data-csb-music-modal-no]");
    var musicModalYesBtn = $("[data-csb-music-modal-yes]");
    var musicModalCloseBtn = $("[data-csb-music-modal-close]");

    function hideLyricsModal() {
      if (lyricsModalOverlay) lyricsModalOverlay.hidden = true;
    }

    function hideMusicModal() {
      if (musicModalOverlay) musicModalOverlay.hidden = true;
    }

    function getLyricsFieldsChanged() {
      if (!lastGeneratedLyricsState) return null;
      var changed = [];
      var occ1 = (state.occasionIsOther ? state.customOccasion : state.occasion) || "";
      var occ2 = (lastGeneratedLyricsState.occasionIsOther ? lastGeneratedLyricsState.customOccasion : lastGeneratedLyricsState.occasion) || "";
      if (occ1.trim().toLowerCase() !== occ2.trim().toLowerCase()) {
        changed.push("Occasion");
      }
      var rec1 = formatRecipients(state.recipients, true);
      var rec2 = formatRecipients(lastGeneratedLyricsState.recipients, true);
      if (rec1.trim().toLowerCase() !== rec2.trim().toLowerCase()) {
        changed.push("Who is this song for?");
      }
      return changed.length > 0 ? changed : null;
    }

    function getMusicStyleFieldsChanged() {
      if (!lastGeneratedMusicState) return null;
      var changed = [];
      if ((state.genre || "") !== (lastGeneratedMusicState.genre || "")) changed.push("Genre");
      if ((state.voice || "") !== (lastGeneratedMusicState.voice || "")) changed.push("Voice");
      if ((state.mood || "") !== (lastGeneratedMusicState.mood || "")) changed.push("Mood");
      return changed.length > 0 ? changed : null;
    }

    function showLyricsRegenModal(changedFields, onNo, onYes) {
      if (!lyricsModalOverlay) {
        if (onYes) onYes();
        return;
      }
      if (lyricsModalChangedFields) {
        lyricsModalChangedFields.textContent = changedFields.join(" & ");
      }
      if (lyricsModalStoryInput) {
        lyricsModalStoryInput.value = state.storyText || "";
      }
      lyricsModalOverlay.hidden = false;

      if (lyricsModalNoBtn) {
        lyricsModalNoBtn.onclick = function () {
          hideLyricsModal();
          if (onNo) onNo();
        };
      }
      if (lyricsModalYesBtn) {
        lyricsModalYesBtn.onclick = function () {
          if (lyricsModalStoryInput) {
            state.storyText = lyricsModalStoryInput.value;
            syncFieldInputs();
          }
          hideLyricsModal();
          if (onYes) onYes();
        };
      }
      if (lyricsModalCloseBtn) {
        lyricsModalCloseBtn.onclick = function () {
          hideLyricsModal();
        };
      }
    }

    function showMusicRegenModal(onNo, onYes) {
      if (!musicModalOverlay) {
        if (onYes) onYes();
        return;
      }
      if (musicModalChangedStyle) {
        var styleText = [state.genre, state.voice, state.mood].filter(Boolean).join(" • ");
        musicModalChangedStyle.textContent = styleText || "New Style";
      }
      musicModalOverlay.hidden = false;

      if (musicModalNoBtn) {
        musicModalNoBtn.onclick = function () {
          hideMusicModal();
          if (onNo) onNo();
        };
      }
      if (musicModalYesBtn) {
        musicModalYesBtn.onclick = function () {
          hideMusicModal();
          if (onYes) onYes();
        };
      }
      if (musicModalCloseBtn) {
        musicModalCloseBtn.onclick = function () {
          hideMusicModal();
        };
      }
    }

    var refreshModalOverlay = $("[data-csb-refresh-modal]");
    var refreshModalCloseBtn = $("[data-csb-refresh-modal-close]");
    var refreshModalNewBtn = $("[data-csb-refresh-modal-new]");
    var refreshModalKeepBtn = $("[data-csb-refresh-modal-keep]");

    function showRefreshModal(onNew, onKeep) {
      if (!refreshModalOverlay) {
        if (onKeep) onKeep();
        return;
      }
      refreshModalOverlay.hidden = false;
      if (refreshModalCloseBtn) {
        refreshModalCloseBtn.onclick = function () {
          refreshModalOverlay.hidden = true;
          if (onKeep) onKeep();
        };
      }
      if (refreshModalNewBtn) {
        refreshModalNewBtn.onclick = function () {
          refreshModalOverlay.hidden = true;
          if (onNew) onNew();
        };
      }
      if (refreshModalKeepBtn) {
        refreshModalKeepBtn.onclick = function () {
          refreshModalOverlay.hidden = true;
          if (onKeep) onKeep();
        };
      }
    }

    var cartModalOverlay = $("[data-csb-cart-modal]");
    var cartModalCloseBtn = $("[data-csb-cart-modal-close]");
    var cartModalViewBtn = $("[data-csb-cart-modal-view]");
    var cartModalKeepBtn = $("[data-csb-cart-modal-keep]");

    function showCartModal(onViewCart, onKeepMultiple) {
      if (!cartModalOverlay) {
        if (onKeepMultiple) onKeepMultiple();
        return;
      }
      cartModalOverlay.hidden = false;
      if (cartModalCloseBtn) {
        cartModalCloseBtn.onclick = function () {
          cartModalOverlay.hidden = true;
        };
      }
      if (cartModalViewBtn) {
        cartModalViewBtn.onclick = function () {
          cartModalOverlay.hidden = true;
          if (onViewCart) onViewCart();
        };
      }
      if (cartModalKeepBtn) {
        cartModalKeepBtn.onclick = function () {
          cartModalOverlay.hidden = true;
          if (onKeepMultiple) onKeepMultiple();
        };
      }
    }

    function handleNext() {
      if (!validateStep(state.currentStep)) return;

      // Step 2: Check for field changes (Occasion from Step 1 or Recipients from Step 2) after AI lyrics generation
      if (state.currentStep === 2) {
        var hasAiLyrics = (lyricsVariations && lyricsVariations.length > 0 && lyricsVariations[0].text && lyricsVariations[0].text.trim().length > 0);
        if (hasAiLyrics && state.creationMethod === "write_for_us") {
          var changedLyricsFields = getLyricsFieldsChanged();
          if (changedLyricsFields) {
            showLyricsRegenModal(
              changedLyricsFields,
              function () {
                if (lastGeneratedLyricsState) {
                  state.occasion = lastGeneratedLyricsState.occasion || "";
                  state.occasionIsOther = !!lastGeneratedLyricsState.occasionIsOther;
                  state.customOccasion = lastGeneratedLyricsState.customOccasion || "";
                  if (lastGeneratedLyricsState.recipients) {
                    state.recipients = JSON.parse(JSON.stringify(lastGeneratedLyricsState.recipients));
                  }
                  state.storyText = lastGeneratedLyricsState.storyText || "";
                  renderOccasions();
                  renderRecipients();
                  syncFieldInputs();
                  saveProgress();
                }
                goToStep(3);
              },
              function () {
                musicTracks = [];
                state.taskId = "";
                goToStep(3);
                generateLyrics();
              }
            );
            return;
          }
        }
      }

      // Step 3: Next Step Action (Generate lyrics if needed, or advance to Step 4 Style)
      if (state.currentStep === 3) {
        if (state.creationMethod === "write_for_us") {
          // If currently editing inside variations grid, sync before checking
          var editingTextarea = root.querySelector("[data-csb-variations-grid] textarea");
          if (editingTextarea && editingTextarea.style.display !== "none") {
            var currVal = editingTextarea.value.trim();
            if (!currVal) {
              lyricsVariations = [];
              state.generatedLyrics = "";
              state.lyrics = "";
              renderLyricsVariations();
            } else if (lyricsVariations[0]) {
              lyricsVariations[0].text = editingTextarea.value;
              state.generatedLyrics = editingTextarea.value;
              state.lyrics = editingTextarea.value;
            }
          }

          var hasValidAiLyrics = (lyricsVariations && lyricsVariations.length > 0 && lyricsVariations[0].text && lyricsVariations[0].text.trim().length > 0);
          if (!hasValidAiLyrics) {
            if (state.storyText && state.storyText.trim()) {
              generateLyrics();
              return;
            } else {
              showToast({ variant: "warning", title: "Required", message: "Please tell us your story so we can write your lyrics." });
              return;
            }
          }
          state.lyrics = lyricsVariations[0].text.trim();
        } else if (state.creationMethod === "own_lyrics") {
          var ownVal = (state.ownLyrics || (state.creationMethod === "own_lyrics" ? state.lyrics : "") || "").trim();
          if (!ownVal) {
            showToast({ variant: "warning", title: "Required", message: "Please paste your lyrics." });
            return;
          }
          state.lyrics = ownVal;
        }
        goToStep(4);
        return;
      }

      // Step 4: Music Style
      if (state.currentStep === 4) {
        if (musicTracks && musicTracks.length > 0) {
          var changedStyleFields = getMusicStyleFieldsChanged();
          if (changedStyleFields) {
            showMusicRegenModal(
              changedStyleFields,
              function () {
                if (lastGeneratedMusicState) {
                  state.genre = lastGeneratedMusicState.genre || "";
                  state.voice = lastGeneratedMusicState.voice || "";
                  state.mood = lastGeneratedMusicState.mood || "";
                  renderStyleGroups();
                  saveProgress();
                }
                goToStep(5);
              },
              function () {
                musicTracks = [];
                state.taskId = "";
                lastGeneratedMusicState = {
                  genre: state.genre,
                  voice: state.voice,
                  mood: state.mood
                };
                saveProgress();
                resetTurnstile();
                goToStep(5);
              }
            );
            return;
          }
        }
        goToStep(5);
        return;
      }

      // Step 5: Email step
      if (state.currentStep === 5) {
        var userEmail = state.email;
        var emailErrorEl = root.querySelector("[data-csb-email-error]");
        if (emailErrorEl) emailErrorEl.hidden = true;

        fetch(apiUrl("/api/customers/associate-ip"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, clientIp: fetchedClientIp })
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data.isBlocked || data.error) {
              if (emailErrorEl) {
                emailErrorEl.textContent = data.error || "Your account has been restricted from generating music.";
                emailErrorEl.hidden = false;
              }
              showToast({ variant: "error", title: "Access Restricted", message: data.error || "Your account has been restricted from generating music." });
              return;
            }
            goToStep(6);
          })
          .catch(function () {
            goToStep(6);
          });
        return;
      }

      if (state.currentStep < 8) {
        var nextStep = state.currentStep + 1;
        goToStep(nextStep);
      }
    }

    function handleBack() {
      clearToast();
      if (state.currentStep <= 1) return;
      var target = state.currentStep - 1;
      if (target === 6) target = 5;
      goToStep(target);
    }

    // ---- Event wiring ----
    root.addEventListener("input", function (e) {
      var field = e.target.getAttribute && e.target.getAttribute("data-csb-field");
      if (!field) return;


      if (field === "customOccasion") {
        state.customOccasion = e.target.value;
        state.occasion = e.target.value;
        saveProgress();
        return;
      }
      if (field === "lyricsLanguage") {
        state.lyricsLanguage = e.target.value;
        trackKlaviyoLanguage();
      }
      if (e.target.type === "checkbox") {
        state[field] = e.target.checked;
      } else {
        state[field] = e.target.value;
      }

      if (field === "lyrics" || field === "ownLyrics") {
        state.ownLyrics = e.target.value;
        if (state.creationMethod === "own_lyrics") {
          state.lyrics = e.target.value;
        }
        musicTracks = [];
        state.taskId = "";
      }

      if (field === "storyText") {
        setLyricsButtonState();
      }

      if (field === "rushOrder") {
        renderSummary();
        renderPackages();
      }
      if (field === "agreeTerms") {
        setCheckoutButtonState();
      }

      if (field === "email") {
        setEmailLockState();
      }

      saveProgress();
    });

    root.addEventListener("change", function (e) {
      var field = e.target.getAttribute && e.target.getAttribute("data-csb-field");
      if (!field) return;

      if (e.target.type === "checkbox") {
        state[field] = e.target.checked;
      } else {
        state[field] = e.target.value;
      }

      if (field === "customOccasion") {
        state.customOccasion = e.target.value;
        state.occasion = e.target.value;
        saveProgress();
        return;
      }
      if (field === "lyricsLanguage") {
        state.lyricsLanguage = e.target.value;
        trackKlaviyoLanguage();
      }
      if (field === "rushOrder") {
        renderSummary();
        renderPackages();
      }
      if (field === "agreeTerms") {
        setCheckoutButtonState();
      }
      saveProgress();
    });

    $$("[data-csb-method]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.creationMethod = btn.getAttribute("data-csb-method");
        renderMethodCards();

        if (state.creationMethod === "write_for_us") {
          var hasAiLyrics = (lyricsVariations && lyricsVariations.length > 0 && lyricsVariations[0].text && lyricsVariations[0].text.trim().length > 0);
          state.lyrics = hasAiLyrics ? lyricsVariations[0].text.trim() : "";
          renderLyricsVariations();
        } else if (state.creationMethod === "own_lyrics") {
          state.lyrics = (state.ownLyrics || "").trim();
        }

        setLyricsButtonState();
        saveProgress();

        setTimeout(function () {
          var activePanel = root.querySelector('[data-csb-panel="' + state.creationMethod + '"]');
          if (activePanel) {
            activePanel.scrollIntoView({ behavior: "smooth", block: "center" });
            var targetInput = activePanel.querySelector("textarea, input");
            if (targetInput) {
              targetInput.focus();
            }
          }
        }, 120);
      });
    });

    var generateBtn = $("[data-csb-generate-lyrics]");
    if (generateBtn) generateBtn.addEventListener("click", generateLyrics);
    var generateAgainBtn = $("[data-csb-generate-lyrics-again]");
    if (generateAgainBtn) generateAgainBtn.addEventListener("click", generateLyrics);

    var genBackBtn = $("[data-csb-gen-back]");
    if (genBackBtn) {
      genBackBtn.addEventListener("click", function () {
        if (generationErrorIsTimeout) {
          retryAfterTimeout();
        } else {
          goToStep(5);
        }
      });
    }

    var regenSongsBtn = $("[data-csb-regen-songs]");
    if (regenSongsBtn) {
      regenSongsBtn.addEventListener("click", function () {
        musicTracks = [];
        state.taskId = "";
        generationError = "";
        generationErrorIsTimeout = false;
        resetTurnstile();
        goToStep(6);
      });
    }


    var addRecBtn = $("[data-csb-add-recipient]");
    if (addRecBtn) {
      addRecBtn.addEventListener("click", function () {
        state.recipients.push({ name: "", pronunciationMode: "Original", pronunciation: "" });
        renderRecipients();
        saveProgress();
      });
    }

    if (backBtn) backBtn.addEventListener("click", handleBack);
    if (nextBtn) nextBtn.addEventListener("click", handleNext);
    if (checkoutBtn) checkoutBtn.addEventListener("click", submitOrder);

    function resumeInFlightGeneration(saved) {
      if (!saved) return;

      if (saved.lyricsLoading && saved.pendingLyricsTaskId && !state.lyrics) {
        pendingLyricsTaskId = saved.pendingLyricsTaskId;
        lyricsLoading = true;
        lyricsError = "";
        setLyricsButtonState();
        pollStatus(pendingLyricsTaskId, "lyrics", null)
          .then(function (result) {
            if (result.allVariations && result.allVariations.length > 0) {
              lyricsVariations = result.allVariations;
              selectedLyricsIndex = 0;
              state.lyrics = result.allVariations[0].text;
              renderLyricsVariations();
            } else if (result.lyrics) {
              state.lyrics = result.lyrics;
              syncFieldInputs();
            }
          })
          .catch(function (err) {
            lyricsError = err.message;
          })
          .finally(function () {
            lyricsLoading = false;
            pendingLyricsTaskId = null;
            setLyricsButtonState();
            saveProgress();
          });
      }

      if ((state.currentStep === 6 || state.currentStep === 7) && musicTracks.length === 0) {
        updateGeneratingUI();
        if (state.taskId) {
          retryAfterTimeout();
        } else if (state.currentStep === 6) {
          startMusicGeneration();
        }
      }

      if (saved.backgroundPollingTaskId && !saved.isAudioReady) {
        startBackgroundPolling(saved.backgroundPollingTaskId);
      }
    }

    // ---- Init ----
    if (!backendUrl || backendUrl.indexOf("YOUR_BACKEND_URL") !== -1) {
      console.warn("[Custom Song Builder] Backend URL is not configured. Set it in the section settings (theme editor) before going live.");
    }
    if (!variantId) {
      console.info("[Custom Song Builder] No page product detected — that's fine as long as every package is linked to a Shopify product/variant in the admin panel.");
    }

    var urlParams = new URLSearchParams(window.location.search);
    var resumeOrder = urlParams.get("resumeOrder");

    if (resumeOrder) {
      var newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: newUrl }, '', newUrl);

      fetch(apiUrl("/api/orders/" + encodeURIComponent(resumeOrder)))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.success && data.order) {
            var order = data.order;

            // Check if already purchased
            if (["paid", "completed", "refunded", "partially_refunded", "authorized"].indexOf(order.status) !== -1) {
              var topHeader = root.querySelector('.csb-card-top-header');
              var progressWrap = root.querySelector('[data-csb-progress-wrap]');
              var stepsContainer = root.querySelector('.csb-steps-container');
              var navWrap = root.querySelector('[data-csb-nav]');
              var purchasedView = root.querySelector('[data-csb-purchased-view]');

              if (topHeader) topHeader.hidden = true;
              if (progressWrap) progressWrap.hidden = true;
              if (stepsContainer) stepsContainer.hidden = true;
              if (navWrap) navWrap.hidden = true;
              if (purchasedView) purchasedView.hidden = false;

              showToast({ variant: "info", title: "Already Purchased", message: "You have already purchased this custom song." });
              return;
            }

            // Override state with fetched data
            // 1. Occasion
            state.occasion = order.occasion || (order.formData && order.formData.occasion) || "";
            if (!state.occasion && order.musicTracks && order.musicTracks[0] && order.musicTracks[0].title) {
              var occMatch = order.musicTracks[0].title.match(/^(.+?)\s+song\s+for/i);
              if (occMatch && occMatch[1]) {
                state.occasion = occMatch[1].trim();
              }
            }

            // 2. Recipients
            var resolvedRecipients = null;
            if (order.recipients && Array.isArray(order.recipients) && order.recipients.length > 0 && order.recipients[0].name && order.recipients[0].name.trim()) {
              resolvedRecipients = order.recipients;
            } else if (order.formData && Array.isArray(order.formData.recipients) && order.formData.recipients.length > 0 && order.formData.recipients[0].name && order.formData.recipients[0].name.trim()) {
              resolvedRecipients = order.formData.recipients;
            } else if (order.recipientName && order.recipientName.trim()) {
              resolvedRecipients = [{ name: order.recipientName.trim(), pronunciationMode: "Original", pronunciation: "" }];
            } else if (order.formData && order.formData.recipientName && order.formData.recipientName.trim()) {
              resolvedRecipients = [{ name: order.formData.recipientName.trim(), pronunciationMode: "Original", pronunciation: "" }];
            } else {
              // Infer from track title e.g. "Birthday song for hello" -> "hello"
              var trackTitle = (order.musicTracks && order.musicTracks[0] && order.musicTracks[0].title) || "";
              var match = trackTitle.match(/\s+for\s+(.+)$/i);
              if (match && match[1] && match[1].trim()) {
                resolvedRecipients = [{ name: match[1].trim(), pronunciationMode: "Original", pronunciation: "" }];
              } else {
                resolvedRecipients = [{ name: "", pronunciationMode: "Original", pronunciation: "" }];
              }
            }
            state.recipients = resolvedRecipients;

            // 3. Lyrics
            var resolvedLyrics = (
              order.lyrics ||
              order.generatedLyrics ||
              (order.formData && (order.formData.lyrics || order.formData.generatedLyrics)) ||
              (order.musicTracks && order.musicTracks.find(function (t) { return t.lyrics && t.lyrics.trim().length > 0; }) && order.musicTracks.find(function (t) { return t.lyrics && t.lyrics.trim().length > 0; }).lyrics) ||
              (order.musicTracks && order.musicTracks[0] && order.musicTracks[0].lyrics) ||
              ""
            ).trim();

            state.lyrics = resolvedLyrics;
            state.generatedLyrics = resolvedLyrics;

            if (resolvedLyrics) {
              lyricsVariations = [{ title: "Generated Lyrics", text: resolvedLyrics }];
              selectedLyricsIndex = 0;
            }

            // 4. Creation Method & Story Text & Own Lyrics
            state.creationMethod = order.creationMethod || (order.formData && order.formData.creationMethod) || "write_for_us";
            state.storyText = order.storyText || (order.formData && order.formData.storyText) || "";
            state.ownLyrics = order.ownLyrics || (order.formData && order.formData.ownLyrics) || (state.creationMethod === "own_lyrics" ? resolvedLyrics : "");

            // 5. Music Styles & Email
            state.genre = order.genre || (order.formData && order.formData.genre) || "";
            state.voice = order.voice || (order.formData && order.formData.voice) || "";
            state.mood = order.mood || (order.formData && order.formData.mood) || "";
            state.email = order.email || (order.formData && order.formData.email) || "";
            state.taskId = order.taskId || "";

            // 6. Selected Demo & Package
            if (order.selectedDemo) state.selectedDemo = order.selectedDemo;
            if (order.selectedPackage) state.selectedPackage = order.selectedPackage;

            // 7. Set music tracks
            if (order.musicTracks && order.musicTracks.length > 0) {
              musicTracks = order.musicTracks;
              isAudioReady = true;
              if (!state.selectedDemo) {
                state.selectedDemo = order.musicTracks[0].id;
              }
            }

            // 8. Sync generation state trackers
            lastGeneratedLyricsState = {
              occasion: state.occasion,
              occasionIsOther: state.occasionIsOther,
              customOccasion: state.customOccasion,
              recipients: JSON.parse(JSON.stringify(state.recipients)),
              storyText: state.storyText
            };
            lastGeneratedMusicState = {
              genre: state.genre,
              voice: state.voice,
              mood: state.mood
            };

            // Start user at Step 7 to select their song
            state.currentStep = 7;

            // Re-render and save to local storage
            fetchOptions();
            render();
            renderLyricsVariations();
            renderTracks();
            setLyricsButtonState();
            setCheckoutButtonState();
            saveProgress();
          } else {
            console.error("[Custom Song Builder] Could not resume order:", data.error);
            fallbackInit();
          }
        })
        .catch(function (err) {
          console.error("[Custom Song Builder] Failed to fetch resumed order:", err);
          fallbackInit();
        });
    } else {
      fallbackInit();
    }

    function fallbackInit() {

      // Restore any progress saved before a reload / tab close.
      var savedProgress = loadProgress();
      var hasSavedData = savedProgress && savedProgress.state && (
        savedProgress.state.occasion ||
        savedProgress.state.storyText ||
        savedProgress.state.lyrics ||
        (savedProgress.state.currentStep && savedProgress.state.currentStep > 1)
      );

      function applySavedState(saved) {
        if (!saved || !saved.state) return;
        Object.keys(state).forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(saved.state, key)) {
            state[key] = saved.state[key];
          }
        });
        if (!state.lyricsLanguage) {
          state.lyricsLanguage = (saved.state && saved.state.lyricsLanguage) || detectLanguageFromUrl() || "Dutch";
        }
        lyricsVariations = (saved.lyricsVariations || []).filter(function (v) {
          return v && v.text && v.text.trim().length > 0;
        });
        if (lyricsVariations.length === 0 && (state.lyrics || state.generatedLyrics)) {
          var fallbackText = (state.lyrics || state.generatedLyrics || "").trim();
          if (fallbackText) {
            lyricsVariations = [{ title: "Generated Lyrics", text: fallbackText }];
          }
        }
        selectedLyricsIndex = (typeof saved.selectedLyricsIndex === "number") ? saved.selectedLyricsIndex : null;
        musicTracks = saved.musicTracks || [];
        isAudioReady = (typeof saved.isAudioReady === "boolean") ? saved.isAudioReady : true;
        if (saved.generationProgress) {
          generationProgress = saved.generationProgress;
        }
        lastGeneratedLyricsState = saved.lastGeneratedLyricsState || null;
        lastGeneratedMusicState = saved.lastGeneratedMusicState || null;
      }

      function initAndRender(savedToResume) {
        fetchOptions();
        render();
        renderLyricsVariations();
        renderTracks();
        setLyricsButtonState();
        setCheckoutButtonState();
        if (savedToResume) {
          resumeInFlightGeneration(savedToResume);
          if (state.taskId && musicTracks.length > 0) {
            fetch(apiUrl("/api/suno/status?taskId=" + encodeURIComponent(state.taskId) + "&type=music"))
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (data.status === "SUCCESS" && data.tracks && data.tracks.length > 0) {
                  musicTracks = data.tracks;
                  renderTracks();
                  saveProgress();
                }
              })
              .catch(function (e) { console.warn("[Custom Song Builder] Failed to refresh track URLs:", e); });
          }
        }
      }

      if (hasSavedData) {
        showRefreshModal(
          function () {
            // Start a new song
            clearProgress();
            state.currentStep = 1;
            state.occasion = "";
            state.recipients = [{ name: "", pronunciationMode: "Original", pronunciation: "" }];
            state.storyText = "";
            state.lyrics = "";
            state.lyricsLanguage = detectLanguageFromUrl();
            musicTracks = [];
            lyricsVariations = [];
            state.taskId = "";
            initAndRender(null);
          },
          function () {
            // Keep current song
            applySavedState(savedProgress);
            initAndRender(savedProgress);
          }
        );
      } else {
        initAndRender(null);
      }
    }
  }

  function initAll() {
    document.querySelectorAll(".csb-wrapper").forEach(function (root) {
      if (root.dataset.csbInitialized) return;
      root.dataset.csbInitialized = "true";
      initSection(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  // Re-init when sections are added/removed in the theme editor
  document.addEventListener("shopify:section:load", function (e) {
    var root = e.target.querySelector ? e.target.querySelector(".csb-wrapper") : null;
    if (root && !root.dataset.csbInitialized) {
      root.dataset.csbInitialized = "true";
      initSection(root);
    }
  });
})();
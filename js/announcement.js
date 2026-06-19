/*
 * IOI Oleochemical – Announcement modal
 *
 * Fetches csrEvent entries flagged with announcement=true from Contentful
 * and renders a dismissable slider modal on the home page.
 *
 * Depends on window.CONTENTFUL_* globals set by cms-config.js (loaded before this
 * script via defer, so globals are available when this runs).
 *
 * Behaviour:
 *   - Only runs on /en/ and /cn/ home pages.
 *   - Dismissed state is stored in sessionStorage; modal won't reappear
 *     until the user closes the tab/browser.
 *   - Backdrop click or × button closes the modal.
 *   - Multiple announcements render as a slider (prev/next + dot indicators).
 *   - Locale-aware: reads zh-CN fields with en-US fallback on the /cn/ page.
 */
(function () {
  "use strict";

  var SESSION_KEY = "ioi-ann-dismissed";

  // Only run on home pages — match regardless of any leading repo/subfolder prefix
  var path = window.location.pathname.replace(/\/+$/, "");
  var isHome =
    path === "" ||
    /\/(en|cn)(\/index\.html)?$/.test(path);
  if (!isHome) return;

  // Skip if already dismissed this session
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
  } catch (e) {}

  var SPACE_ID = window.CONTENTFUL_SPACE_ID;
  var ACCESS_TOKEN = window.CONTENTFUL_ACCESS_TOKEN;
  var ENVIRONMENT = window.CONTENTFUL_ENVIRONMENT || "master";

  if (!SPACE_ID || !ACCESS_TOKEN) return;

  // ---------------------------------------------------------------------------
  // Locale
  // ---------------------------------------------------------------------------

  function detectLocale() {
    var lang = document.documentElement.lang;
    var isChinese =
      lang === "zh-CN" || lang === "zh-Hans" ||
      window.location.pathname.indexOf("/cn/") !== -1;
    return isChinese ? "zh-CN" : "en-US";
  }

  // Contentful returns locale maps when locale=* is requested.
  // Pick the preferred locale value, falling back to en-US.
  function pick(v, locale) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    if (!Object.prototype.hasOwnProperty.call(v, "en-US")) return v;
    var pref = v[locale];
    if (pref != null && pref !== "") return pref;
    var fb = v["en-US"];
    return fb != null ? fb : null;
  }

  function getAssetUrl(asset, locale, isCN) {
    if (!asset || !asset.fields) return null;
    var file = asset.fields.file;
    if (isCN) file = pick(file, locale);
    if (!file) return null;
    var url = file.url;
    return url ? (url.indexOf("//") === 0 ? "https:" + url : url) : null;
  }

  // ---------------------------------------------------------------------------
  // Build slide data from Contentful response
  // ---------------------------------------------------------------------------

  function buildSlides(items, assets, linkedEntries, locale) {
    var isCN = locale !== "en-US";
    var prefix = "detail_csr.html?slug=";

    return items.map(function (item) {
      var f = item.fields || {};

      function field(key) {
        var v = f[key];
        return isCN ? pick(v, locale) : v;
      }

      // Tags
      var tagLinks = field("csrTag");
      var tags = [];
      if (Array.isArray(tagLinks)) {
        tagLinks.forEach(function (link) {
          if (!link || !link.sys) return;
          var entry = linkedEntries[link.sys.id];
          if (!entry) return;
          var tagName = entry.fields && entry.fields.name;
          if (isCN) tagName = pick(tagName, locale);
          if (tagName) tags.push(String(tagName));
        });
      }

      // Thumbnail
      var thumbLink = field("csrThumb");
      var thumbUrl = "";
      if (thumbLink && thumbLink.sys) {
        var asset = assets[thumbLink.sys.id];
        thumbUrl = getAssetUrl(asset, locale, isCN) || "";
      }

      var slug = field("slug") || "";

      return {
        name: field("name") || "",
        snippet: field("csrSnippet") || "",
        thumbUrl: thumbUrl,
        tags: tags,
        href: prefix + encodeURIComponent(slug),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Escape helpers
  // ---------------------------------------------------------------------------

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Styles (injected once)
  // ---------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById("ioi-ann-css")) return;
    var s = document.createElement("style");
    s.id = "ioi-ann-css";
    s.textContent = [
      "#ioi-ann-backdrop{",
        "position:fixed;inset:0;z-index:99999;",
        "background:rgba(2,3,7,.6);",
        "display:flex;align-items:center;justify-content:center;",
        "padding:16px;",
        "animation:ioi-ann-fade .25s ease;",
      "}",
      "@keyframes ioi-ann-fade{from{opacity:0}to{opacity:1}}",

      "#ioi-ann-modal{",
        "background:#fff;border-radius:8px;",
        "width:100%;max-width:560px;",
        "box-shadow:0 20px 60px rgba(2,3,7,.35);",
        "overflow:hidden;position:relative;",
        "max-height:90vh;display:flex;flex-direction:column;",
      "}",

      "#ioi-ann-close{",
        "position:absolute;top:12px;right:12px;z-index:2;",
        "width:36px;height:36px;border-radius:50%;",
        "background:rgba(255,255,255,.85);border:none;cursor:pointer;",
        "display:flex;align-items:center;justify-content:center;",
        "transition:background .15s;padding:0;",
        "box-shadow:0 1px 4px rgba(2,3,7,.25);",
      "}",
      "#ioi-ann-close:hover{background:rgba(255,255,255,1)}",

      ".ioi-ann-thumb{",
        "width:100%;aspect-ratio:16/9;",
        "object-fit:cover;display:block;background:#d2d8e9;",
        "flex-shrink:0;",
      "}",

      ".ioi-ann-body{",
        "padding:24px 24px 20px;overflow-y:auto;",
      "}",

      ".ioi-ann-tags{",
        "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;",
      "}",

      ".ioi-ann-tag{",
        "font-size:11px;font-family:Inter,sans-serif;",
        "color:#1f3c92;background:#e8ebf4;",
        "border-radius:4px;padding:3px 8px;",
        "font-weight:600;letter-spacing:.04em;text-transform:uppercase;",
      "}",

      ".ioi-ann-title{",
        "font-family:'EB Garamond',Georgia,serif;",
        "font-size:22px;line-height:1.3;color:#020307;",
        "margin:0 0 10px;",
      "}",

      ".ioi-ann-snippet{",
        "font-family:Inter,sans-serif;",
        "font-size:14px;line-height:1.65;color:#4d4e51;",
        "margin:0 0 18px;",
      "}",

      /* .ioi-ann-cta inherits all styles from the site's .button class */

      "#ioi-ann-nav{",
        "display:flex;align-items:center;justify-content:space-between;",
        "padding:12px 20px 14px;border-top:1px solid #e8ebf4;",
        "flex-shrink:0;",
      "}",

      ".ioi-ann-arr{",
        "width:32px;height:32px;border-radius:50%;",
        "border:1px solid #d2d8e9;background:#fff;",
        "cursor:pointer;display:flex;align-items:center;justify-content:center;",
        "transition:background .15s,border-color .15s;padding:0;",
      "}",
      ".ioi-ann-arr:hover:not(:disabled){background:#e8ebf4;border-color:#1f3c92}",
      ".ioi-ann-arr:disabled{opacity:.35;cursor:default}",

      ".ioi-ann-dots{display:flex;gap:7px;align-items:center}",

      ".ioi-ann-dot{",
        "width:7px;height:7px;border-radius:50%;",
        "background:#d2d8e9;border:none;cursor:pointer;padding:0;",
        "transition:background .15s,transform .15s;",
      "}",
      ".ioi-ann-dot.ioi-ann-dot--active{background:#1f3c92;transform:scale(1.3)}",
    ].join("");
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // Render modal
  // ---------------------------------------------------------------------------

  function renderModal(slides, locale) {
    var isCN = locale !== "en-US";
    var labelLearnMore = isCN ? "了解更多" : "Learn More";
    var labelClose = isCN ? "关闭" : "Close";
    var labelPrev = isCN ? "上一张" : "Previous";
    var labelNext = isCN ? "下一张" : "Next";
    var labelAnnouncement = isCN ? "公告" : "Announcement";
    var labelSlide = isCN ? "幻灯片 " : "Slide ";

    var total = slides.length;
    var cur = 0;

    // --- Backdrop ---
    var backdrop = document.createElement("div");
    backdrop.id = "ioi-ann-backdrop";

    // --- Modal shell ---
    var modal = document.createElement("div");
    modal.id = "ioi-ann-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", labelAnnouncement);

    // --- Close button ---
    var closeBtn = document.createElement("button");
    closeBtn.id = "ioi-ann-close";
    closeBtn.setAttribute("aria-label", labelClose);
    closeBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 1L1 13M1 1L13 13" stroke="#020307" stroke-width="2" stroke-linecap="round"/>' +
      "</svg>";

    // --- Slide content container ---
    var content = document.createElement("div");
    content.id = "ioi-ann-content";

    function buildSlideHTML(s) {
      var tagsHTML = s.tags
        .map(function (t) {
          return '<span class="ioi-ann-tag">' + esc(t) + "</span>";
        })
        .join("");

      return (
        (s.thumbUrl
          ? '<img class="ioi-ann-thumb" src="' +
            escAttr(s.thumbUrl) +
            '" alt="" loading="lazy">'
          : "") +
        '<div class="ioi-ann-body">' +
        (s.tags.length ? '<div class="ioi-ann-tags">' + tagsHTML + "</div>" : "") +
        '<h3 class="ioi-ann-title">' +
        esc(s.name) +
        "</h3>" +
        '<p class="ioi-ann-snippet">' +
        esc(s.snippet) +
        "</p>" +
        '<a class="button" href="' +
        escAttr(s.href) +
        '">' +
        labelLearnMore +
        "</a>" +
        "</div>"
      );
    }

    content.innerHTML = buildSlideHTML(slides[cur]);
    modal.appendChild(closeBtn);
    modal.appendChild(content);

    // --- Nav (only when multiple slides) ---
    var prevBtn, nextBtn, dotEls;
    if (total > 1) {
      var nav = document.createElement("div");
      nav.id = "ioi-ann-nav";

      prevBtn = document.createElement("button");
      prevBtn.className = "ioi-ann-arr";
      prevBtn.setAttribute("aria-label", labelPrev);
      prevBtn.innerHTML =
        '<svg width="8" height="13" viewBox="0 0 8 13" fill="none">' +
        '<path d="M7 1L1 6.5L7 12" stroke="#020307" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>";

      var dotsEl = document.createElement("div");
      dotsEl.className = "ioi-ann-dots";
      dotEls = [];
      for (var i = 0; i < total; i++) {
        (function (idx) {
          var dot = document.createElement("button");
          dot.className =
            "ioi-ann-dot" + (idx === 0 ? " ioi-ann-dot--active" : "");
          dot.setAttribute("aria-label", labelSlide + (idx + 1));
          dot.addEventListener("click", function () {
            goTo(idx);
          });
          dotsEl.appendChild(dot);
          dotEls.push(dot);
        })(i);
      }

      nextBtn = document.createElement("button");
      nextBtn.className = "ioi-ann-arr";
      nextBtn.setAttribute("aria-label", labelNext);
      nextBtn.innerHTML =
        '<svg width="8" height="13" viewBox="0 0 8 13" fill="none">' +
        '<path d="M1 1L7 6.5L1 12" stroke="#020307" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>";

      prevBtn.addEventListener("click", function () {
        goTo(cur - 1);
      });
      nextBtn.addEventListener("click", function () {
        goTo(cur + 1);
      });

      nav.appendChild(prevBtn);
      nav.appendChild(dotsEl);
      nav.appendChild(nextBtn);
      modal.appendChild(nav);

      syncNav();
    }

    function goTo(idx) {
      cur = Math.max(0, Math.min(total - 1, idx));
      content.innerHTML = buildSlideHTML(slides[cur]);
      if (total > 1) syncNav();
    }

    function syncNav() {
      prevBtn.disabled = cur === 0;
      nextBtn.disabled = cur === total - 1;
      dotEls.forEach(function (d, i) {
        d.classList.toggle("ioi-ann-dot--active", i === cur);
      });
    }

    // --- Dismiss helpers ---
    function dismiss() {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch (e) {}
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    closeBtn.addEventListener("click", dismiss);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) dismiss();
    });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") {
        dismiss();
        document.removeEventListener("keydown", onKey);
      }
      if (total > 1) {
        if (e.key === "ArrowLeft") goTo(cur - 1);
        if (e.key === "ArrowRight") goTo(cur + 1);
      }
    });

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    closeBtn.focus();
  }

  // ---------------------------------------------------------------------------
  // Fetch & initialise
  // ---------------------------------------------------------------------------

  function init() {
    var locale = detectLocale();
    var fetchLocale = locale !== "en-US" ? "*" : locale;

    var qs = [
      "access_token=" + encodeURIComponent(ACCESS_TOKEN),
      "content_type=csrEvent",
      "locale=" + encodeURIComponent(fetchLocale),
      "fields.announcement=true",
      "include=2",
      "limit=10",
    ].join("&");

    fetch(
      "https://cdn.contentful.com/spaces/" +
        SPACE_ID +
        "/environments/" +
        ENVIRONMENT +
        "/entries?" +
        qs
    )
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.items || data.items.length === 0) return;

        var assets = {};
        var linkedEntries = {};
        ((data.includes && data.includes.Asset) || []).forEach(function (a) {
          assets[a.sys.id] = a;
        });
        ((data.includes && data.includes.Entry) || []).forEach(function (e) {
          linkedEntries[e.sys.id] = e;
        });

        var slides = buildSlides(data.items, assets, linkedEntries, locale);
        if (!slides.length) return;

        injectStyles();
        renderModal(slides, locale);
      })
      .catch(function () {
        /* silent — announcement is non-critical */
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

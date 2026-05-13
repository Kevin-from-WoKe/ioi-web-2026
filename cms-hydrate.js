/*
 * IOI Oleochemical – client-side CMS hydration
 *
 * Reads entries from the Contentful Delivery API and injects them into
 * elements marked with data-cms-* attributes in the exported Webflow HTML.
 *
 * Required globals (provided by the server-side include on the ASP host):
 *   window.CONTENTFUL_SPACE_ID
 *   window.CONTENTFUL_ACCESS_TOKEN  (Delivery API token – read-only, safe to expose)
 *   window.CONTENTFUL_ENVIRONMENT   (optional, defaults to "master")
 *
 * Supported HTML attributes:
 *
 *   --- Single-entry detail pages ---
 *   data-cms-detail="csrEvent"       on <body> (or any ancestor) – fetch one entry
 *   data-cms-slug="my-slug"          explicit slug; otherwise taken from the URL
 *                                    (last path segment without .html, or ?slug=...)
 *
 *   --- Collection lists ---
 *   data-cms-list="product"          wrapper that will receive rendered items
 *   data-cms-template="product"      child element that is cloned per item
 *   data-cms-list-filter="csrTags.slug={slug}"
 *                                    filter the fetched items before rendering;
 *                                    {slug} is replaced with the detail-page slug.
 *   data-cms-list-from="kosherCertification.kosherCompany"
 *                                    keep only entries referenced by another list
 *                                    via the named link/references field (used to
 *                                    derive filter-dropdown options from the set of
 *                                    linked entries actually used elsewhere).
 *   data-cms-list-sort="name"        sort the rendered items alphabetically by the
 *                                    given field (prefix with "-" to reverse).
 *   data-cms-list-sort-mode="number" when used with data-cms-list-sort, compare
 *                                    values numerically (for integer fields like
 *                                    offSortOrder).
 *   data-cms-list-order="slug-a,slug-b"
 *                                    render the listed slugs first in the given
 *                                    order; remaining items keep their default
 *                                    order afterwards.
 *   data-cms-list-limit="3"          cap how many items are rendered (after
 *                                    filter, sort, and order).
 *   data-cms-list-include-slugs="a,b"
 *                                    keep only entries whose slug field appears in
 *                                    this comma-separated list (after filters/from).
 *
 *   --- Per-item reference lists (inside a template or detail scope) ---
 *   data-cms-list-ref="csrTags"      wrapper bound to a references field
 *   data-cms-template-ref            child element that is cloned per reference
 *   data-cms-list-ref-limit="5"      show at most N reference clones visibly; extra
 *                                    clones keep content + fs-cmsfilter-field but get
 *                                    class "cms-tag-overflow" (visually hidden, not
 *                                    display:none) so Finsweet still indexes them.
 *
 *   --- Field bindings (inside any scope above) ---
 *   Field paths may use dot-notation to walk through linked entries,
 *   e.g. data-cms="kosherCompany.name".
 *
 *   data-cms="name"                  set textContent
 *   data-application-slug-from="slug"  set data-application-slug on the same
 *                                    element from the given field (for filter
 *                                    preselect; use with ?application-tag= in URL)
 *   data-cms-rich="body"             render Contentful rich-text → innerHTML
 *   data-cms-src="thumb"             set <img src> from an asset field
 *   data-cms-bg="thumb"              set style.backgroundImage from an asset field
 *   data-cms-href="slug"             set <a href> from a field
 *   data-cms-href-prefix="/csr/"     prefix prepended to the value (default "/")
 *   data-cms-filter="csrTags"        value exposed to Finsweet CMS Filter
 *   data-cms-hide-if-empty="field"   hide this element when the field is
 *                                    missing or blank (after hydration)
 */

(function () {
  "use strict";

  var SPACE_ID = window.CONTENTFUL_SPACE_ID;
  var ACCESS_TOKEN = window.CONTENTFUL_ACCESS_TOKEN;
  var ENVIRONMENT = window.CONTENTFUL_ENVIRONMENT || "master";
  var DELIVERY_HOST = "https://cdn.contentful.com";

  if (!SPACE_ID || !ACCESS_TOKEN) {
    console.error(
      "[cms-hydrate] Missing CONTENTFUL_SPACE_ID or CONTENTFUL_ACCESS_TOKEN"
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Locale
  // ---------------------------------------------------------------------------

  function detectLocale() {
    var lang = document.documentElement.lang;
    // Accept both zh-CN (Contentful locale code) and zh-Hans (set by build.mjs).
    // Also fall back to URL path so /cn/ pages always get Chinese regardless of
    // what lang attribute the HTML was built with.
    var isChinese = lang === "zh-CN" || lang === "zh-Hans"
      || window.location.pathname.indexOf("/cn/") !== -1;
    return isChinese ? "zh-CN" : "en-US";
  }

  // ---------------------------------------------------------------------------
  // Contentful fetching (cached per contentType+locale)
  // ---------------------------------------------------------------------------

  var fetchCache = {};

  /**
   * For non-English locales, request locale=* so Contentful returns every
   * locale's value for every field.  We then flatten the response by picking
   * the requested locale with an automatic en-US fallback for any field whose
   * translated value is null/empty.  This means images, rich-text, and other
   * content that hasn't been localised yet still renders from the English
   * original instead of disappearing.
   *
   * The rest of the hydration code never sees locale maps — fields are always
   * a plain value after flattening, so no other code needs to change.
   */
  function flattenLocaleFields(items, assets, linkedEntries, locale) {
    function flattenVal(v) {
      if (v === null || v === undefined) return v;
      if (typeof v !== "object" || Array.isArray(v)) return v;
      // Locale map detection: Contentful always includes the default locale key.
      if (!Object.prototype.hasOwnProperty.call(v, "en-US")) return v;
      var preferred = v[locale];
      // Treat empty string as "not set" so we fall back rather than render blank.
      if (preferred != null && preferred !== "") return preferred;
      var fallback = v["en-US"];
      return fallback != null ? fallback : null;
    }

    function flattenObj(obj) {
      if (!obj || !obj.fields) return;
      var f = obj.fields;
      var keys = Object.keys(f);
      for (var i = 0; i < keys.length; i++) {
        f[keys[i]] = flattenVal(f[keys[i]]);
      }
    }

    items.forEach(flattenObj);
    var assetIds = Object.keys(assets);
    for (var i = 0; i < assetIds.length; i++) flattenObj(assets[assetIds[i]]);
    var entryIds = Object.keys(linkedEntries);
    for (var j = 0; j < entryIds.length; j++) flattenObj(linkedEntries[entryIds[j]]);
  }

  function fetchAll(contentType, locale) {
    var key = contentType + ":" + locale;
    if (fetchCache[key]) return fetchCache[key];

    // Request all locales for non-English pages so we can fall back to en-US
    // for untranslated fields (e.g. images embedded in rich text).
    var fetchLocale = locale !== "en-US" ? "*" : locale;

    var params = {
      access_token: ACCESS_TOKEN,
      content_type: contentType,
      locale: fetchLocale,
      include: "2",
      limit: "1000",
    };
    var query = Object.keys(params)
      .map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      })
      .join("&");

    fetchCache[key] = fetch(
      DELIVERY_HOST +
        "/spaces/" +
        SPACE_ID +
        "/environments/" +
        ENVIRONMENT +
        "/entries?" +
        query
    )
      .then(function (res) {
        if (!res.ok) throw new Error("Contentful " + res.status);
        return res.json();
      })
      .then(function (data) {
        var items = data.items || [];
        var assets = indexById((data.includes && data.includes.Asset) || []);
        var linkedEntries = indexById((data.includes && data.includes.Entry) || []);
        if (locale !== "en-US") {
          flattenLocaleFields(items, assets, linkedEntries, locale);
        }
        return { items: items, assets: assets, entries: linkedEntries };
      });

    return fetchCache[key];
  }

  function indexById(arr) {
    var map = {};
    arr.forEach(function (x) {
      map[x.sys.id] = x;
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Link + path resolution
  // ---------------------------------------------------------------------------

  function resolveLink(value, includes) {
    if (!value) return value;
    if (value.sys && value.sys.type === "Link") {
      var pool =
        value.sys.linkType === "Asset" ? includes.assets : includes.entries;
      return pool[value.sys.id] || null;
    }
    return value;
  }

  function getAssetUrl(asset) {
    if (!asset || !asset.fields || !asset.fields.file) return null;
    var url = asset.fields.file.url;
    return url && url.indexOf("//") === 0 ? "https:" + url : url;
  }

  // Walk a dot-path like "kosherCompany.name" starting from entry.fields.
  // Automatically resolves Link objects via the includes pool.
  function resolvePath(entry, path, includes) {
    if (!entry || !path) return null;
    var parts = path.split(".");
    var cur = entry.fields ? entry.fields[parts[0]] : null;
    for (var i = 1; i < parts.length; i++) {
      if (cur == null) return null;
      if (cur.sys && cur.sys.type === "Link") cur = resolveLink(cur, includes);
      if (!cur) return null;
      cur = cur.fields ? cur.fields[parts[i]] : null;
    }
    if (cur && cur.sys && cur.sys.type === "Link") cur = resolveLink(cur, includes);
    return cur;
  }

  // ---------------------------------------------------------------------------
  // Rich text → HTML (subset)
  // ---------------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  /** Canonical URLs use /en/ and /cn/. Remap older /zh-en/, /zh-cn/, and short /zh/ from CMS. */
  function rewriteLegacyLocalePath(uri) {
    if (!uri || typeof uri !== "string" || uri.charAt(0) !== "/") return uri;
    if (uri === "/en" || uri.indexOf("/en/") === 0) return uri;
    if (uri === "/cn" || uri.indexOf("/cn/") === 0) return uri;
    if (uri === "/zh-en" || uri.indexOf("/zh-en/") === 0) {
      return "/en" + (uri === "/zh-en" ? "" : uri.slice(6));
    }
    if (uri === "/zh-cn" || uri.indexOf("/zh-cn/") === 0) {
      return "/cn" + (uri === "/zh-cn" ? "" : uri.slice(6));
    }
    if (uri === "/zh" || uri.indexOf("/zh/") === 0) return "/cn" + uri.slice(3);
    return uri;
  }

  function renderRichText(doc, includes) {
    if (!doc || doc.nodeType !== "document") return "";
    return (doc.content || [])
      .map(function (n) {
        return renderRichNode(n, includes);
      })
      .join("");
  }

  function renderRichChildren(node, includes) {
    return (node.content || [])
      .map(function (c) {
        return renderRichNode(c, includes);
      })
      .join("");
  }

  function renderRichNode(node, includes) {
    switch (node.nodeType) {
      case "paragraph":
        return "<p>" + renderRichChildren(node, includes) + "</p>";
      case "heading-1":
      case "heading-2":
      case "heading-3":
      case "heading-4":
      case "heading-5":
      case "heading-6":
        var level = node.nodeType.slice(-1);
        return (
          "<h" +
          level +
          ">" +
          renderRichChildren(node, includes) +
          "</h" +
          level +
          ">"
        );
      case "unordered-list":
        return "<ul>" + renderRichChildren(node, includes) + "</ul>";
      case "ordered-list":
        return "<ol>" + renderRichChildren(node, includes) + "</ol>";
      case "list-item":
        return "<li>" + renderRichChildren(node, includes) + "</li>";
      case "blockquote":
        return "<blockquote>" + renderRichChildren(node, includes) + "</blockquote>";
      case "hr":
        return "<hr>";
      case "hyperlink":
        var href = escapeAttr(
          rewriteLegacyLocalePath((node.data && node.data.uri) || "#"),
        );
        return (
          '<a href="' + href + '">' + renderRichChildren(node, includes) + "</a>"
        );
      case "embedded-asset-block": {
        var target = node.data && node.data.target;
        if (!target) return "";
        var asset =
          target.fields && target.fields.file ? target : resolveLink(target, includes);
        var embedUrl = getAssetUrl(asset);
        if (!embedUrl) return "";
        return (
          '<figure class="w-richtext-figure-type-image w-richtext-align-fullwidth"><div><img src="' +
          escapeAttr(embedUrl) +
          '" loading="lazy" alt=""></div></figure>'
        );
      }
      case "text":
        var t = escapeHtml(node.value || "");
        (node.marks || []).forEach(function (m) {
          if (m.type === "bold") t = "<strong>" + t + "</strong>";
          else if (m.type === "italic") t = "<em>" + t + "</em>";
          else if (m.type === "underline") t = "<u>" + t + "</u>";
          else if (m.type === "code") t = "<code>" + t + "</code>";
        });
        return t;
      default:
        return "";
    }
  }

  // ---------------------------------------------------------------------------
  // DOM hydration
  // ---------------------------------------------------------------------------

  var BARRIER_SELECTOR =
    "[data-cms-list], [data-cms-list-ref], [data-cms-template], [data-cms-template-ref]";

  /* Webflow's export marks nested links/cards with `is-hidden` so the raw
   template stays invisible. Strip it from the clone (and any descendants)
   so populated items render. */
  function revealClone(clone) {
    clone.classList.remove("is-hidden");
    clone.style.display = "";
    clone.style.opacity = "";
    Array.prototype.slice
      .call(clone.querySelectorAll(".is-hidden"))
      .forEach(function (el) {
        el.classList.remove("is-hidden");
      });
    // Reset opacity on descendants carrying Webflow animation start state (opacity:0).
    // Exclude form inputs/selects — their opacity:0 is intentional (hides the native
    // control while a custom-styled replacement is shown above it).
    Array.prototype.slice
      .call(clone.querySelectorAll("[style*='opacity']"))
      .forEach(function (el) {
        var tag = el.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        el.style.opacity = "";
      });
  }

  // Webflow tags unpopulated bind targets with `w-dyn-bind-empty`, which the
  // stylesheet forces to `display: none !important`. Clear it once we've
  // written a value so the element becomes visible.
  function markBound(node) {
    node.classList.remove("w-dyn-bind-empty");
  }

  function applyFields(scope, entry, includes) {
    var barriers = Array.prototype.slice.call(
      scope.querySelectorAll(BARRIER_SELECTOR)
    );

    function inBarrier(node) {
      for (var i = 0; i < barriers.length; i++) {
        if (
          barriers[i] !== node &&
          barriers[i] !== scope &&
          barriers[i].contains(node)
        ) {
          return true;
        }
      }
      return false;
    }

    scope.querySelectorAll("[data-cms]").forEach(function (node) {
      if (inBarrier(node)) return;
      var value = resolvePath(entry, node.getAttribute("data-cms"), includes);
      if (value == null) return;
      if (typeof value === "object" && value.fields && value.fields.name) {
        value = value.fields.name;
      }
      node.textContent = typeof value === "string" ? value : String(value);
      markBound(node);
    });

    scope.querySelectorAll("[data-application-slug-from]").forEach(function (node) {
      if (inBarrier(node)) return;
      var path = node.getAttribute("data-application-slug-from") || "slug";
      var value = resolvePath(entry, path, includes);
      if (value == null) return;
      node.setAttribute("data-application-slug", String(value));
    });

    scope.querySelectorAll("[data-cms-rich]").forEach(function (node) {
      if (inBarrier(node)) return;
      var value = resolvePath(entry, node.getAttribute("data-cms-rich"), includes);
      if (value && value.nodeType === "document") {
        node.innerHTML = renderRichText(value, includes);
        markBound(node);
      }
    });

    scope.querySelectorAll("[data-cms-src]").forEach(function (node) {
      if (inBarrier(node)) return;
      var asset = resolvePath(entry, node.getAttribute("data-cms-src"), includes);
      var url = getAssetUrl(asset);
      if (url) {
        node.setAttribute("src", url);
        markBound(node);
      }
    });

    scope.querySelectorAll("[data-cms-bg]").forEach(function (node) {
      if (inBarrier(node)) return;
      var asset = resolvePath(entry, node.getAttribute("data-cms-bg"), includes);
      var url = getAssetUrl(asset);
      if (url) {
        node.style.backgroundImage = "url('" + url + "')";
        markBound(node);
      }
    });

    scope.querySelectorAll("[data-cms-href]").forEach(function (node) {
      if (inBarrier(node)) return;
      var value = resolvePath(entry, node.getAttribute("data-cms-href"), includes);
      if (value == null) return;
      var str = String(value);
      var hasPrefix = node.hasAttribute("data-cms-href-prefix");
      var prefix = hasPrefix ? node.getAttribute("data-cms-href-prefix") : "/";
      // When the prefix ends with "=" the value is a query-param — encode it
      // the same way URLSearchParams does (spaces → "+", "&" → "%26") so it
      // round-trips correctly through Finsweet's filter URL reader.
      if (prefix.charAt(prefix.length - 1) === "=") {
        try {
          str = new URLSearchParams([["v", str]]).toString().slice(2);
        } catch (e) {
          str = encodeURIComponent(str).replace(/%20/g, "+");
        }
      }
      // Absolute URLs (http://, https://, //, mailto:, tel:, /) pass through as-is.
      var isAbsolute = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(str);
      var rawHref = isAbsolute ? str : prefix + str;
      node.setAttribute(
        "href",
        rawHref.charAt(0) === "/" ? rewriteLegacyLocalePath(rawHref) : rawHref,
      );
      markBound(node);
    });

    scope.querySelectorAll("[data-cms-filter]").forEach(function (node) {
      if (inBarrier(node)) return;
      var field = node.getAttribute("data-cms-filter");
      // Walk dot-paths (e.g. "proVarCat.proFamilyName") the same way data-cms does,
      // otherwise linked fields like proFamilyName never get text set on filter items.
      var value = resolvePath(entry, field, includes);
      if (value == null) return;
      // Preserve any pre-existing fs-cmsfilter-field set in the Webflow export so
      // the filter dropdown and the item stay on the same Finsweet field key.
      if (!node.hasAttribute("fs-cmsfilter-field")) {
        node.setAttribute("fs-cmsfilter-field", field);
      }
      if (Array.isArray(value)) {
        var names = value
          .map(function (item) {
            var resolved = resolveLink(item, includes);
            return resolved && resolved.fields && resolved.fields.name;
          })
          .filter(Boolean);
        node.textContent = names.join(", ");
      } else if (value && typeof value === "object" && value.sys) {
        var resolvedLink = resolveLink(value, includes);
        var name = resolvedLink && resolvedLink.fields && resolvedLink.fields.name;
        if (name) node.textContent = String(name);
      } else {
        node.textContent = String(value);
      }
      markBound(node);
    });

    // Nested per-item reference lists
    scope.querySelectorAll("[data-cms-list-ref]").forEach(function (ref) {
      if (inBarrier(ref)) return;
      renderRefList(ref, entry, includes);
    });

    scope.querySelectorAll("[data-cms-hide-if-empty]").forEach(function (node) {
      if (inBarrier(node)) return;
      var path = node.getAttribute("data-cms-hide-if-empty");
      var value = resolvePath(entry, path, includes);
      var empty =
        value == null ||
        value === "" ||
        (typeof value === "string" && value.trim() === "");
      if (empty) node.style.display = "none";
    });
  }

  function renderRefList(wrapper, entry, includes) {
    var fieldName = wrapper.getAttribute("data-cms-list-ref");
    var template = wrapper.querySelector("[data-cms-template-ref]");
    if (!template) return;
    var parent = template.parentNode;
    template.style.display = "none";
    Array.prototype.slice.call(parent.children).forEach(function (child) {
      if (child !== template) parent.removeChild(child);
    });

    var raw = entry.fields ? entry.fields[fieldName] : null;
    if (!raw) {
      wrapper.setAttribute("data-cms-empty", "true");
      return;
    }
    var values = Array.isArray(raw) ? raw : [raw];
    var limitStr = wrapper.getAttribute("data-cms-list-ref-limit");
    var lim =
      limitStr != null && limitStr !== ""
        ? parseInt(limitStr, 10)
        : NaN;
    var hasLimit = !isNaN(lim) && lim >= 0;

    values.forEach(function (v, idx) {
      var resolved = resolveLink(v, includes);
      if (!resolved) return;
      var clone = template.cloneNode(true);
      clone.removeAttribute("data-cms-template-ref");
      revealClone(clone);
      applyFields(clone, resolved, includes);
      if (hasLimit && idx >= lim) {
        clone.classList.add("cms-tag-overflow");
      }
      parent.appendChild(clone);
    });
  }

  function hydrateList(wrapper, template, entries, includes) {
    var parent = template.parentNode;
    template.style.display = "none";
    Array.prototype.slice.call(parent.children).forEach(function (child) {
      if (child !== template) parent.removeChild(child);
    });

    entries.forEach(function (entry) {
      var clone = template.cloneNode(true);
      clone.removeAttribute("data-cms-template");
      revealClone(clone);
      applyFields(clone, entry, includes);
      parent.appendChild(clone);
    });

    /* Webflow keeps the template node (display:none) inside the Finsweet list; CMS
       Filter counts it as an extra item (items-count off by one). Remove it. */
    if (template.parentNode) {
      template.parentNode.removeChild(template);
    }

    wrapper.setAttribute("data-cms-hydrated", "true");
    // Hide the Webflow "empty state" once we've rendered items.
    if (entries.length > 0) {
      var empty = wrapper.querySelector(".w-dyn-empty");
      if (empty) empty.style.display = "none";
    }
  }

  function filterList(items, filterSpec, includes) {
    if (!filterSpec) return items;
    var eq = filterSpec.indexOf("=");
    if (eq < 0) return items;
    var path = filterSpec.slice(0, eq).trim();
    var val = filterSpec.slice(eq + 1).trim();
    return items.filter(function (item) {
      var cur = resolvePath(item, path, includes);
      if (cur == null) return false;
      if (Array.isArray(cur)) {
        for (var i = 0; i < cur.length; i++) {
          var r = resolveLink(cur[i], includes);
          if (r && r.fields) {
            // path's last segment picks the field we want to compare
            var last = path.split(".").pop();
            if (r.fields[last] === val) return true;
          } else if (r === val) {
            return true;
          }
        }
        return false;
      }
      return cur === val;
    });
  }

  // ---------------------------------------------------------------------------
  // Entry points: detail + lists
  // ---------------------------------------------------------------------------

  function resolveDetailSlug(scope) {
    var explicit = scope.getAttribute("data-cms-slug");
    if (explicit) return explicit;
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.get("slug")) return q.get("slug");
    } catch (e) {}
    var parts = window.location.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    return parts[parts.length - 1].replace(/\.html$/, "") || null;
  }

  function processDetail(scope, locale) {
    var contentType = scope.getAttribute("data-cms-detail");
    var slug = resolveDetailSlug(scope);
    if (!contentType || !slug) return Promise.resolve(null);
    return fetchAll(contentType, locale).then(function (data) {
      var entry = null;
      for (var i = 0; i < data.items.length; i++) {
        if (
          data.items[i].fields &&
          data.items[i].fields.slug === slug
        ) {
          entry = data.items[i];
          break;
        }
      }
      if (!entry) {
        console.warn(
          "[cms-hydrate] No " + contentType + " found with slug=" + slug
        );
        return null;
      }
      applyFields(scope, entry, {
        assets: data.assets,
        entries: data.entries,
      });
      scope.setAttribute("data-cms-hydrated", "true");
      return { entry: entry, slug: slug };
    });
  }

  function collectReferencedIds(items, fieldName) {
    var ids = Object.create(null);
    items.forEach(function (item) {
      var value = item.fields ? item.fields[fieldName] : null;
      if (value == null) return;
      var arr = Array.isArray(value) ? value : [value];
      arr.forEach(function (v) {
        if (v && v.sys && v.sys.id) ids[v.sys.id] = true;
      });
    });
    return ids;
  }

  function processLists(locale, contextSlug) {
    var lists = Array.prototype.slice.call(
      document.querySelectorAll("[data-cms-list]")
    );
    return Promise.all(
      lists.map(function (wrapper) {
        var contentType = wrapper.getAttribute("data-cms-list");
        var template =
          wrapper.querySelector(
            '[data-cms-template="' + contentType + '"]'
          ) || wrapper.querySelector("[data-cms-template]");
        if (!template) return null;

        var fromSpec = wrapper.getAttribute("data-cms-list-from");
        var fromParts = fromSpec ? fromSpec.split(".") : null;
        var fromFetch =
          fromParts && fromParts.length === 2
            ? fetchAll(fromParts[0], locale)
            : Promise.resolve(null);

        return Promise.all([
          fetchAll(contentType, locale),
          fromFetch,
        ]).then(function (results) {
          var data = results[0];
          var source = results[1];

          var filterSpec = wrapper.getAttribute("data-cms-list-filter");
          if (filterSpec && contextSlug) {
            filterSpec = filterSpec.replace(/\{slug\}/g, contextSlug);
          }
          var items = filterList(data.items, filterSpec, {
            assets: data.assets,
            entries: data.entries,
          });

          if (source && fromParts) {
            var allowed = collectReferencedIds(source.items, fromParts[1]);
            items = items.filter(function (it) {
              return it.sys && allowed[it.sys.id];
            });
          }

          var includeSlugsSpec = wrapper.getAttribute(
            "data-cms-list-include-slugs"
          );
          if (includeSlugsSpec != null && includeSlugsSpec !== "") {
            var slugAllow = {};
            includeSlugsSpec
              .split(",")
              .map(function (s) {
                return s.trim();
              })
              .filter(Boolean)
              .forEach(function (s) {
                slugAllow[s] = true;
              });
            items = items.filter(function (it) {
              var s = it.fields && it.fields.slug;
              return s != null && slugAllow[String(s)];
            });
          }

          var sortSpec = wrapper.getAttribute("data-cms-list-sort");
          var sortMode = wrapper.getAttribute("data-cms-list-sort-mode");
          if (sortSpec) {
            var desc = sortSpec.charAt(0) === "-";
            var sortField = desc ? sortSpec.slice(1) : sortSpec;
            var numeric = sortMode === "number";
            items = items.slice().sort(function (a, b) {
              var av = a.fields ? a.fields[sortField] : null;
              var bv = b.fields ? b.fields[sortField] : null;
              if (av == null) return 1;
              if (bv == null) return -1;
              var cmp;
              if (numeric) {
                var an = Number(av);
                var bn = Number(bv);
                cmp =
                  (isFinite(an) ? an : Infinity) -
                  (isFinite(bn) ? bn : Infinity);
              } else {
                cmp = String(av).localeCompare(String(bv));
              }
              return desc ? -cmp : cmp;
            });
          }

          var orderSpec = wrapper.getAttribute("data-cms-list-order");
          if (orderSpec) {
            var slugOrder = orderSpec
              .split(",")
              .map(function (s) { return s.trim(); })
              .filter(Boolean);
            var rank = {};
            slugOrder.forEach(function (s, i) { rank[s] = i; });
            items = items.slice().sort(function (a, b) {
              var ar = rank[a.fields && a.fields.slug];
              var br = rank[b.fields && b.fields.slug];
              if (ar == null && br == null) return 0;
              if (ar == null) return 1;
              if (br == null) return -1;
              return ar - br;
            });
          }

          // Nav product dropdown: enforce fixed display order without touching HTML
          if (contentType === "product" && wrapper.closest(".navbar5_dropdown-list")) {
            var navOrder = ["palmac", "palmsurf", "palmsabun"];
            items = items.slice().sort(function (a, b) {
              var ai = navOrder.indexOf(a.fields && a.fields.slug);
              var bi = navOrder.indexOf(b.fields && b.fields.slug);
              if (ai === -1) return 1;
              if (bi === -1) return -1;
              return ai - bi;
            });
          }

          // Homepage product cards: enforce fixed display order
          if (contentType === "product" && wrapper.closest(".layout394_grid-list")) {
            var cardOrder = ["palmsurf", "palmac", "palmsabun"];
            items = items.slice().sort(function (a, b) {
              var ai = cardOrder.indexOf(a.fields && a.fields.slug);
              var bi = cardOrder.indexOf(b.fields && b.fields.slug);
              if (ai === -1) return 1;
              if (bi === -1) return -1;
              return ai - bi;
            });
          }

          var limitSpec = wrapper.getAttribute("data-cms-list-limit");
          if (limitSpec != null && limitSpec !== "") {
            var lim = parseInt(limitSpec, 10);
            if (!isNaN(lim) && lim >= 0) {
              items = items.slice(0, lim);
            }
          }

          hydrateList(wrapper, template, items, {
            assets: data.assets,
            entries: data.entries,
          });
        });
      })
    );
  }

  // Finsweet scripts are NOT included in the HTML — they are injected here,
  // after CMS hydration, so Finsweet initialises exactly once against the
  // fully-populated DOM. This eliminates the double-init / duplicate-tag race
  // that occurred when the async script in the HTML could fire before or
  // concurrently with our hydration fetch.
  function reinitFinsweet() {
    try {
      window.__ioiApplicationTagPreselectDone = false;
    } catch (e) {}
    /* Re-hide the list while Finsweet binds; otherwise the full list flashes
       before the ?application-tag= preselect runs. */
    try {
      var at = new URLSearchParams(window.location.search).get("application-tag");
      if (at && String(at).trim()) {
        document.documentElement.classList.remove("ioi-pf-revealing");
        document.documentElement.classList.add("ioi-pf-awaiting-tag");
      }
    } catch (e) {}

    // Re-inject cmsselect so it rescans the now-hydrated job list
    if (document.querySelector('[fs-cmsselect-element]')) {
      var freshSelect = document.createElement("script");
      freshSelect.async = true;
      freshSelect.src =
        "https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsselect@1/cmsselect.js";
      document.head.appendChild(freshSelect);
    }

    var fresh = document.createElement("script");
    fresh.async = true;
    fresh.src =
      "https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsfilter@1/cmsfilter.js";
    fresh.onload = function () {
      /* Product Finder registers window.__ioiApplyApplicationTagPreselect; run after
         the new CMS Filter instance has attached listeners (see product-finder.html). */
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          window.setTimeout(function () {
            if (typeof window.__ioiApplyApplicationTagPreselect === "function") {
              window.__ioiApplyApplicationTagPreselect();
            }
          }, 0);
        });
      });
    };
    document.head.appendChild(fresh);
  }

  // Finsweet's "No results" placeholder (fs-cmsfilter-element="empty*") is
  // visible by default in the static export. Hide it up front; Finsweet will
  // unhide it when a user actually filters down to zero matches.
  function hideFinsweetEmptyStates() {
    Array.prototype.slice
      .call(document.querySelectorAll('[fs-cmsfilter-element^="empty"]'))
      .forEach(function (el) {
        el.style.display = "none";
      });
  }

  function init() {
    hideFinsweetEmptyStates();
    var locale = detectLocale();
    var detailScope = document.querySelector("[data-cms-detail]");
    var detailPromise = detailScope
      ? processDetail(detailScope, locale)
      : Promise.resolve(null);

    detailPromise
      .then(function (result) {
        var slug = result ? result.slug : null;
        return processLists(locale, slug);
      })
      .then(reinitFinsweet)
      .catch(function (err) {
        console.error("[cms-hydrate] Failed:", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


/**
 * Sdn Bhd line-wrap prevention
 *
 * Replaces plain spaces inside "<word> Sdn[.] Bhd[.]" with non-breaking spaces
 * so the suffix stays glued to the preceding word at line breaks.
 * Content-gated: only does work on text nodes that contain "Sdn".
 *
 *   "IOI Acidchem Sdn. Bhd."  →  "IOI Acidchem Sdn. Bhd." (Acidchem-Sdn-Bhd locked together)
 *
 * Runs on DOMContentLoaded for static text and uses a MutationObserver to
 * catch text injected later by hydrateList / Webflow CMS / Finsweet.
 *
 * Implementation note: the regex matches [ \t]+ (NOT \s+) so NBSP is never
 * matched again after replacement — preventing an infinite mutation loop
 * triggered by the observer reacting to its own characterData edits.
 */
(function () {
  "use strict";

  var NBSP = " ";
  var SDN_BHD = /(Sdn\.?)[ \t]+(Bhd\.?)/g;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1 };

  function processTextNode(node) {
    if (!node || node.nodeType !== 3) return;     // 3 = TEXT_NODE
    var v = node.nodeValue;
    if (!v || v.indexOf("Sdn") === -1) return;     // cheap early-out
    var p = node.parentNode;
    if (!p || SKIP_TAGS[p.nodeName]) return;
    var replaced = v.replace(SDN_BHD, function (_m, a, b) {
      return a + NBSP + b;
    });
    if (replaced !== v) node.nodeValue = replaced;
  }

  function walk(root) {
    if (!root || !root.nodeType) return;
    if (root.nodeType === 3) { processTextNode(root); return; }
    if (root.nodeType !== 1) return;               // 1 = ELEMENT_NODE
    if (SKIP_TAGS[root.nodeName]) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) processTextNode(nodes[i]);
  }

  function initSdnBhdNoWrap() {
    walk(document.body);

    if (typeof MutationObserver === "undefined") return;
    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        } else if (m.type === "characterData") {
          processTextNode(m.target);
        }
      }
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSdnBhdNoWrap);
  } else {
    initSdnBhdNoWrap();
  }
})();

/**
 * Kosher product certificates — paginate rows after Finsweet CMS Filter visibility.
 *
 * Loaded outside <!-- cms-hydrate:begin/end --> so Next.js preview keeps this file
 * when cms-hydrate.js is stripped (SSR already outputs the list markup).
 */
(function () {
  "use strict";

  var ATTR_INIT = "data-ioi-kosher-pagination-init";
  var CLS_HIDE = "ioi-kosher-pagination-hidden";
  var CLS_DISABLED = "ioi-pagination-disabled";
  var PAGE_DEFAULT = 100;
  var POLL_MS = 120;
  var POLL_MAX = 100;

  function pageSize(wrapper) {
    var s = wrapper.getAttribute("data-cms-list-page-size");
    if (s == null || s === "") return PAGE_DEFAULT;
    var n = parseInt(s, 10);
    return !isNaN(n) && n > 0 ? n : PAGE_DEFAULT;
  }

  /** CMS Filter hides non-matching rows with inline display:none (Attributes v1). */
  function passesCmsFilter(el) {
    return el.style.display !== "none";
  }

  function mountPagination() {
    var wrapper = document.querySelector(
      '[data-cms-list="kosherCertification"]'
    );
    if (!wrapper) return false;
    if (wrapper.getAttribute(ATTR_INIT)) return true;

    var listEl = wrapper.querySelector('[fs-cmsfilter-element="list"]');
    var pagNav = wrapper.querySelector(".w-pagination-wrapper");
    var prevBtn = wrapper.querySelector(".w-pagination-previous");
    var nextBtn = wrapper.querySelector(".w-pagination-next");
    if (!listEl || !pagNav || !prevBtn || !nextBtn) return false;

    var rows = listEl.querySelectorAll('[role="listitem"]');
    if (!rows.length) return false;

    wrapper.setAttribute(ATTR_INIT, "true");

    var ps = pageSize(wrapper);
    var pageIndex = 0;
    var debounceTimer = null;

    function listItems() {
      return Array.prototype.slice.call(
        listEl.querySelectorAll('[role="listitem"]')
      );
    }

    function applyPagination(resetPage) {
      if (resetPage) pageIndex = 0;

      var items = listItems();
      items.forEach(function (el) {
        el.classList.remove(CLS_HIDE);
      });

      var matched = items.filter(passesCmsFilter);
      var total = matched.length;
      var totalPages = Math.max(1, Math.ceil(total / ps));

      if (pageIndex > totalPages - 1)
        pageIndex = Math.max(0, totalPages - 1);

      var start = pageIndex * ps;
      var end = start + ps;
      matched.forEach(function (el, j) {
        if (j < start || j >= end) el.classList.add(CLS_HIDE);
      });

      var showNav = total > ps;
      pagNav.style.display = showNav ? "" : "none";

      var atStart = pageIndex <= 0;
      var atEnd = pageIndex >= totalPages - 1 || total === 0;
      prevBtn.classList.toggle(CLS_DISABLED, atStart);
      nextBtn.classList.toggle(CLS_DISABLED, atEnd);
      prevBtn.setAttribute("aria-disabled", atStart ? "true" : "false");
      nextBtn.setAttribute("aria-disabled", atEnd ? "true" : "false");
    }

    function scheduleFilterResync() {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(function () {
        applyPagination(true);
      }, 80);
    }

    function onPrev(e) {
      e.preventDefault();
      e.stopPropagation();
      if (prevBtn.classList.contains(CLS_DISABLED)) return;
      pageIndex -= 1;
      if (pageIndex < 0) pageIndex = 0;
      applyPagination(false);
    }

    function onNext(e) {
      e.preventDefault();
      e.stopPropagation();
      if (nextBtn.classList.contains(CLS_DISABLED)) return;
      pageIndex += 1;
      applyPagination(false);
    }

    prevBtn.addEventListener("click", onPrev);
    nextBtn.addEventListener("click", onNext);

    var tabPane = wrapper.closest(".w-tab-pane");
    var kosherForm =
      tabPane &&
      tabPane.querySelector('form[fs-cmsfilter-element="filters"]');
    if (kosherForm) {
      kosherForm.addEventListener("input", scheduleFilterResync);
      kosherForm.addEventListener("change", scheduleFilterResync);
    }

    try {
      var mo = new MutationObserver(scheduleFilterResync);
      mo.observe(listEl, {
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    } catch (err) {}

    window.setTimeout(function () {
      applyPagination(true);
    }, 0);
    window.setTimeout(function () {
      applyPagination(true);
    }, 200);
    window.setTimeout(function () {
      applyPagination(true);
    }, 600);

    return true;
  }

  function bootstrap() {
    if (mountPagination()) return;

    var n = 0;
    var id = window.setInterval(function () {
      n += 1;
      if (mountPagination()) window.clearInterval(id);
      else if (n >= POLL_MAX) window.clearInterval(id);
    }, POLL_MS);
  }

  window.fsAttributes = window.fsAttributes || [];
  window.fsAttributes.push([
    "cmsfilter",
    function () {
      window.setTimeout(function () {
        mountPagination();
      }, 50);
    },
  ]);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  window.addEventListener("load", function () {
    mountPagination();
  });
})();

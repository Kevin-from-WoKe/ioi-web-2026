(function () {
  var rawParam = null;
  var waitRetries = 0;
  var maxWaitRetries = 25;

  function readParam() {
    try {
      var params = new URLSearchParams(window.location.search);
      var raw = params.get('application-tag');
      if (!raw) return null;
      try {
        raw = decodeURIComponent(raw.trim());
      } catch (e1) {}
      return raw;
    } catch (e2) {
      return null;
    }
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function matchesTagParam(label) {
    if (!rawParam) return false;
    var stored = label.getAttribute('data-application-slug');
    if (stored && (stored === rawParam || slugify(stored) === slugify(rawParam))) return true;
    var nameSlug = slugify(label.textContent.trim());
    return nameSlug === slugify(rawParam) || nameSlug === rawParam;
  }

  function dispatchFilterEvents(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e1) {
      var evIn = document.createEvent('Event');
      evIn.initEvent('input', true, true);
      el.dispatchEvent(evIn);
    }
    try {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e2) {
      var evCh = document.createEvent('Event');
      evCh.initEvent('change', true, true);
      el.dispatchEvent(evCh);
    }
  }

  /* Webflow custom checkbox uses .w--redirected-checked on the fake input div, not native :checked painting. */
  function syncApplicationCheckboxVisual(checkbox) {
    var lab = checkbox.closest('label');
    if (!lab) return;
    var icon = lab.querySelector('.filters5_form-checkbox1-icon');
    if (!icon) return;
    if (checkbox.checked) {
      icon.classList.add('w--redirected-checked');
    } else {
      icon.classList.remove('w--redirected-checked');
    }
  }

  function updateApplicationDropdownToggle(checkbox) {
    var lab = checkbox.closest('label');
    var nameEl = lab ? lab.querySelector('[fs-cmsfilter-field="proApplication"]') : null;
    var appName = nameEl ? nameEl.textContent.trim() : '';
    var group = checkbox.closest('.filters5_filter-group');
    if (!group || !group.querySelector('[data-cms-list="productApplication"]')) return;
    if (!appName) return;
    var toggle = group.querySelector('.dropdown2_toggle.w-dropdown-toggle');
    if (!toggle) return;
    var labelDiv = toggle.firstElementChild;
    if (labelDiv && labelDiv.tagName === 'DIV') {
      labelDiv.textContent = appName;
    }
  }

  function revealProductFinderList() {
    try {
      var root = document.documentElement;
      if (!root.classList.contains('ioi-pf-awaiting-tag')) return;

      var reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var settleMs = reduced ? 90 : 480;

      root.classList.add('ioi-pf-revealing');

      var overlay = document.querySelector('.ioi-pf-loading-overlay');
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        root.classList.remove('ioi-pf-awaiting-tag', 'ioi-pf-revealing');
      }

      var tid = window.setTimeout(finish, settleMs);

      if (overlay && !reduced) {
        overlay.addEventListener(
          'transitionend',
          function onTe(ev) {
            if (ev.propertyName !== 'opacity') return;
            overlay.removeEventListener('transitionend', onTe);
            window.clearTimeout(tid);
            finish();
          },
          false,
        );
      }
    } catch (e) {
      try {
        document.documentElement.classList.remove(
          'ioi-pf-awaiting-tag',
          'ioi-pf-revealing',
        );
      } catch (e2) {}
    }
  }

  window.__ioiApplyApplicationTagPreselect = function () {
    if (window.__ioiApplicationTagPreselectDone) return;

    rawParam = readParam();
    if (!rawParam) return;

    var items = document.querySelectorAll('.filters5_item');
    var checkbox = null;
    for (var i = 0; i < items.length; i++) {
      var label = items[i].querySelector('[fs-cmsfilter-field="proApplication"]');
      if (!label) continue;
      if (!matchesTagParam(label)) continue;
      checkbox = items[i].querySelector('input[type="checkbox"]');
      break;
    }

    if (!checkbox) {
      waitRetries += 1;
      if (waitRetries < maxWaitRetries) {
        window.setTimeout(window.__ioiApplyApplicationTagPreselect, 100);
      } else {
        revealProductFinderList();
      }
      return;
    }

    waitRetries = 0;
    window.__ioiApplicationTagPreselectDone = true;

    if (!checkbox.checked) {
      checkbox.checked = true;
    }
    syncApplicationCheckboxVisual(checkbox);
    dispatchFilterEvents(checkbox);
    updateApplicationDropdownToggle(checkbox);
    window.requestAnimationFrame(function () {
      syncApplicationCheckboxVisual(checkbox);
      updateApplicationDropdownToggle(checkbox);
      window.setTimeout(function () {
        syncApplicationCheckboxVisual(checkbox);
        updateApplicationDropdownToggle(checkbox);
        revealProductFinderList();
      }, 140);
    });
  };

  window.fsAttributes = window.fsAttributes || [];
  window.fsAttributes.push([
    'cmsfilter',
    function () {
      window.setTimeout(window.__ioiApplyApplicationTagPreselect, 0);
    },
  ]);
})();

let lenis;
if (Webflow.env("editor") === undefined) {
  lenis = new Lenis({
    lerp: 0.1,
    wheelMultiplier: 1.5,
    gestureOrientation: "vertical",
    normalizeWheel: false,
    smoothTouch: false
  });
  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  const ro = new ResizeObserver(() => lenis.resize());
  ro.observe(document.body);
}
$("[data-lenis-start]").on("click", function () {
  lenis.start();
});
$("[data-lenis-stop]").on("click", function () {
  lenis.stop();
});
$("[data-lenis-toggle]").on("click", function () {
  $(this).toggleClass("stop-scroll");
  if ($(this).hasClass("stop-scroll")) {
    lenis.stop();
  } else {
    lenis.start();
  }
});



(function () {
  var cursorX = 0, cursorY = 0;
  document.addEventListener('mousemove', function (e) {
    cursorX = e.clientX;
    cursorY = e.clientY;
  }, { passive: true });

  function initMegaMenuProtection() {
    var dropdown = document.querySelector('.navbar5_menu-dropdown.w-dropdown');
    if (!dropdown) return;
    var list = dropdown.querySelector('.navbar5_dropdown-list');
    if (!list) return;

    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName !== 'class') return;
        if (list.classList.contains('w--open')) return;
        var r = list.getBoundingClientRect();
        var inList = cursorX >= r.left && cursorX <= r.right && cursorY >= r.top && cursorY <= r.bottom;
        var tr = dropdown.getBoundingClientRect();
        var inToggle = cursorX >= tr.left && cursorX <= tr.right && cursorY >= tr.top && cursorY <= tr.bottom;
        if (inList || inToggle) {
          list.classList.add('w--open');
          dropdown.classList.add('w--open');
        }
      });
    }).observe(list, { attributes: true, attributeFilter: ['class'] });
  }

  $(document).ready(initMegaMenuProtection);
})();

(function() {
  var SITE_KEY = '6LeD3HMsAAAAAHCDu9iGC-YSptGeh_HuPjIx_CZS';
  var forms = document.querySelectorAll('form[action*="webmailContact"]');
  forms.forEach(function(form) {
    form.addEventListener('submit', function(e) {
      var tokenField = form.querySelector('#g-recaptcha-response');
      if (!tokenField || tokenField.value) return; // token already set, allow submit
      e.preventDefault();
      grecaptcha.ready(function() {
        grecaptcha.execute(SITE_KEY, { action: 'contact' }).then(function(token) {
          tokenField.value = token;
          form.submit(); // native POST — ASP receives it normally
        });
      });
    });
  });
  
  let siteYearLabel = document.getElementById('siteYear');
  if(siteYearLabel)
  {
	siteYearLabel.innerText = new Date().getFullYear();
  }
  
  // Language toggle: always links to the home page of the other locale.
  // Works for both served deployments (/en/...) and local file:// previews
  // (file:///Users/.../ioi-web-2026/en/...) by searching for 'en' or 'cn'
  // anywhere in the path segments rather than assuming it is at index 0.
  // depth = path segments after the locale folder, minus the filename itself.
  // e.g. .../en/index.html          (depth 1) → ../cn/index.html
  //      .../en/about-us/offices.html (depth 2) → ../../cn/index.html
  let langOpt = document.getElementById('lnkLangOpt');
  if (langOpt) {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const enIdx = segments.lastIndexOf('en');
    const cnIdx = segments.lastIndexOf('cn');
    const isEn = enIdx > cnIdx;
    const localeIdx = isEn ? enIdx : cnIdx;
    const depth = Math.max(1, segments.length - localeIdx - 1);
    const prefix = Array(depth).fill('..').join('/');
    langOpt.href = prefix + (isEn ? '/cn/index.html' : '/en/index.html');
  }

})();
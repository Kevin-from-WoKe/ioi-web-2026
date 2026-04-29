
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
  
  let langOpt = document.getElementById('lnkLangOpt');
  
  if(langOpt)
  {
		langOpt.style.display = 'none';
  }
  
})();
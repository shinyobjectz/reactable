/** Lucide icons — load after lucide UMD on each page */
(function () {
  function init() {
    if (typeof lucide === "undefined") return;
    lucide.createIcons({
      attrs: {
        "stroke-width": "1.75",
        "stroke-linecap": "square",
        "stroke-linejoin": "miter",
      },
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

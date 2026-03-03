(() => {
  const root = document.documentElement;

  if (!("fonts" in document) || typeof document.fonts.check !== "function") {
    return;
  }

  const headingReady = document.fonts.check('700 1em "BrutalType"');
  const bodyReady = document.fonts.check('400 1em "Inter"');

  if (headingReady && bodyReady) {
    return;
  }

  root.classList.add("fonts-loading");

  Promise.all([document.fonts.load('700 1em "BrutalType"'), document.fonts.load('400 1em "Inter"')])
    .catch(() => {
      // Keep fallback behavior if a font fails to load.
    })
    .finally(() => {
      root.classList.remove("fonts-loading");
      root.classList.add("fonts-fade-in");

      window.setTimeout(() => {
        root.classList.remove("fonts-fade-in");
      }, 350);
    });
})();

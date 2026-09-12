(() => {
  "use strict";

  function currentScreen() {
    const raw = (location.hash || "#home").slice(1).split("?")[0];
    return raw || "home";
  }

  function stopAudio() {
    try { window.stopSpeech?.({silent:true}); } catch (_) {}
  }

  const originalRoute = window.route;
  if (typeof originalRoute === "function" && !originalRoute.__dbNav028) {
    const wrappedRoute = function(target) {
      stopAudio();
      const before = location.hash || "#home";
      const result = originalRoute.call(this, target);
      const after = location.hash || "#home";
      if (after === before) {
        window.setTimeout(() => {
          try { window.renderRoute?.(); } catch (_) {}
        }, 0);
      }
      return result;
    };
    wrappedRoute.__dbNav028 = true;
    window.route = wrappedRoute;
  }

  window.leaveSession = function() {
    stopAudio();
    const target = currentScreen();
    if (typeof window.route === "function") {
      window.route(target);
    } else {
      try { window.renderRoute?.(); } catch (_) {}
    }
  };
})();

// Orchestre le tout premier chargement de l'app : splash (une seule fois par session),
// puis délègue la révélation du contenu à la page courante via AppBoot.ready(callback).
const AppBoot = (function () {
  let splash = null;
  let firstReadyDone = false;

  function start() {
    const hasSeenSplash = sessionStorage.getItem("denis_splash_shown") === "1";
    const appLogoEl = document.getElementById("app-logo");

    if (hasSeenSplash) {
      appLogoEl.style.opacity = "1";
      return;
    }
    appLogoEl.style.opacity = "0";
    splash = initSplash();
  }

  function ready(callback) {
    if (firstReadyDone) {
      callback();
      return;
    }
    firstReadyDone = true;

    if (splash) {
      splash.finish(() => {
        sessionStorage.setItem("denis_splash_shown", "1");
        callback();
      });
    } else {
      callback();
    }
  }

  return { start, ready };
})();

document.addEventListener("DOMContentLoaded", () => {
  initShareButton({ title: "Un Denis Presque Parfait" });
  initLogo();
  AppBoot.start();

  barba.init({
    transitions: [
      {
        name: "default",
        leave(data) {
          PageModules.unmount(data.current.namespace);
        },
        after(data) {
          PageModules.mount(data.next.namespace, data.next.container);
        },
      },
    ],
  });

  const initialContainer = document.querySelector('[data-barba="container"]');
  PageModules.mount(initialContainer.dataset.barbaNamespace, initialContainer);
});
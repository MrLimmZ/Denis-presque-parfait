// Séquence d'ouverture façon jeu vidéo :
// 1. Logo centré + barre de progression qui monte jusqu'à ~85% en attendant les vraies données
// 2. Une fois prêt, la barre finit à 100%
// 3. Le logo se déplace/rétrécit (via GSAP) vers sa position finale fixe en haut de page (#app-logo)
function initSplash() {
  const splash = document.createElement("div");
  splash.className = "splash";
  splash.id = "splash";
  splash.innerHTML = `
    <div class="splash-logo" id="splash-logo">${typeof LOGO_SVG !== "undefined" ? LOGO_SVG : ""}</div>
    <div class="splash-progress">
      <div class="splash-progress-bar" id="splash-progress-bar"></div>
    </div>
  `;
  document.body.insertBefore(splash, document.body.firstChild);

  const progressBarEl = document.getElementById("splash-progress-bar");
  const splashLogoEl = document.getElementById("splash-logo");

  gsap.set(progressBarEl, { width: "0%" });

  // Progression "faux départ" : monte à 85% et s'y tient en attendant les vraies données
  const growTween = gsap.to(progressBarEl, { width: "85%", duration: 1.1, ease: "power2.out" });

  return {
    finish(onDone) {
      const appLogoEl = document.getElementById("app-logo");

      // Coupe net le premier tween avant d'en démarrer un second sur la même propriété,
      // pour éviter le saut visuel dû au chevauchement des deux animations.
      growTween.kill();

      gsap.to(progressBarEl, {
        width: "100%",
        duration: 0.3,
        ease: "power1.out",
        immediateRender: false,
        onComplete: () => {
          const fromRect = splashLogoEl.getBoundingClientRect();
          const toRect = appLogoEl.getBoundingClientRect();

          const scale = toRect.width / fromRect.width;
          const deltaX = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
          const deltaY = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);

          const tl = gsap.timeline({
            onComplete: () => {
              // Le fond du splash est identique à celui de la page (var(--bg)),
              // donc retirer le splash d'un coup ne provoque aucun flash visuel.
              appLogoEl.style.opacity = "1";
              splash.remove();
              onDone && onDone();
            },
          });

          // La barre de progression disparaît discrètement, sans toucher au logo
          tl.to(splash.querySelector(".splash-progress"), { opacity: 0, duration: 0.2 }, 0);

          // Le logo se déplace/rétrécit sans jamais changer d'opacité
          tl.to(splashLogoEl, { x: deltaX, y: deltaY, scale, duration: 0.6, ease: "power2.inOut" }, 0.15);
        },
      });
    },
  };
}
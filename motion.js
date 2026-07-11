(() => {
  "use strict";

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const desktop = window.matchMedia("(min-width: 900px)");
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const lowPower =
    (Number(navigator.hardwareConcurrency) > 0 && navigator.hardwareConcurrency <= 4) ||
    (Number(navigator.deviceMemory) > 0 && navigator.deviceMemory <= 4);

  let disposers = [];
  let syncFrame = 0;

  const all = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    return () => target.removeEventListener(type, handler, options);
  };

  function clearMotionStyles() {
    for (const layer of all("[data-scene] [data-depth]")) {
      layer.style.removeProperty("--layer-x");
      layer.style.removeProperty("--layer-y");
    }

    for (const surface of all("[data-tilt] .tilt-surface")) {
      for (const property of ["--tilt-x", "--tilt-y", "--glare-x", "--glare-y", "--glare-opacity"]) {
        surface.style.removeProperty(property);
      }
    }
  }

  function clearCanvas() {
    const canvas = document.querySelector("#ambient-particles");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
    canvas.hidden = true;
  }

  function cleanup() {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = 0;
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose(); } catch { /* Cleanup must not block the next mode. */ }
    }
    clearMotionStyles();
    clearCanvas();
    root.classList.remove("motion-ready", "motion-full", "motion-lite", "motion-reduced", "motion-save-data", "motion-low-power", "motion-coarse");
    delete root.dataset.motion;
  }

  function initReveals(enabled) {
    const elements = all("[data-reveal]");
    if (!elements.length) return () => {};

    if (!enabled || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return () => {};
    }

    root.classList.add("motion-ready");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -10% 0px" });

    elements.filter((element) => !element.classList.contains("is-visible")).forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }

  function initParallax(enabled) {
    const scene = document.querySelector("[data-scene]");
    const layers = scene ? all("[data-depth]", scene) : [];
    if (!enabled || !scene || !layers.length) return () => {};

    let bounds = null;
    let frame = 0;
    let x = 0;
    let y = 0;

    const render = () => {
      frame = 0;
      for (const layer of layers) {
        const depth = clamp(Number(layer.dataset.depth) || 0, -1, 1);
        layer.style.setProperty("--layer-x", `${(x * 18 * depth).toFixed(2)}px`);
        layer.style.setProperty("--layer-y", `${(y * 12 * depth).toFixed(2)}px`);
      }
    };
    const requestRender = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const reset = () => {
      x = 0;
      y = 0;
      requestRender();
    };
    const enter = () => { bounds = scene.getBoundingClientRect(); };
    const move = (event) => {
      bounds ||= scene.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      x = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
      y = clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1);
      requestRender();
    };
    const invalidate = () => { bounds = null; };

    const removeListeners = [
      listen(scene, "pointerenter", enter, { passive: true }),
      listen(scene, "pointermove", move, { passive: true }),
      listen(scene, "pointerleave", reset, { passive: true }),
      listen(scene, "pointercancel", reset, { passive: true }),
      listen(window, "blur", reset),
      listen(window, "resize", invalidate, { passive: true }),
    ];

    return () => {
      removeListeners.forEach((remove) => remove());
      if (frame) cancelAnimationFrame(frame);
    };
  }

  function initTilt(enabled) {
    if (!enabled) return () => {};
    const removeListeners = [];
    const pendingFrames = new Set();

    for (const host of all("[data-tilt]")) {
      const surface = host.querySelector(".tilt-surface");
      if (!surface) continue;

      const maximum = clamp(Number(host.dataset.tilt) || 4, 0, 4);
      let bounds = null;
      let frame = 0;
      let x = 0.5;
      let y = 0.5;

      const render = () => {
        pendingFrames.delete(frame);
        frame = 0;
        surface.style.setProperty("--tilt-x", `${((0.5 - y) * maximum * 2).toFixed(2)}deg`);
        surface.style.setProperty("--tilt-y", `${((x - 0.5) * maximum * 2).toFixed(2)}deg`);
        surface.style.setProperty("--glare-x", `${(x * 100).toFixed(1)}%`);
        surface.style.setProperty("--glare-y", `${(y * 100).toFixed(1)}%`);
        surface.style.setProperty("--glare-opacity", "0.8");
      };
      const move = (event) => {
        if (host.matches(":focus-within")) {
          reset();
          return;
        }
        bounds ||= host.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
        y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
        if (!frame) {
          frame = requestAnimationFrame(render);
          pendingFrames.add(frame);
        }
      };
      const reset = () => {
        bounds = null;
        surface.style.setProperty("--tilt-x", "0deg");
        surface.style.setProperty("--tilt-y", "0deg");
        surface.style.setProperty("--glare-x", "50%");
        surface.style.setProperty("--glare-y", "50%");
        surface.style.setProperty("--glare-opacity", "0");
      };

      removeListeners.push(
        listen(host, "pointermove", move, { passive: true }),
        listen(host, "pointerleave", reset, { passive: true }),
        listen(host, "pointercancel", reset, { passive: true }),
        listen(host, "focusin", reset),
        listen(window, "blur", reset),
      );
    }

    return () => {
      removeListeners.forEach((remove) => remove());
      pendingFrames.forEach((frame) => cancelAnimationFrame(frame));
    };
  }

  function initParticles(enabled, compact) {
    const canvas = document.querySelector("#ambient-particles");
    const scene = canvas?.closest("[data-scene]") || canvas?.parentElement;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!enabled || !canvas || !scene || !context) {
      clearCanvas();
      return () => {};
    }

    canvas.hidden = false;
    canvas.setAttribute("aria-hidden", "true");

    const count = compact ? 8 : 18;
    const frameInterval = 1000 / (compact ? 20 : 30);
    let width = 1;
    let height = 1;
    let particles = [];
    let animationFrame = 0;
    let resizeFrame = 0;
    let lastPaint = 0;
    let inView = true;

    const createParticles = () => Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 1 + Math.random() * 2,
      velocityX: (Math.random() - 0.5) * 7,
      velocityY: -(4 + Math.random() * 9),
      phase: Math.random() * Math.PI * 2,
      alpha: 0.08 + Math.random() * 0.2,
      warm: index % 5 === 0,
    }));

    const resize = () => {
      resizeFrame = 0;
      const bounds = scene.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = createParticles();
    };
    const scheduleResize = () => {
      if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
    };
    const shouldRun = () => inView && !document.hidden;

    const draw = (time) => {
      animationFrame = 0;
      if (!shouldRun()) return;
      animationFrame = requestAnimationFrame(draw);
      if (time - lastPaint < frameInterval) return;

      const elapsed = Math.min((time - (lastPaint || time)) / 1000, 0.05);
      lastPaint = time;
      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        particle.x += particle.velocityX * elapsed + Math.sin(time * 0.0007 + particle.phase) * 0.08;
        particle.y += particle.velocityY * elapsed;
        if (particle.y < -4) {
          particle.y = height + 4;
          particle.x = Math.random() * width;
        }
        if (particle.x < -4) particle.x = width + 4;
        if (particle.x > width + 4) particle.x = -4;

        context.fillStyle = particle.warm
          ? `rgba(255, 227, 110, ${particle.alpha})`
          : `rgba(96, 231, 255, ${particle.alpha})`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }
    };
    const start = () => {
      if (!animationFrame && shouldRun()) {
        lastPaint = 0;
        animationFrame = requestAnimationFrame(draw);
      }
    };
    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const updatePlayback = () => { shouldRun() ? start() : stop(); };

    resize();
    const removeListeners = [
      listen(document, "visibilitychange", updatePlayback),
      listen(window, "resize", scheduleResize, { passive: true }),
    ];

    let visibilityObserver = null;
    if ("IntersectionObserver" in window) {
      visibilityObserver = new IntersectionObserver(([entry]) => {
        inView = Boolean(entry?.isIntersecting);
        updatePlayback();
      }, { threshold: 0 });
      visibilityObserver.observe(scene);
    }

    let resizeObserver = null;
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(scene);
    }

    start();
    return () => {
      stop();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      visibilityObserver?.disconnect();
      resizeObserver?.disconnect();
      removeListeners.forEach((remove) => remove());
    };
  }

  function syncMotion() {
    syncFrame = 0;
    cleanup();

    const reduced = reduceMotion.matches;
    const saveData = connection?.saveData === true;
    const coarse = !finePointer.matches;
    const full = !reduced && !saveData && !lowPower && !coarse && desktop.matches;
    const particles = !reduced && !saveData && !lowPower;

    root.dataset.motion = reduced ? "reduced" : full ? "full" : "lite";
    root.classList.toggle("motion-reduced", reduced);
    root.classList.toggle("motion-full", full);
    root.classList.toggle("motion-lite", !reduced && !full);
    root.classList.toggle("motion-save-data", saveData);
    root.classList.toggle("motion-low-power", lowPower);
    root.classList.toggle("motion-coarse", coarse);

    disposers = [
      initReveals(!reduced),
      initParallax(full),
      initTilt(full),
      initParticles(particles, coarse || !desktop.matches),
    ];
  }

  function scheduleSync() {
    if (!syncFrame) syncFrame = requestAnimationFrame(syncMotion);
  }

  const watchMedia = (query) => {
    if (query.addEventListener) query.addEventListener("change", scheduleSync);
    else query.addListener(scheduleSync);
  };

  watchMedia(reduceMotion);
  watchMedia(finePointer);
  watchMedia(desktop);
  connection?.addEventListener?.("change", scheduleSync);
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("pageshow", scheduleSync);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleSync, { once: true });
  } else {
    scheduleSync();
  }
})();

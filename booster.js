// booster.js - Mobile-first Web Performance Booster
// Goal: deliver smooth, jank-free experiences on smartphones using layered strategies
(function () {
  'use strict';

  // ---- Config & Feature Detection ----
  const networkInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isSaveData = !!(networkInfo && networkInfo.saveData);
  const effectiveType = (networkInfo && networkInfo.effectiveType) || '4g';
  const isSlowConnection = isSaveData || effectiveType === '2g' || effectiveType === 'slow-2g' || effectiveType === '3g';
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // On slower networks, preload very close to viewport to avoid bandwidth spikes.
  // On fast networks, preload a bit earlier to hide reveals during quick scrolls.
  const LAZY_ROOT_MARGIN = isSlowConnection ? '256px 0px' : '600px 0px';
  const LAZY_THRESHOLD = 0.01;

  const rIC = window.requestIdleCallback || function (cb) { return setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1); };

  // ---- CSS Injection (GPU layers, content-visibility, scroll smoothing) ----
  function injectStyles() {
    const style = document.createElement('style');
    style.setAttribute('data-booster', 'true');
    style.textContent = `
      /* Create composited layers for smoother transforms */
      .gpu-layer { will-change: transform; transform: translateZ(0); backface-visibility: hidden; }

      /* Optional content-visibility for large lists/grids */
      @supports (content-visibility: auto) {
        .cv-auto { content-visibility: auto; contain-intrinsic-size: 1px 1000px; }
      }

      /* Hint browsers to not block on touch handlers */
      html, body { -webkit-tap-highlight-color: transparent; }

      /* Smooth anchor scrolling when not reduced motion */
      ${prefersReducedMotion ? '' : 'html:focus-within { scroll-behavior: smooth; }'}

      /* iOS momentum scrolling for overflowing containers */
      .scroll-container { -webkit-overflow-scrolling: touch; }

      /* Images default optimizations */
      img[loading="lazy"] { contain: paint; } /* helps avoid large repaint regions */
    `;
    document.head.appendChild(style);
  }

  // ---- Helpers for Attribute Upgrades ----
  function setIfPresent(el, attr, value) {
    if (value != null && value !== '') {
      el.setAttribute(attr, value);
    }
  }

  function upgradeImageElement(img) {
    // Native hints first
    if ('loading' in HTMLImageElement.prototype) {
      setIfPresent(img, 'loading', 'lazy');
    }
    if ('decoding' in HTMLImageElement.prototype) {
      setIfPresent(img, 'decoding', 'async');
    }
    if ('fetchPriority' in img) {
      // Lower priority for offscreen images
      setIfPresent(img, 'fetchpriority', 'low');
    }

    // Apply responsive attributes
    const dataSrc = img.getAttribute('data-src');
    const dataSrcSet = img.getAttribute('data-srcset');
    const dataSizes = img.getAttribute('data-sizes');

    if (dataSrcSet) {
      img.srcset = dataSrcSet;
      img.removeAttribute('data-srcset');
    }
    if (dataSizes) {
      img.sizes = dataSizes;
      img.removeAttribute('data-sizes');
    }
    if (dataSrc) {
      img.src = dataSrc;
      img.removeAttribute('data-src');
    }

    // Decode to avoid flashes/reflows where supported
    if (typeof img.decode === 'function') {
      img.decode().catch(() => void 0);
    }
  }

  function upgradePictureElement(picture) {
    // Upgrade child <source> first, then the <img>
    const sources = picture.querySelectorAll('source[data-srcset]');
    sources.forEach((source) => {
      source.srcset = source.getAttribute('data-srcset');
      source.removeAttribute('data-srcset');
      const dataSizes = source.getAttribute('data-sizes');
      if (dataSizes) {
        source.sizes = dataSizes;
        source.removeAttribute('data-sizes');
      }
    });
    const img = picture.querySelector('img');
    if (img) upgradeImageElement(img);
  }

  function upgradeIframe(iframe) {
    if ('loading' in HTMLIFrameElement.prototype) {
      setIfPresent(iframe, 'loading', 'lazy');
    }
    const dataSrc = iframe.getAttribute('data-src');
    if (dataSrc) {
      iframe.src = dataSrc;
      iframe.removeAttribute('data-src');
    }
  }

  function upgradeVideo(video) {
    const dataPoster = video.getAttribute('data-poster');
    if (dataPoster) {
      video.poster = dataPoster;
      video.removeAttribute('data-poster');
    }
    const sources = video.querySelectorAll('source[data-src], source[data-srcset]');
    sources.forEach((source) => {
      const s = source.getAttribute('data-src');
      const ss = source.getAttribute('data-srcset');
      if (s) { source.src = s; source.removeAttribute('data-src'); }
      if (ss) { source.srcset = ss; source.removeAttribute('data-srcset'); }
    });
    // Autoplay only if muted and allowed; do not force on mobile
    if (video.hasAttribute('data-autoload')) {
      // Load only, do not play to avoid jank
      video.load();
    }
  }

  function upgradeBackground(el) {
    const dataBg = el.getAttribute('data-bg');
    if (dataBg) {
      el.style.backgroundImage = `url("${dataBg}")`;
      el.removeAttribute('data-bg');
    }
  }

  function upgradeLazyElement(el) {
    const tag = el.tagName;
    if (tag === 'IMG') return upgradeImageElement(el);
    if (tag === 'PICTURE') return upgradePictureElement(el);
    if (tag === 'IFRAME') return upgradeIframe(el);
    if (tag === 'VIDEO') return upgradeVideo(el);
    if (el.hasAttribute('data-bg')) return upgradeBackground(el);

    // Generic swap for data-src / data-srcset
    const dataSrc = el.getAttribute('data-src');
    const dataSrcSet = el.getAttribute('data-srcset');
    if (dataSrc) { el.setAttribute('src', dataSrc); el.removeAttribute('data-src'); }
    if (dataSrcSet) { el.setAttribute('srcset', dataSrcSet); el.removeAttribute('data-srcset'); }
  }

  // ---- Lazy Loading Core (with IntersectionObserver + robust fallback) ----
  function setupLazyLoading() {
    const selector = [
      'img[data-src]', 'img[data-srcset]', 'picture source[data-srcset]', 'picture img[data-src]',
      'iframe[data-src]', 'video[data-poster]', 'video source[data-src]', 'video source[data-srcset]',
      '[data-bg]'
    ].join(',');

    /** Ensure elements have native lazy hint if supported */
    document.querySelectorAll('img, iframe').forEach((el) => {
      if ('loading' in HTMLImageElement.prototype && el.tagName === 'IMG') {
        el.setAttribute('loading', 'lazy');
      }
      if ('loading' in HTMLIFrameElement.prototype && el.tagName === 'IFRAME') {
        el.setAttribute('loading', 'lazy');
      }
    });

    const lazyElements = Array.from(document.querySelectorAll(selector));
    if (lazyElements.length === 0) return;

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            const target = entry.target;
            observer.unobserve(target);
            upgradeLazyElement(target);
          }
        });
      }, { rootMargin: LAZY_ROOT_MARGIN, threshold: LAZY_THRESHOLD });

      lazyElements.forEach((el) => observer.observe(el));

      // Re-evaluate on viewport size changes (e.g., orientation)
      if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(() => {
          // Nudge IO to recalc by briefly disconnecting/reconnecting
          lazyElements.forEach((el) => {
            if (document.documentElement.contains(el)) {
              observer.unobserve(el);
              observer.observe(el);
            }
          });
        });
        ro.observe(document.documentElement);
      }
    } else {
      // Fallback: viewport proximity check with RAF throttle
      const pending = new Set(lazyElements);
      const viewportBuffer = isSlowConnection ? 200 : 500; // px
      let ticking = false;

      function inView(el) {
        const rect = el.getBoundingClientRect();
        const vpH = window.innerHeight || document.documentElement.clientHeight;
        const vpW = window.innerWidth || document.documentElement.clientWidth;
        return (
          rect.bottom >= -viewportBuffer &&
          rect.right >= -viewportBuffer &&
          rect.top <= vpH + viewportBuffer &&
          rect.left <= vpW + viewportBuffer
        );
      }

      function process() {
        ticking = false;
        pending.forEach((el) => {
          if (inView(el)) {
            pending.delete(el);
            upgradeLazyElement(el);
          }
        });
        if (pending.size === 0) {
          window.removeEventListener('scroll', onScroll, passiveOpts);
          window.removeEventListener('resize', onScroll, passiveOpts);
          window.removeEventListener('orientationchange', onScroll, passiveOpts);
          document.removeEventListener('visibilitychange', onVisibility, passiveOpts);
        }
      }

      function onScroll() {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(process);
        }
      }

      function onVisibility() {
        if (document.visibilityState === 'visible') onScroll();
      }

      const passiveOpts = { passive: true };
      window.addEventListener('scroll', onScroll, passiveOpts);
      window.addEventListener('resize', onScroll, passiveOpts);
      window.addEventListener('orientationchange', onScroll, passiveOpts);
      document.addEventListener('visibilitychange', onVisibility, passiveOpts);
      // Kickoff
      onScroll();
    }
  }

  // ---- Anchor Smooth-Scroll (safe, reduced-motion aware) ----
  function setupAnchorSmoothScroll() {
    if (prefersReducedMotion) return;

    document.addEventListener('click', (event) => {
      const anchor = event.target && event.target.closest && event.target.closest('a[href^="#"]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href === '#' || href.length === 1) return;

      const target = document.getElementById(href.slice(1));
      if (!target) return;

      // Let browser handle if CSS smooth behavior already active
      if ('scrollBehavior' in document.documentElement.style) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, { passive: true });
  }

  // ---- Critical CSS Handler (non-destructive) ----
  // Moves <style critical> to the top of <head> and removes the attribute.
  function inlineCriticalCSS() {
    const criticalStyles = Array.from(document.querySelectorAll('style[critical]'));
    if (criticalStyles.length === 0) return;

    const head = document.head || document.getElementsByTagName('head')[0];
    criticalStyles.forEach((style) => {
      style.removeAttribute('critical');
      if (style.parentNode !== head) {
        head.insertBefore(style, head.firstChild);
      } else {
        // Already in head: move to top to prioritize
        head.insertBefore(style, head.firstChild);
      }
    });
  }

  // ---- Connection-aware Source Selection ----
  // If slow connection, prefer lower-res variants declared via data-src-slow / data-srcset-slow
  function applyConnectionAwareSources() {
    if (!isSlowConnection) return;

    const swapMap = [
      { sel: 'img[data-src-slow]', attr: 'data-src-slow', to: 'data-src' },
      { sel: 'img[data-srcset-slow]', attr: 'data-srcset-slow', to: 'data-srcset' },
      { sel: 'source[data-srcset-slow]', attr: 'data-srcset-slow', to: 'data-srcset' },
      { sel: '[data-bg-slow]', attr: 'data-bg-slow', to: 'data-bg' }
    ];

    swapMap.forEach(({ sel, attr, to }) => {
      document.querySelectorAll(sel).forEach((el) => {
        const val = el.getAttribute(attr);
        if (val) {
          el.setAttribute(to, val);
        }
      });
    });
  }

  // ---- Event Listeners: Passive by default for scroll/touch/wheel ----
  function setupPassiveListeners() {
    const passive = { passive: true };
    // These are no-op placeholders to enforce passive listeners to avoid blocking scroll.
    // Add only if not already attached elsewhere in app code.
    window.addEventListener('scroll', function () {}, passive);
    window.addEventListener('touchstart', function () {}, passive);
    window.addEventListener('touchmove', function () {}, passive);
    window.addEventListener('wheel', function () {}, passive);
  }

  // ---- Boot sequence ----
  function init() {
    injectStyles();
    inlineCriticalCSS();
    applyConnectionAwareSources();

    // Defer heavier work to idle time so first paint is not delayed
    rIC(() => {
      setupLazyLoading();
      setupAnchorSmoothScroll();
      setupPassiveListeners();
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
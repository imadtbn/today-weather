(() => {
  'use strict';

  const script = document.currentScript;
  const scriptPath = script ? new URL(script.src, location.href).pathname : '/assets/js/image-loader.js';
  const basePath = scriptPath.replace(/\/assets\/js\/image-loader\.js$/, '').replace(/\/$/, '');
  const fallbackUrl = (basePath || '') + '/assets/images/icon1.webp';
  const MAX_CONCURRENT = 4;
  const MAX_RETRIES = 2;
  const queue = [];
  let active = 0;
  let observer = null;

  function withRetryParam(source, attempt) {
    try {
      const url = new URL(source, location.href);
      url.searchParams.set('image-retry', String(attempt));
      return url.href;
    } catch {
      return source;
    }
  }

  function enqueue(task) {
    queue.push(task);
    drain();
  }

  function drain() {
    while (active < MAX_CONCURRENT && queue.length) {
      const task = queue.shift();
      active++;
      Promise.resolve().then(task).catch(() => {}).finally(() => {
        active--;
        drain();
      });
    }
  }

  function waitForImage(img, source) {
    return new Promise(resolve => {
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        resolve(success);
      };
      const onLoad = () => finish(img.naturalWidth > 0);
      const onError = () => finish(false);
      const timeout = setTimeout(() => finish(false), 15000);
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
      img.src = source;
      if (img.complete) queueMicrotask(() => finish(img.naturalWidth > 0));
    });
  }

  async function loadDeferred(img) {
    if (img.dataset.imageLoading === 'true' || img.dataset.imageLoaded === 'true') return;
    const original = img.dataset.src;
    if (!original) return;
    img.dataset.imageLoading = 'true';
    img.dataset.imageManaged = 'true';
    delete img.dataset.src;

    let loaded = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      loaded = await waitForImage(img, attempt ? withRetryParam(original, attempt) : original);
      if (loaded) break;
      if (attempt < MAX_RETRIES) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }

    if (!loaded) await applyFallback(img);
    else img.dataset.imageLoaded = 'true';
    delete img.dataset.imageLoading;
  }

  async function applyFallback(img) {
    if (img.dataset.imageFallbackApplied === 'true') {
      img.classList.add('image-load-failed');
      img.style.visibility = 'hidden';
      img.setAttribute('aria-hidden', 'true');
      return;
    }
    img.dataset.imageFallbackApplied = 'true';
    img.dataset.imageManaged = 'true';
    img.alt = 'صورة توضيحية بديلة';
    img.removeAttribute('srcset');
    const loaded = await waitForImage(img, fallbackUrl);
    if (loaded) img.dataset.imageLoaded = 'true';
    else {
      img.classList.add('image-load-failed');
      img.setAttribute('aria-hidden', 'true');
    }
  }

  function observeImage(img) {
    if (!(img instanceof HTMLImageElement) || img.dataset.imageObserved === 'true') return;
    img.dataset.imageObserved = 'true';
    img.decoding = 'async';

    if (img.dataset.src) {
      img.loading = 'lazy';
      if (observer) observer.observe(img);
      else enqueue(() => loadDeferred(img));
    }
  }

  function retryFailedImage(img) {
    if (img.dataset.imageManaged === 'true' || img.dataset.imageFallbackApplied === 'true') return;
    img.dataset.imageManaged = 'true';
    enqueue(async () => {
      const original = img.dataset.imageOriginal || img.currentSrc || img.src;
      img.dataset.imageOriginal = original;
      let loaded = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        img.dataset.imageRetries = String(attempt);
        loaded = await waitForImage(img, withRetryParam(original, attempt));
        if (loaded) break;
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      }
      if (!loaded) await applyFallback(img);
    });
  }

  function start() {
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            enqueue(() => loadDeferred(entry.target));
          }
        });
      }, { rootMargin: '700px 0px', threshold: 0.01 });
    }

    document.addEventListener('error', event => {
      if (event.target instanceof HTMLImageElement) retryFailedImage(event.target);
    }, true);

    const lazyImages = document.querySelectorAll('img[data-src]');
    if (!lazyImages.length) return;

    lazyImages.forEach(observeImage);
    const mutationObserver = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('img[data-src]')) observeImage(node);
        node.querySelectorAll?.('img[data-src]').forEach(observeImage);
      }));
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
// AdSense initialization and privacy-safe diagnostics for approved ad containers.
(function () {
    'use strict';

    const AD_SELECTOR = 'ins.adsbygoogle';
    const AD_CONTAINER_SELECTOR = '.ad-container';
    const initializedAds = new WeakSet();
    const pendingAds = new Set();
    let resizeObserver = null;
    let flushScheduled = false;
    const debugEnabled = new URLSearchParams(window.location.search).has('ads-debug');

    function emitDiagnostic(name, detail) {
        const payload = Object.assign({ timestamp: new Date().toISOString() }, detail);
        window.dispatchEvent(new CustomEvent(name, { detail: payload }));
        if (debugEnabled) console.info('[AdSense]', name, payload);
    }

    function getPlacement(ad) {
        const container = ad.closest('[data-ad-placement]');
        return container ? container.getAttribute('data-ad-placement') : 'unknown';
    }

    function reportAdStatus(ad) {
        if (!ad || !ad.matches(AD_SELECTOR)) return;

        const googleStatus = ad.getAttribute('data-ad-status');
        let status = 'pending';

        if (googleStatus === 'filled') status = 'filled';
        else if (googleStatus === 'unfilled') status = 'unfilled';
        else if (ad.hasAttribute('data-adsbygoogle-status')) status = 'requested';
        else if (ad.dataset.adsInit === 'queued') status = 'initialized';

        if (ad.dataset.adsDiagnosticStatus === status) return;
        ad.dataset.adsDiagnosticStatus = status;

        emitDiagnostic('adsense:status', {
            slot: ad.getAttribute('data-ad-slot') || 'unknown',
            placement: getPlacement(ad),
            status: status,
            googleStatus: googleStatus || null
        });
    }

    function reportLoaderStatus(status, detail) {
        if (document.documentElement.dataset.adsLoaderStatus === status) return;
        document.documentElement.dataset.adsLoaderStatus = status;
        emitDiagnostic('adsense:loader', {
            status: status,
            detail: detail || null
        });
    }

    function getLoaderResourceEntry(loader) {
        if (!loader || !window.performance || typeof window.performance.getEntriesByName !== 'function') {
            return null;
        }

        try {
            const entries = window.performance.getEntriesByName(loader.src, 'resource');
            return entries.length ? entries[entries.length - 1] : null;
        } catch (error) {
            return null;
        }
    }

    function reportPreviouslyLoadedResource(loader) {
        const entry = getLoaderResourceEntry(loader);
        if (!entry || !(entry.responseEnd > entry.startTime)) return false;

        // Resource Timing may hide cross-origin status/size fields without Timing-Allow-Origin.
        // Distinguish a confirmed HTTP 200 from a completed-but-unverifiable transfer.
        if (entry.responseStatus === 200) {
            reportLoaderStatus('loaded', 'AdSense resource completed before diagnostics attached');
        } else if ((entry.encodedBodySize || 0) > 0 || (entry.decodedBodySize || 0) > 0) {
            reportLoaderStatus('loaded', 'AdSense resource body was received before diagnostics attached');
        } else {
            reportLoaderStatus('resource-observed', 'A completed AdSense resource timing entry exists; HTTP success is not exposed');
        }
        return true;
    }

    function watchLoader() {
        const loader = document.querySelector('script[src*="adsbygoogle.js"]');
        if (!loader) {
            reportLoaderStatus('missing', 'AdSense script element was not found');
            return;
        }

        // Attach both element and capture-phase listeners before checking buffered timing.
        // This handles normal loads, resource errors, and loads that finished before this file ran.
        loader.addEventListener('load', function () {
            reportLoaderStatus('loaded');
        }, { once: true });
        loader.addEventListener('error', function () {
            reportLoaderStatus('error', 'AdSense script load event failed');
        }, { once: true });
        document.addEventListener('load', function (event) {
            if (event.target === loader) reportLoaderStatus('loaded');
        }, true);
        document.addEventListener('error', function (event) {
            const target = event.target;
            if (target === loader || (target && target.tagName === 'SCRIPT' &&
                target.src && target.src.indexOf('adsbygoogle.js') !== -1)) {
                reportLoaderStatus('error', 'AdSense script resource error');
            }
        }, true);

        if (!reportPreviouslyLoadedResource(loader)) {
            reportLoaderStatus('pending', 'Waiting for AdSense script load or error');
        }
    }

    function removeUnapprovedPlacements(root) {
        // Never remove Google-managed placements. AdSense may still be resolving
        // a generated slot when its wrapper first appears in the DOM; removing it
        // at that moment causes the provider's "no_div" TagError.
        const scope = root && root.querySelectorAll ? root : document;
        const candidates = [];
        if (scope.matches && scope.matches(AD_SELECTOR)) candidates.push(scope);
        scope.querySelectorAll(AD_SELECTOR).forEach(function (ad) {
            candidates.push(ad);
        });

        candidates.forEach(function (ad) {
            if (ad.closest('.google-auto-placed')) return;
            if (ad.hasAttribute('data-adsbygoogle-status')) return;
            if (!ad.closest(AD_CONTAINER_SELECTOR) || ad.closest('.site-header')) {
                // This is uninitialized markup owned by the page, not an
                // AdSense-generated node. Safe to discard before provider pickup.
                ad.remove();
            }
        });
    }

    function isApproved(ad) {
        return ad.isConnected &&
            ad.closest(AD_CONTAINER_SELECTOR) !== null &&
            ad.closest('.site-header') === null &&
            Boolean(ad.getAttribute('data-ad-client')) &&
            Boolean(ad.getAttribute('data-ad-slot'));
    }

    function getAvailableWidth(ad) {
        const container = ad.closest(AD_CONTAINER_SELECTOR);
        if (!container || !ad.isConnected) return 0;
        const adWidth = ad.getBoundingClientRect().width;
        const parentWidth = ad.parentElement ? ad.parentElement.getBoundingClientRect().width : 0;
        const containerWidth = container.getBoundingClientRect().width;
        return Math.max(adWidth, parentWidth, containerWidth);
    }

    function schedulePendingAds() {
        if (flushScheduled) return;
        flushScheduled = true;
        requestAnimationFrame(function () {
            flushScheduled = false;
            flushPendingAds();
        });
    }

    function flushPendingAds() {
        const ordered = Array.from(pendingAds).sort(function (a, b) {
            if (a === b) return 0;
            return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });

        for (const ad of ordered) {
            if (!ad.isConnected || !isApproved(ad)) {
                pendingAds.delete(ad);
                continue;
            }
            if (initializedAds.has(ad) || ad.hasAttribute('data-adsbygoogle-status')) {
                pendingAds.delete(ad);
                reportAdStatus(ad);
                continue;
            }

            // AdSense throws TagError when its next slot has no measurable width.
            // Preserve DOM order and wait for the first pending slot to become visible.
            if (getAvailableWidth(ad) < 2) {
                reportAdStatus(ad);
                break;
            }

            pendingAds.delete(ad);
            initializedAds.add(ad);
            ad.dataset.adsInit = 'pending';
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
                ad.dataset.adsInit = 'queued';
                reportAdStatus(ad);
            } catch (error) {
                initializedAds.delete(ad);
                delete ad.dataset.adsInit;
                ad.dataset.adsDiagnosticStatus = 'init-error';
                emitDiagnostic('adsense:status', {
                    slot: ad.getAttribute('data-ad-slot') || 'unknown',
                    placement: getPlacement(ad),
                    status: 'init-error',
                    message: error && error.message ? error.message : 'Unknown initialization error'
                });
                console.warn('[AdSense] تعذرت تهيئة الوحدة الإعلانية:', error);
                break;
            }
        }
    }

    function initializeAds(root) {
        const scope = root && root.querySelectorAll ? root : document;
        removeUnapprovedPlacements(scope);
        const candidates = [];
        if (scope.matches && scope.matches(AD_SELECTOR)) candidates.push(scope);
        scope.querySelectorAll(AD_SELECTOR).forEach(function (ad) {
            candidates.push(ad);
        });

        candidates.forEach(function (ad) {
            if (!isApproved(ad) || initializedAds.has(ad) ||
                ad.dataset.adsInit === 'pending' || ad.hasAttribute('data-adsbygoogle-status')) {
                reportAdStatus(ad);
                return;
            }
            pendingAds.add(ad);
            const container = ad.closest(AD_CONTAINER_SELECTOR);
            if (resizeObserver && container) resizeObserver.observe(container);
        });
        schedulePendingAds();
    }

    function start() {
        watchLoader();

        if ('ResizeObserver' in window) {
            resizeObserver = new ResizeObserver(schedulePendingAds);
            document.querySelectorAll(AD_CONTAINER_SELECTOR).forEach(function (container) {
                resizeObserver.observe(container);
            });
        }
        window.addEventListener('resize', schedulePendingAds, { passive: true });
        initializeAds();

        const observer = new MutationObserver(function (records) {
            records.forEach(function (record) {
                if (record.type === 'attributes') {
                    reportAdStatus(record.target);
                    return;
                }

                record.addedNodes.forEach(function (node) {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    // Google inserts its own .google-auto-placed wrappers asynchronously.
                    // Do not pass those nodes through page-owned placement cleanup.
                    if (node.matches('.google-auto-placed') || node.closest('.google-auto-placed')) return;
                    if (node.matches(AD_SELECTOR) || node.querySelector(AD_SELECTOR)) {
                        initializeAds(node);
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-ad-status', 'data-adsbygoogle-status']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();

// AdSense initialization and privacy-safe diagnostics for approved ad containers.
(function () {
    'use strict';

    const AD_SELECTOR = 'ins.adsbygoogle';
    const AD_CONTAINER_SELECTOR = '.ad-container';
    const initializedAds = new WeakSet();
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

    function watchLoader() {
        const loader = document.querySelector('script[src*="adsbygoogle.js"]');
        if (loader) {
            loader.addEventListener('load', function () {
                reportLoaderStatus('loaded');
            }, { once: true });
            loader.addEventListener('error', function () {
                reportLoaderStatus('error', 'AdSense script load event failed');
            }, { once: true });
        }

        document.addEventListener('error', function (event) {
            const target = event.target;
            if (target && target.tagName === 'SCRIPT' &&
                target.src && target.src.indexOf('adsbygoogle.js') !== -1) {
                reportLoaderStatus('error', 'AdSense script resource error');
            }
        }, true);
    }

    function removeUnapprovedPlacements(root) {
        const scope = root && root.querySelectorAll ? root : document;
        if (scope.matches && scope.matches('.google-auto-placed') &&
            (!scope.closest(AD_CONTAINER_SELECTOR) || scope.closest('.site-header'))) {
            scope.remove();
            return;
        }
        if (scope.matches && scope.matches(AD_SELECTOR) &&
            (!scope.closest(AD_CONTAINER_SELECTOR) || scope.closest('.site-header'))) {
            scope.remove();
            return;
        }
        scope.querySelectorAll('.google-auto-placed').forEach(function (wrapper) {
            if (!wrapper.closest(AD_CONTAINER_SELECTOR) || wrapper.closest('.site-header')) wrapper.remove();
        });
        scope.querySelectorAll(AD_SELECTOR).forEach(function (ad) {
            if (!ad.closest(AD_CONTAINER_SELECTOR) || ad.closest('.site-header')) ad.remove();
        });
    }

    function isApproved(ad) {
        return ad.isConnected &&
            ad.closest(AD_CONTAINER_SELECTOR) !== null &&
            ad.closest('.site-header') === null &&
            Boolean(ad.getAttribute('data-ad-client')) &&
            Boolean(ad.getAttribute('data-ad-slot'));
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
                ad.dataset.adsInit === 'pending' ||
                ad.hasAttribute('data-adsbygoogle-status')) {
                reportAdStatus(ad);
                return;
            }

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
            }
        });
    }

    function start() {
        watchLoader();
        initializeAds();

        const observer = new MutationObserver(function (records) {
            records.forEach(function (record) {
                if (record.type === 'attributes') {
                    reportAdStatus(record.target);
                    return;
                }

                record.addedNodes.forEach(function (node) {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (node.matches(AD_SELECTOR) || node.querySelector(AD_SELECTOR) ||
                        node.matches('.google-auto-placed') || node.querySelector('.google-auto-placed')) {
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

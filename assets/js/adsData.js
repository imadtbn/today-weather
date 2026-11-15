// AdSense initialization for explicitly approved ad containers only.
(function () {
    'use strict';

    const AD_SELECTOR = 'ins.adsbygoogle';
    const AD_CONTAINER_SELECTOR = '.ad-container';
    const initializedAds = new WeakSet();

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
        scope.querySelectorAll('.google-auto-placed').forEach(wrapper => {
            if (!wrapper.closest(AD_CONTAINER_SELECTOR) || wrapper.closest('.site-header')) wrapper.remove();
        });
        scope.querySelectorAll(AD_SELECTOR).forEach(ad => {
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
        scope.querySelectorAll(AD_SELECTOR).forEach(ad => candidates.push(ad));

        candidates.forEach(ad => {
            if (!isApproved(ad) || initializedAds.has(ad) ||
                ad.dataset.adsInit === 'pending' ||
                ad.hasAttribute('data-adsbygoogle-status')) return;

            // Prevent duplicate queue entries across load and DOM mutation callbacks.
            initializedAds.add(ad);
            ad.dataset.adsInit = 'pending';
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
                ad.dataset.adsInit = 'queued';
            } catch (error) {
                initializedAds.delete(ad);
                delete ad.dataset.adsInit;
                console.warn('[AdSense] تعذرت تهيئة الوحدة الإعلانية:', error);
            }
        });
    }

    function start() {
        initializeAds();
        const observer = new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node.matches(AD_SELECTOR) || node.querySelector(AD_SELECTOR) ||
                    node.matches('.google-auto-placed') || node.querySelector('.google-auto-placed')) {
                    initializeAds(node);
                }
            }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();

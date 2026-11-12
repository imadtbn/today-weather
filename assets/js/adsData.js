// AdSense: لا تُحمّل الإعلانات إلا داخل الحاويات المخصصة لها.
(function () {
    'use strict';

    const AD_SELECTOR = 'ins.adsbygoogle';
    const PLACEMENT_SELECTOR = '.google-auto-placed, ins.adsbygoogle, iframe[id^="google_ads_iframe"], iframe[src*="doubleclick.net"]';

    function removeUnapprovedPlacements() {
        document.querySelectorAll(PLACEMENT_SELECTOR).forEach(element => {
            const insideHeader = element.closest('.site-header');
            const insideAdContainer = element.closest('.ad-container');

            if (insideHeader || !insideAdContainer) {
                const wrapper = element.closest('.google-auto-placed');
                (wrapper || element).remove();
            }
        });
    }

    function initializeAds() {
        removeUnapprovedPlacements();

        document.querySelectorAll(AD_SELECTOR).forEach(ad => {
            if (!ad.closest('.ad-container') || ad.closest('.site-header')) {
                ad.remove();
                return;
            }

            if (ad.hasAttribute('data-adsbygoogle-status')) return;

            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (error) {
                console.warn('[AdSense] تعذر تهيئة الوحدة الإعلانية:', error);
            }
        });
    }

    function start() {
        initializeAds();

        // مراقبة الإضافات الديناميكية لمنع الإعلانات التلقائية خارج الحاويات.
        const observer = new MutationObserver(removeUnapprovedPlacements);
        observer.observe(document.body, { childList: true, subtree: true });

        window.addEventListener('load', initializeAds, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();

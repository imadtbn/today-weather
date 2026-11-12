// AdSense: لا تُحمّل الإعلانات إلا داخل الحاويات المخصصة لها.
(function () {
    'use strict';

    const AD_SELECTOR = 'ins.adsbygoogle';
    const AD_CONTAINER_SELECTOR = '.ad-container';

    function removeHeaderAds() {
        const header = document.querySelector('.site-header');
        if (!header) return;

        header.querySelectorAll(
            '.google-auto-placed, ins.adsbygoogle, iframe[id^="google_ads_iframe"], iframe[src*="doubleclick.net"]'
        ).forEach(element => {
            const wrapper = element.closest('.google-auto-placed');
            (wrapper || element).remove();
        });
    }

    function initializeAds() {
        removeHeaderAds();

        // أي وحدة خارج حاوية الإعلانات المعتمدة لا يُسمح بتهيئتها.
        document.querySelectorAll(AD_SELECTOR).forEach(ad => {
            if (!ad.closest(AD_CONTAINER_SELECTOR)) {
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

        // منع الإعلانات التلقائية من الظهور داخل الهيدر بعد تحميل الصفحة.
        const observer = new MutationObserver(() => {
            removeHeaderAds();
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // إعادة فحص وحدات الإعلانات بعد اكتمال تحميل الموارد.
        window.addEventListener('load', initializeAds, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();

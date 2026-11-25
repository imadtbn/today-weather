// AdSense initialization and privacy-safe diagnostics for approved ad containers.
(function () {
    'use strict';

    const AD_SELECTOR = 'ins.adsbygoogle';
    const AD_CONTAINER_SELECTOR = '.ad-container';
    const initializedAds = new WeakSet();
    const observedAds = new WeakSet();
    const reportedHeaderAds = new WeakSet();
    const reportedGoogleManagedAds = new WeakSet();
    const pendingAds = new Set();
    const stableMeasurements = new WeakMap();
    let resizeObserver = null;
    let flushScheduled = false;
    let adsenseReady = false;
    let pushCount = 0;
    let lastPush = null;
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
        // Cross-origin Resource Timing can include failed requests; only an explicit
        // script onload marker proves that the provider loaded successfully.
        if (!loader || loader.dataset.adsenseLoaded !== 'true') return false;
        adsenseReady = true;
        reportLoaderStatus('loaded', 'Explicit AdSense script onload marker was present before diagnostics attached');
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
            loader.dataset.adsenseLoaded = 'true';
            adsenseReady = true;
            reportLoaderStatus('loaded');
            schedulePendingAds();
        }, { once: true });
        loader.addEventListener('error', function () {
            loader.dataset.adsenseLoaded = 'false';
            adsenseReady = false;
            reportLoaderStatus('error', 'AdSense script load event failed');
        }, { once: true });
        document.addEventListener('load', function (event) {
            if (event.target === loader) {
                loader.dataset.adsenseLoaded = 'true';
                adsenseReady = true;
                reportLoaderStatus('loaded');
                schedulePendingAds();
            }
        }, true);
        document.addEventListener('error', function (event) {
            const target = event.target;
            if (target === loader || (target && target.tagName === 'SCRIPT' &&
                target.src && target.src.indexOf('adsbygoogle.js') !== -1)) {
                if (target) target.dataset.adsenseLoaded = 'false';
                adsenseReady = false;
                reportLoaderStatus('error', 'AdSense script resource error');
            }
        }, true);

        if (!reportPreviouslyLoadedResource(loader)) {
            adsenseReady = false;
            reportLoaderStatus('pending', 'Waiting for AdSense script load or error');
        } else {
            schedulePendingAds();
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

    function getContentWidth(element) {
        if (!element) return 0;
        const style = window.getComputedStyle(element);
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        return Math.max(0, element.clientWidth - padding);
    }

    function getSlotMeasurements(ad) {
        const container = ad.closest(AD_CONTAINER_SELECTOR);
        const parent = ad.parentElement;
        const rect = ad.getBoundingClientRect();
        const parentRect = parent ? parent.getBoundingClientRect() : null;
        const containerRect = container ? container.getBoundingClientRect() : null;
        const style = window.getComputedStyle(ad);
        let hiddenAncestor = null;
        let narrowestAncestorWidth = Infinity;
        const ancestorWidths = [];

        for (let node = ad; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
            const computed = window.getComputedStyle(node);
            const contentWidth = getContentWidth(node);
            ancestorWidths.push({
                element: node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
                    (node.classList && node.classList.length ? '.' + Array.from(node.classList).join('.') : ''),
                clientWidth: node.clientWidth,
                contentWidth: Math.round(contentWidth * 100) / 100
            });
            narrowestAncestorWidth = Math.min(narrowestAncestorWidth, contentWidth);

            if (!hiddenAncestor && (computed.display === 'none' ||
                computed.visibility === 'hidden' || computed.visibility === 'collapse' ||
                computed.contentVisibility === 'hidden' || node.hidden)) {
                hiddenAncestor = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
                    (node.classList && node.classList.length ? '.' + Array.from(node.classList).join('.') : '');
            }
        }

        const slotWidth = Math.max(0, rect.width);
        const parentContentWidth = getContentWidth(parent);
        const containerContentWidth = getContentWidth(container);
        const availableWidth = Math.max(0, Math.min(
            slotWidth,
            parentContentWidth || 0,
            containerContentWidth || 0,
            Number.isFinite(narrowestAncestorWidth) ? narrowestAncestorWidth : 0
        ));
        const visible = Boolean(ad.isConnected && ad.getClientRects().length &&
            style.display !== 'none' && style.visibility !== 'hidden' && !hiddenAncestor);

        return {
            slotWidth: Math.round(slotWidth * 100) / 100,
            slotClientWidth: ad.clientWidth,
            slotHeight: Math.round(rect.height * 100) / 100,
            parentWidth: parentRect ? Math.round(parentRect.width * 100) / 100 : 0,
            parentClientWidth: parent ? parent.clientWidth : 0,
            parentContentWidth: Math.round(parentContentWidth * 100) / 100,
            parentHeight: parentRect ? Math.round(parentRect.height * 100) / 100 : 0,
            containerWidth: containerRect ? Math.round(containerRect.width * 100) / 100 : 0,
            containerClientWidth: container ? container.clientWidth : 0,
            containerContentWidth: Math.round(containerContentWidth * 100) / 100,
            containerHeight: containerRect ? Math.round(containerRect.height * 100) / 100 : 0,
            availableWidth: Math.round(availableWidth * 100) / 100,
            narrowestAncestorWidth: Math.round((Number.isFinite(narrowestAncestorWidth) ? narrowestAncestorWidth : 0) * 100) / 100,
            ancestorWidths: ancestorWidths,
            display: style.display,
            visibility: style.visibility,
            hasClientRects: Boolean(ad.getClientRects().length),
            isConnected: ad.isConnected,
            hiddenAncestor: hiddenAncestor,
            visible: visible
        };
    }

    function isStableWidth(ad, measurements) {
        if (!measurements.visible || measurements.availableWidth < 2) {
            stableMeasurements.delete(ad);
            return false;
        }

        const signature = [
            measurements.availableWidth,
            measurements.slotWidth,
            measurements.parentContentWidth,
            measurements.containerContentWidth
        ].join('|');
        const previous = stableMeasurements.get(ad);

        if (!previous || previous.signature !== signature) {
            stableMeasurements.set(ad, { signature: signature, frames: 1 });
            requestAnimationFrame(schedulePendingAds);
            return false;
        }

        previous.frames += 1;
        if (previous.frames < 2) {
            requestAnimationFrame(schedulePendingAds);
            return false;
        }
        return true;
    }

    function getNextUninitializedAd() {
        const ads = document.querySelectorAll(AD_SELECTOR);
        for (const candidate of ads) {
            if (initializedAds.has(candidate) || candidate.hasAttribute('data-adsbygoogle-status')) {
                continue;
            }
            return candidate;
        }
        return null;
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
        // The async AdSense loader may not have executed yet. Pushing into its
        // pre-load queue creates a time gap between width validation and sizing.
        if (!adsenseReady) return;

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

            // adsbygoogle.push({}) processes the first uninitialized <ins> in DOM order.
            // Never push a later approved slot while another uninitialized slot precedes it.
            if (getNextUninitializedAd() !== ad) {
                reportAdStatus(ad);
                break;
            }

            // Record exact slot and ancestor geometry immediately before push().
            const measurements = getSlotMeasurements(ad);
            const hasWidth = Boolean(measurements.visible && measurements.availableWidth >= 2 &&
                measurements.slotClientWidth >= 2 && measurements.parentContentWidth >= 2 &&
                measurements.containerContentWidth >= 2);
            if (!hasWidth) stableMeasurements.delete(ad);
            const stable = hasWidth && isStableWidth(ad, measurements);
            const diagnostic = Object.assign({
                slot: ad.getAttribute('data-ad-slot') || 'unknown',
                placement: getPlacement(ad),
                stage: 'before-push',
                pushCount: pushCount,
                available: hasWidth && stable,
                stableFrames: stableMeasurements.get(ad) ? stableMeasurements.get(ad).frames : 0
            }, measurements);
            emitDiagnostic('adsense:pre-push', diagnostic);
            if (!hasWidth || !stable) {
                emitDiagnostic('adsense:blocked', Object.assign({}, diagnostic, {
                    reason: !hasWidth ? 'slot-width-not-measurable' : 'slot-width-not-stable-for-two-frames'
                }));
                reportAdStatus(ad);
                break;
            }
            stableMeasurements.delete(ad);
            pendingAds.delete(ad);
            initializedAds.add(ad);
            ad.dataset.adsInit = 'pending';
            try {
                pushCount += 1;
                lastPush = {
                    index: pushCount,
                    slot: ad.getAttribute('data-ad-slot') || 'unknown',
                    placement: getPlacement(ad),
                    timestamp: new Date().toISOString()
                };
                emitDiagnostic('adsense:push', Object.assign({}, lastPush, {
                    pendingCount: pendingAds.size,
                    slotStatus: ad.getAttribute('data-ad-status') || 'pending'
                }));
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
            const googleManaged = Boolean(ad.closest('.google-auto-placed')) ||
                (ad.hasAttribute('data-adsbygoogle-status') && !ad.closest(AD_CONTAINER_SELECTOR));
            if (googleManaged && !reportedGoogleManagedAds.has(ad)) {
                reportedGoogleManagedAds.add(ad);
                const measurements = getSlotMeasurements(ad);
                const inHeader = Boolean(ad.closest('.site-header'));
                emitDiagnostic('adsense:auto-placement', {
                    slot: ad.getAttribute('data-ad-slot') || 'google-auto',
                    placement: inHeader ? 'site-header' : 'google-auto-placement',
                    zeroWidth: measurements.slotWidth < 2 || measurements.parentWidth < 2,
                    measurements
                });
            }
            if (ad.closest('.site-header') && googleManaged && !reportedHeaderAds.has(ad)) {
                reportedHeaderAds.add(ad);
                emitDiagnostic('adsense:placement-warning', {
                    slot: ad.getAttribute('data-ad-slot') || 'google-auto',
                    placement: 'site-header',
                    reason: 'Google-managed Auto ads element detected in protected header; exclude header placements in AdSense Auto ads settings',
                    measurements: getSlotMeasurements(ad)
                });
            }
            if (!observedAds.has(ad)) {
                const statusObserver = new MutationObserver(function () {
                    reportAdStatus(ad);
                    schedulePendingAds();
                });
                statusObserver.observe(ad, {
                    attributes: true,
                    attributeFilter: ['data-ad-status', 'data-adsbygoogle-status']
                });
                observedAds.add(ad);
            }

            if (!isApproved(ad) || initializedAds.has(ad) ||
                ad.dataset.adsInit === 'pending' || ad.hasAttribute('data-adsbygoogle-status')) {
                reportAdStatus(ad);
                return;
            }
            pendingAds.add(ad);
            const container = ad.closest(AD_CONTAINER_SELECTOR);
            if (resizeObserver) {
                // Observe the slot and every sizing ancestor: an intermediate grid/flex
                // wrapper can collapse while the outer ad container remains unchanged.
                for (let node = ad; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
                    resizeObserver.observe(node);
                    if (node === document.body) break;
                }
            }
        });
        schedulePendingAds();
    }

    function getGoogleManagedSlots() {
        return Array.from(document.querySelectorAll(AD_SELECTOR)).filter(function (ad) {
            return Boolean(ad.closest('.google-auto-placed')) ||
                (ad.hasAttribute('data-adsbygoogle-status') && !ad.closest(AD_CONTAINER_SELECTOR));
        }).map(function (ad) {
            return {
                slot: ad.getAttribute('data-ad-slot') || 'google-auto',
                measurements: getSlotMeasurements(ad)
            };
        });
    }

    function getAdDiagnosticsSnapshot() {
        return Array.from(document.querySelectorAll(AD_SELECTOR)).map(function (ad, index) {
            const googleManaged = Boolean(ad.closest('.google-auto-placed')) ||
                (ad.hasAttribute('data-adsbygoogle-status') && !ad.closest(AD_CONTAINER_SELECTOR));
            return {
                index: index + 1,
                owner: googleManaged ? 'google-managed' : (isApproved(ad) ? 'manual' : 'unapproved'),
                slot: ad.getAttribute('data-ad-slot') || 'unknown',
                placement: getPlacement(ad),
                initState: ad.dataset.adsInit || null,
                diagnosticStatus: ad.dataset.adsDiagnosticStatus || null,
                providerStatus: ad.getAttribute('data-adsbygoogle-status') || null,
                adStatus: ad.getAttribute('data-ad-status') || null,
                measurements: getSlotMeasurements(ad)
            };
        });
    }

    function reportAdSenseProviderError(source, message, errorDetails) {
        const googleManagedSlots = getGoogleManagedSlots();
        const snapshot = getAdDiagnosticsSnapshot();
        const isAutoPlacementError = googleManagedSlots.length > 0 &&
            (!lastPush || snapshot.some(function (slot) {
                return slot.owner === 'google-managed' && slot.providerStatus !== 'done';
            }));
        emitDiagnostic(isAutoPlacementError ? 'adsense:auto-placement-error' : 'adsense:tag-error', {
            source: source,
            message: message || 'AdSense reported an error without a readable message',
            stack: errorDetails && errorDetails.stack || null,
            filename: errorDetails && errorDetails.filename || null,
            line: errorDetails && errorDetails.lineno || null,
            column: errorDetails && errorDetails.colno || null,
            pushCount: pushCount,
            lastPush: lastPush,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            page: window.location.pathname,
            slots: snapshot,
            googleManagedSlots: googleManagedSlots,
            likelyAutoPlacement: isAutoPlacementError
        });
    }

    function watchAdSenseErrors() {
        window.addEventListener('error', function (event) {
            const error = event && event.error;
            const message = String(event && (event.message || (error && error.message)) || '');
            const stack = String(error && error.stack || '');
            const filename = String(event && event.filename || '');
            if (!/adsbygoogle|TagError|No slot size|googlesyndication/i.test(message + ' ' + stack + ' ' + filename)) return;
            reportAdSenseProviderError('window.error', message, {
                stack: stack,
                filename: filename,
                lineno: event.lineno,
                colno: event.colno
            });
        }, true);

        window.addEventListener('unhandledrejection', function (event) {
            const reason = event && event.reason;
            const message = String(reason && reason.message || reason || '');
            const stack = String(reason && reason.stack || '');
            if (!/adsbygoogle|TagError|No slot size|googlesyndication/i.test(message + ' ' + stack)) return;
            reportAdSenseProviderError('unhandledrejection', message, { stack: stack });
        });

        // Some AdSense TagError variants are emitted through console.error rather
        // than a readable ErrorEvent. Preserve the original console behavior.
        if (window.console && typeof window.console.error === 'function' && !window.console.error.__adsenseDiagnostic) {
            const originalError = window.console.error;
            const diagnosticError = function () {
                const parts = Array.from(arguments).map(function (item) {
                    if (item && item.stack) return String(item.stack);
                    if (typeof item === 'string') return item;
                    try { return JSON.stringify(item); } catch (error) { return String(item); }
                });
                const message = parts.join(' ');
                if (/adsbygoogle|TagError|No slot size|googlesyndication/i.test(message)) {
                    reportAdSenseProviderError('console.error', message, {
                        stack: parts.find(function (part) { return /\\bat\\s/.test(part); }) || null
                    });
                }
                return originalError.apply(this, arguments);
            };
            diagnosticError.__adsenseDiagnostic = true;
            window.console.error = diagnosticError;
        }
    }

    function start() {
        watchLoader();
        watchAdSenseErrors();

        if ('ResizeObserver' in window) {
            resizeObserver = new ResizeObserver(schedulePendingAds);
            document.querySelectorAll(AD_CONTAINER_SELECTOR).forEach(function (container) {
                resizeObserver.observe(container);
            });
        }
        window.addEventListener('resize', schedulePendingAds, { passive: true });
        document.addEventListener('visibilitychange', schedulePendingAds);
        initializeAds();

        // Observe DOM insertions only at document level. Ad status attributes are
        // watched on each approved slot, not across the entire page subtree.
        const observer = new MutationObserver(function (records) {
            records.forEach(function (record) {
                if (record.type === 'attributes') {
                    // A hidden tab, collapsed grid, or visibility class can change
                    // without inserting nodes or changing the outer ad wrapper.
                    schedulePendingAds();
                    return;
                }
                record.addedNodes.forEach(function (node) {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
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
            attributeFilter: ['class', 'style', 'hidden']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();

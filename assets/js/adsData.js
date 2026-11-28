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
    let resizeObserver = null;
    let flushScheduled = false;
    let adsenseReady = false;
    let pushCount = 0;
    let lastPush = null;
    let activePushContext = null;
    const recentPushes = [];
    const PUSH_CORRELATION_WINDOW_MS = 15000;
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

    function isGoogleManagedAd(ad) {
        return Boolean(ad && (ad.closest('.google-auto-placed') ||
            (ad.hasAttribute('data-adsbygoogle-status') && !ad.closest(AD_CONTAINER_SELECTOR))));
    }

    function getRecentManualPushes() {
        const now = performance.now();
        return recentPushes.filter(function (push) {
            return now - push.performanceTime <= PUSH_CORRELATION_WINDOW_MS;
        });
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
            // Auto Ads may begin at width:0 before provider sizing; measure their layout ancestors.
            if (!(isGoogleManagedAd(ad) && node === ad)) {
                narrowestAncestorWidth = Math.min(narrowestAncestorWidth, contentWidth);
            }

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
        const googleManaged = isGoogleManagedAd(ad);
        const widthCandidates = googleManaged ? [parentContentWidth] : [slotWidth, parentContentWidth];
        if (container) widthCandidates.push(containerContentWidth);
        if (Number.isFinite(narrowestAncestorWidth)) widthCandidates.push(narrowestAncestorWidth);
        const availableWidth = Math.max(0, Math.min.apply(Math, widthCandidates));
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
            googleManaged: googleManaged,
            ancestorWidths: ancestorWidths,
            display: style.display,
            visibility: style.visibility,
            hasClientRects: Boolean(ad.getClientRects().length),
            isConnected: ad.isConnected,
            hiddenAncestor: hiddenAncestor,
            visible: visible
        };
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
            // availableWidth already represents the narrowest measurable slot,
            // parent, container, and ancestor width. Avoid redundant per-element gates.
            const hasWidth = Boolean(measurements.visible && measurements.availableWidth > 0);
            const diagnostic = Object.assign({
                slot: ad.getAttribute('data-ad-slot') || 'unknown',
                placement: getPlacement(ad),
                stage: 'before-push',
                pushCount: pushCount,
                available: hasWidth,
                measuredFrames: hasWidth ? 1 : 0
            }, measurements);
            emitDiagnostic('adsense:pre-push', diagnostic);
            if (!hasWidth) {
                emitDiagnostic('adsense:blocked', Object.assign({}, diagnostic, {
                    reason: 'slot-width-not-measurable'
                }));
                reportAdStatus(ad);
                break;
            }
            pendingAds.delete(ad);
            initializedAds.add(ad);
            ad.dataset.adsInit = 'pending';
            try {
                pushCount += 1;
                const pushContext = {
                    id: 'manual-push-' + pushCount,
                    index: pushCount,
                    owner: 'manual',
                    slot: ad.getAttribute('data-ad-slot') || 'unknown',
                    placement: getPlacement(ad),
                    timestamp: new Date().toISOString(),
                    performanceTime: performance.now()
                };
                lastPush = pushContext;
                activePushContext = pushContext;
                recentPushes.push(pushContext);
                while (recentPushes.length > 10) recentPushes.shift();
                ad.dataset.adsPushId = pushContext.id;
                ad.dataset.adsPushAt = pushContext.timestamp;
                emitDiagnostic('adsense:push', Object.assign({}, pushContext, {
                    pendingCount: pendingAds.size,
                    slotStatus: ad.getAttribute('data-ad-status') || 'pending'
                }));
                try {
                    (window.adsbygoogle = window.adsbygoogle || []).push({});
                } finally {
                    activePushContext = null;
                }
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
                reportAdSenseProviderError('push-exception', error && error.message, error, lastPush);
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
                    zeroWidth: measurements.availableWidth < 2,
                    zeroWidthReason: measurements.hiddenAncestor ? 'hidden-ancestor' : (measurements.availableWidth < 2 ? 'no-measurable-width' : null),
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
                pushId: ad.dataset.adsPushId || null,
                pushAt: ad.dataset.adsPushAt || null,
                diagnosticStatus: ad.dataset.adsDiagnosticStatus || null,
                providerStatus: ad.getAttribute('data-adsbygoogle-status') || null,
                adStatus: ad.getAttribute('data-ad-status') || null,
                measurements: getSlotMeasurements(ad)
            };
        });
    }

    function reportAdSenseProviderError(source, message, errorDetails, explicitPushContext) {
        const googleManagedSlots = getGoogleManagedSlots();
        const snapshot = getAdDiagnosticsSnapshot();
        const recentManualPushes = getRecentManualPushes();
        const correlatedPush = explicitPushContext || activePushContext || recentManualPushes[recentManualPushes.length - 1] || null;
        const hasGoogleManagedSlots = googleManagedSlots.length > 0;
        let attribution = 'unattributed';
        if (correlatedPush && hasGoogleManagedSlots) attribution = 'mixed-or-unattributed';
        else if (correlatedPush) attribution = 'manual-slot-associated';
        else if (hasGoogleManagedSlots) attribution = 'google-managed-or-unattributed';
        const isAutoPlacementCandidate = attribution === 'google-managed-or-unattributed';
        const originalMessage = String(message || '');
        const originalStack = errorDetails && errorDetails.stack ? String(errorDetails.stack) : null;
        emitDiagnostic(isAutoPlacementCandidate ? 'adsense:auto-placement-error' : 'adsense:tag-error', {
            source: source,
            message: originalMessage || originalStack || 'AdSense reported an error without a readable message',
            originalMessage: originalMessage,
            stack: originalStack,
            filename: errorDetails && errorDetails.filename || null,
            line: errorDetails && errorDetails.lineno || null,
            column: errorDetails && errorDetails.colno || null,
            originalArguments: errorDetails && errorDetails.originalArguments || null,
            attribution: attribution,
            attributionConfidence: isAutoPlacementCandidate ? 'candidate-only' : (correlatedPush ? 'temporal-correlation' : 'unattributed'),
            pushCount: pushCount,
            lastPush: lastPush ? Object.assign({}, lastPush, { performanceTime: undefined }) : null,
            correlatedPush: correlatedPush ? Object.assign({}, correlatedPush, { performanceTime: undefined }) : null,
            recentManualPushes: recentManualPushes.map(function (push) { return Object.assign({}, push, { performanceTime: undefined }); }),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            page: window.location.pathname,
            slots: snapshot,
            googleManagedSlots: googleManagedSlots,
            likelyAutoPlacement: isAutoPlacementCandidate
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
                originalArguments: [message, stack].filter(Boolean),
                lineno: event.lineno,
                colno: event.colno
            });
        }, true);

        window.addEventListener('unhandledrejection', function (event) {
            const reason = event && event.reason;
            const message = String(reason && reason.message || reason || '');
            const stack = String(reason && reason.stack || '');
            if (!/adsbygoogle|TagError|No slot size|googlesyndication/i.test(message + ' ' + stack)) return;
            reportAdSenseProviderError('unhandledrejection', message, { stack: stack, originalArguments: [message, stack].filter(Boolean) });
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
                        stack: parts.find(function (part) { return part.indexOf(' at ') !== -1; }) || null,
                        originalArguments: parts
                    });
                }
                return originalError.apply(this, arguments);
            };
            diagnosticError.__adsenseDiagnostic = true;
            window.console.error = diagnosticError;
        }
    }


    // Auto Ads are owned by Google and are not initialized through manual push().
    // Observe their network requests independently and correlate them with generated
    // .google-auto-placed wrappers and their eventual provider status.
    const autoAdRequests = [];
    const autoAdElements = new WeakMap();
    let autoAdElementSequence = 0;
    let autoAdRequestSequence = 0;

    function getAutoElementId(wrapper) {
        if (!wrapper) return null;
        if (!autoAdElements.has(wrapper)) {
            autoAdElementSequence += 1;
            autoAdElements.set(wrapper, 'auto-placement-' + autoAdElementSequence);
            wrapper.dataset.adsAutoDiagnosticId = autoAdElements.get(wrapper);
        }
        return autoAdElements.get(wrapper);
    }

    function describeAutoPlacement(wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const style = window.getComputedStyle(wrapper);
        const ins = wrapper.querySelector('ins.adsbygoogle');
        const status = ins && ins.getAttribute('data-ad-status');
        const iframeCount = wrapper.querySelectorAll('iframe').length;
        return {
            elementId: getAutoElementId(wrapper),
            tagName: wrapper.tagName.toLowerCase(),
            className: String(wrapper.className || ''),
            slot: ins && ins.getAttribute('data-ad-slot') || null,
            status: status || null,
            providerStatus: ins && ins.getAttribute('data-adsbygoogle-status') || null,
            outcome: status === 'filled' ? 'filled' : (status === 'unfilled' ? 'unfilled' : (iframeCount ? 'rendered-candidate' : 'pending-or-unknown')),
            iframeCount: iframeCount,
            containerWidth: Math.round(rect.width * 100) / 100,
            containerHeight: Math.round(rect.height * 100) / 100,
            containerClientWidth: wrapper.clientWidth,
            containerClientHeight: wrapper.clientHeight,
            x: Math.round((rect.left + window.scrollX) * 100) / 100,
            y: Math.round((rect.top + window.scrollY) * 100) / 100,
            visible: Boolean(wrapper.isConnected && wrapper.getClientRects().length && style.display !== 'none' && style.visibility !== 'hidden'),
            hidden: Boolean(wrapper.hidden || style.display === 'none' || style.visibility === 'hidden')
        };
    }

    function getAutoPlacementCandidates() {
        return Array.from(document.querySelectorAll('.google-auto-placed')).map(describeAutoPlacement);
    }

    function matchAutoPlacement(candidates, adx, ady) {
        if (!candidates.length) return { elementId: null, method: 'no-element', candidates: [] };
        if (candidates.length === 1) {
            return { elementId: candidates[0].elementId, method: 'single-auto-placement', candidates: candidates };
        }
        const x = Number(adx);
        const y = Number(ady);
        if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0) {
            const ranked = candidates.map(function (candidate) {
                const dx = candidate.x - x;
                const dy = candidate.y - y;
                return { candidate: candidate, distance: Math.sqrt(dx * dx + dy * dy) };
            }).sort(function (a, b) { return a.distance - b.distance; });
            if (ranked.length && ranked[0].distance < 160) {
                return { elementId: ranked[0].candidate.elementId, method: 'nearest-adx-ady-coordinate', candidates: candidates };
            }
        }
        return { elementId: null, method: 'ambiguous-multiple-auto-placements', candidates: candidates };
    }

    function updateAutoRequestOutcomes() {
        autoAdRequests.forEach(function (request) {
            const candidate = request.elementId
                ? document.querySelector('[data-ads-auto-diagnostic-id="' + request.elementId + '"]')
                : null;
            const wrapper = candidate && candidate.closest('.google-auto-placed');
            const current = wrapper ? describeAutoPlacement(wrapper) : null;
            const outcome = current ? current.outcome : (request.elementId ? 'element-removed' : 'unmatched');
            const signature = outcome + ':' + (current && current.status || '') + ':' + (current && current.providerStatus || '') + ':' + (current && current.iframeCount || 0);
            if (request.lastOutcomeSignature === signature) return;
            request.lastOutcomeSignature = signature;
            request.latestOutcome = outcome;
            emitDiagnostic('adsense:auto-request-outcome', {
                requestId: request.id,
                owner: 'google-auto',
                format: request.format,
                adx: request.adx,
                ady: request.ady,
                elementId: request.elementId,
                matchMethod: request.matchMethod,
                outcome: outcome,
                placement: current,
                comparedAt: new Date().toISOString()
            });
        });
    }

    function recordAutoAdRequest(entry) {
        let parsed;
        try { parsed = new URL(entry.name); } catch (error) { return; }
        const host = parsed.hostname.toLowerCase();
        if (!/(^|\\.)googleads\\.g\\.doubleclick\\.net$|pagead2\\.googlesyndication\\.com$/.test(host)) return;
        if (!/\\/pagead\\/ads/.test(parsed.pathname)) return;
        const params = parsed.searchParams;
        const format = params.get('format');
        const saldr = params.get('saldr');
        if (saldr !== 'aa' && format !== '0x0') return;

        autoAdRequestSequence += 1;
        const adx = params.get('adx');
        const ady = params.get('ady');
        const match = matchAutoPlacement(getAutoPlacementCandidates(), adx, ady);
        const request = {
            id: 'auto-request-' + autoAdRequestSequence,
            owner: 'google-auto',
            timestamp: new Date().toISOString(),
            performanceTime: entry.startTime,
            domain: host,
            path: parsed.pathname,
            format: format,
            adx: adx,
            ady: ady,
            saldr: saldr,
            client: params.get('client'),
            elementId: match.elementId,
            matchMethod: match.method,
            candidatesAtRequest: match.candidates,
            resourceDuration: Math.round(entry.duration * 100) / 100,
            latestOutcome: 'pending'
        };
        autoAdRequests.push(request);
        while (autoAdRequests.length > 50) autoAdRequests.shift();
        emitDiagnostic('adsense:auto-request', Object.assign({}, request, {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            page: window.location.pathname
        }));
        updateAutoRequestOutcomes();
    }

    function startAutoAdRequestDiagnostics() {
        if (!('PerformanceObserver' in window)) return;
        try {
            const observer = new PerformanceObserver(function (list) {
                list.getEntries().forEach(recordAutoAdRequest);
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch (error) {
            try {
                const observer = new PerformanceObserver(function (list) {
                    list.getEntries().forEach(recordAutoAdRequest);
                });
                observer.observe({ entryTypes: ['resource'] });
                performance.getEntriesByType('resource').forEach(recordAutoAdRequest);
            } catch (ignored) {
                emitDiagnostic('adsense:auto-request-observer', { status: 'unsupported' });
            }
        }

        const observer = new MutationObserver(function () {
            updateAutoRequestOutcomes();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-ad-status', 'data-adsbygoogle-status', 'class', 'style', 'hidden']
        });
        getAutoPlacementCandidates();
    }

    function start() {
        watchLoader();
        watchAdSenseErrors();
        startAutoAdRequestDiagnostics();

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

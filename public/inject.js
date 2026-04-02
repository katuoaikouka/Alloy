(function() {
    const alloyData = document.getElementById('alloyData');
    if (!alloyData) return;
    
    const originEncoded = alloyData.getAttribute('data-alloyURL');
    const targetOrigin = atob(originEncoded);

    function wrapUrl(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return url;
        if (url.startsWith(window.location.origin)) return url;
        
        try {
            const absolute = new URL(url, targetOrigin).href;
            const origin = new URL(absolute).origin;
            const path = new URL(absolute).pathname + new URL(absolute).search + new URL(absolute).hash;
            return `/fetch/${btoa(origin)}${path}`;
        } catch(e) {
            return url;
        }
    }

    // --- APIフック ---
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            input = wrapUrl(input);
        } else if (input instanceof Request) {
            input = new Request(wrapUrl(input.url), input);
        }
        return originalFetch(input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        arguments = wrapUrl(url);
        return originalOpen.apply(this, arguments);
    };

    // --- DOM監視 (動的要素の書き換え) ---
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    ['src', 'href', 'action'].forEach(attr => {
                        const val = node.getAttribute(attr);
                        if (val && !val.startsWith('/fetch/') && !val.startsWith('http') && !val.startsWith('data:')) {
                            node.setAttribute(attr, wrapUrl(val));
                        }
                    });
                }
            });
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // --- History / Location 偽装 ---
    const originalPushState = history.pushState;
    history.pushState = function(state, title, url) {
        return originalPushState.apply(history, [state, title, wrapUrl(url)]);
    };

    // 簡易的な Location 偽装
    window.alloyLocation = new Proxy(window.location, {
        get: (target, prop) => {
            if (prop === 'href') return targetOrigin + window.location.pathname.replace(/^\/fetch\/[^\/]+/, '');
            if (prop === 'host' || prop === 'hostname') return new URL(targetOrigin).hostname;
            return target[prop];
        }
    });

    console.log('[Alloy] Script Injected for: ' + targetOrigin);
})();

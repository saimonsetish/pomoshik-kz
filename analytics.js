'use strict';

(() => {
  // Preview servers and tests must not add visits to the production counter.
  const publicSite = ['komek.kz', 'www.komek.kz'].includes(location.hostname)
    || (location.hostname === 'saimonsetish.github.io' && location.pathname.startsWith('/pomoshik-kz/'));
  if (location.protocol !== 'https:' || !publicSite || window.komekAnalytics) return;

  const counterId = 113258894;
  const goals = new Set(['whatsapp_click', 'phone_click', 'order_received']);
  const source = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`;
  window.ym = window.ym || function () {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.l = Date.now();

  // No session replay, click map, ecommerce, or automatic outbound-link URLs.
  window.ym(counterId, 'init', {
    webvisor: false,
    clickmap: false,
    ecommerce: false,
    trackLinks: false,
    trackHash: false,
    accurateTrackBounce: true,
    referrer: document.referrer,
    url: location.href
  });

  if (![...document.scripts].some(script => script.src === source)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = source;
    document.head.append(script);
  }

  function reachGoal(name) {
    if (!goals.has(name)) return;
    try {
      // Only the fixed event name: never pass phone numbers or form contents.
      window.ym(counterId, 'reachGoal', name);
    } catch (_) {
      // Analytics failures must never interrupt contact links or form success.
    }
  }
  window.komekAnalytics = Object.freeze({ reachGoal });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const destination = new URL(link.href);
    if (destination.protocol === 'https:' && destination.hostname === 'wa.me') {
      reachGoal('whatsapp_click');
    } else if (destination.protocol === 'tel:') {
      reachGoal('phone_click');
    }
  });
})();

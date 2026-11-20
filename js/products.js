/* ==========================================================================
   RetroMarket — Production Storefront API Data Store (Vanilla ES6)
   Loads live catalog, categories, sellers, and settings from /api/storefront/bootstrap.
   Zero hardcoded sample products, fake sellers, or demonstration fallbacks.
   ========================================================================== */

(() => {
  'use strict';

  const CURRENCY_SYMBOLS = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'CA$',
  };

  let state = {
    loaded: false,
    error: null,
    settings: {
      siteName: 'RetroMarket',
      tagline: 'Classic Online Buying & Selling Directory',
      logoPath: 'assets/icons/logo-mark.svg',
      defaultCurrency: 'USD',
      supportEmail: '',
      sellerContactInfo: '',
      guestCheckoutNotice:
        'Shop and check out as a guest without creating a customer account. Save your Order Reference ID to track your order.',
    },
    paymentCapabilities: {
      cybersource: {
        available: false,
        placeholderOnly: true,
        notice: 'CyberSource payment processing is currently unavailable.',
      },
      cryptocurrency: {
        manualVerificationOnly: true,
        methods: [],
      },
      manual: { configured: true },
    },
    categories: [],
    sellers: [],
    products: [],
    stats: { totalProducts: 0, totalCategories: 0, activeSellers: 0 },
  };

  let loadPromise = null;

  function sanitizeAssetUrl(url, fallback) {
    const raw = String(url || '').trim();
    if (!raw) return fallback;
    if (/^(javascript|data|vbscript|file):/i.test(raw) || raw.startsWith('//') || raw.includes('..')) {
      return fallback;
    }
    if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
    if (/^assets\/[a-zA-Z0-9._/-]+$/.test(raw)) return raw;
    return fallback;
  }

  function formatPrice(amount, currencyOverride) {
    const code = currencyOverride || state.settings.defaultCurrency || 'USD';
    const symbol = CURRENCY_SYMBOLS[code] || '$';
    return symbol + Number(amount || 0).toFixed(2);
  }

  function formatDateShort(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate.length === 10 ? isoDate + 'T00:00:00Z' : isoDate);
    if (Number.isNaN(d.getTime())) return String(isoDate);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  async function loadStorefront(force) {
    if (loadPromise && !force) return loadPromise;

    loadPromise = fetch('/api/storefront/bootstrap', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error('Failed to load marketplace catalog (HTTP ' + resp.status + ').');
        }
        const data = await resp.json();
        state = {
          loaded: true,
          error: null,
          settings: data.settings || state.settings,
          paymentCapabilities: data.paymentCapabilities || state.paymentCapabilities,
          categories: Array.isArray(data.categories) ? data.categories : [],
          sellers: Array.isArray(data.sellers) ? data.sellers : [],
          products: Array.isArray(data.products) ? data.products : [],
          stats: data.stats || {
            totalProducts: (data.products || []).length,
            totalCategories: (data.categories || []).length,
            activeSellers: (data.sellers || []).length,
          },
        };
        return state;
      })
      .catch((err) => {
        state.loaded = true;
        state.error = err.message || 'Unable to connect to RetroMarket server.';
        return state;
      });

    return loadPromise;
  }

  async function fetchProductDetail(productId) {
    const resp = await fetch('/api/products/' + encodeURIComponent(productId), {
      headers: { Accept: 'application/json' },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      throw new Error('Unable to load product details (HTTP ' + resp.status + ').');
    }
    return resp.json();
  }

  window.RetroMarketData = {
    loadStorefront,
    fetchProductDetail,
    getSettings: () => state.settings,
    getPaymentCapabilities: () => state.paymentCapabilities,
    getStats: () => state.stats,
    getLoadError: () => state.error,
    get CATEGORIES() {
      return state.categories;
    },
    get SELLERS() {
      return state.sellers;
    },
    get PRODUCTS() {
      return state.products;
    },
    getActiveSellers: () => state.sellers.filter((s) => s.active !== false),
    getProductById: (id) => {
      const numericId = Number(id);
      return state.products.find((p) => p.id === numericId) || null;
    },
    getCategoryBySlug: (slug) => state.categories.find((c) => c.slug === slug) || null,
    getCategoryCount: (slug) => {
      const cat = state.categories.find((c) => c.slug === slug);
      return cat ? Number(cat.productCount || 0) : 0;
    },
    getSellerByUsername: (username) =>
      state.sellers.find((s) => s.username.toLowerCase() === String(username || '').toLowerCase()) ||
      null,
    formatPrice,
    formatDateShort,
    sanitizeAssetUrl,
  };
})();

/* ==========================================================================
   RetroMarket — Production Storefront Controller (Vanilla ES6)
   Renders homepage, marketplace catalog, categories, product detail, and
   guest contact/inquiry pages strictly from live /api/* database responses.
   ========================================================================== */

(() => {
  'use strict';

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeAssetUrl(url, fallback) {
    return window.RetroMarketData
      ? window.RetroMarketData.sanitizeAssetUrl(url, fallback)
      : fallback;
  }

  function getAvailabilityClass(item) {
    if (!item.inStock) return 'status-out';
    const text = String(item.availability || '').toLowerCase();
    if (text.includes('limited')) return 'status-limited';
    if (item.isDigital || text.includes('instant')) return 'status-digital';
    return 'status-in-stock';
  }

  function initHeaderDate() {
    const dateEl = document.getElementById('current-date-display');
    if (!dateEl) return;
    dateEl.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function initMobileNav() {
    document.querySelectorAll('.main-nav').forEach((nav) => {
      const toggleBtn = nav.querySelector('.nav-toggle-btn');
      if (!toggleBtn || toggleBtn.dataset.navBound === 'true') return;
      toggleBtn.dataset.navBound = 'true';

      const setOpen = (isOpen) => {
        nav.classList.toggle('is-open', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
      };

      toggleBtn.addEventListener('click', () => {
        setOpen(!nav.classList.contains('is-open'));
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && nav.classList.contains('is-open')) {
          setOpen(false);
        }
      });
    });
  }

  function applyWebsiteSettings() {
    if (!window.RetroMarketData) return;
    const settings = window.RetroMarketData.getSettings();
    document.querySelectorAll('.brand-name').forEach((el) => {
      el.textContent = settings.siteName || 'RetroMarket';
    });
    document.querySelectorAll('.brand-tagline').forEach((el) => {
      el.textContent = settings.tagline || 'Classic Online Buying & Selling Directory';
    });
    const safeLogo = safeAssetUrl(settings.logoPath, 'assets/icons/logo-mark.svg');
    document.querySelectorAll('.brand-logo').forEach((img) => {
      img.src = safeLogo;
    });
    document.querySelectorAll('[data-site-support-email]').forEach((el) => {
      el.textContent = settings.supportEmail || 'Not configured';
    });
    document.querySelectorAll('[data-seller-contact-info]').forEach((el) => {
      el.textContent = settings.sellerContactInfo || 'Use the inquiry form to reach listed sellers.';
    });
    document.querySelectorAll('[data-guest-notice]').forEach((el) => {
      el.textContent =
        settings.guestCheckoutNotice ||
        'Shop and check out as a guest without creating an account.';
    });
  }

  function syncDynamicNavigationAndStats() {
    if (!window.RetroMarketData) return;
    const { CATEGORIES, PRODUCTS, SELLERS, getCategoryCount } = window.RetroMarketData;

    ['header-search-category', 'marketplace-cat-filter', 'home-latest-category-filter'].forEach(
      (selectId) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const currentValue = select.value || 'all';
        select.innerHTML =
          '<option value="all">All Categories</option>' +
          CATEGORIES.map(
            (cat) =>
              '<option value="' + escapeHtml(cat.slug) + '">' + escapeHtml(cat.name) + '</option>'
          ).join('');
        if (currentValue === 'all' || CATEGORIES.some((c) => c.slug === currentValue)) {
          select.value = currentValue;
        }
      }
    );

    document.querySelectorAll('[data-dynamic-sidebar-categories]').forEach((listEl) => {
      const includeAll = listEl.getAttribute('data-dynamic-sidebar-categories') === 'with-all';
      if (CATEGORIES.length === 0) {
        listEl.innerHTML =
          '<li class="text-muted"><span class="sidebar-cat-link">No categories listed yet</span></li>';
        return;
      }
      const allRow = includeAll
        ? `<li>
            <a href="marketplace.html" class="sidebar-cat-link">
              <img src="assets/icons/folder.svg" alt="" width="14" height="14" />
              <span><strong>All Categories</strong></span>
            </a>
            <span class="sidebar-count">${PRODUCTS.length}</span>
          </li>`
        : '';

      listEl.innerHTML =
        allRow +
        CATEGORIES.map(
          (cat) => `
          <li>
            <a href="marketplace.html?cat=${encodeURIComponent(cat.slug)}" class="sidebar-cat-link">
              <img src="assets/icons/folder.svg" alt="" width="14" height="14" />
              <span>${escapeHtml(cat.name)}</span>
            </a>
            <span class="sidebar-count">${getCategoryCount(cat.slug)}</span>
          </li>`
        ).join('');
    });

    document.querySelectorAll('[data-dynamic-sidebar-sellers]').forEach((listEl) => {
      if (SELLERS.length === 0) {
        listEl.innerHTML =
          '<li class="text-muted"><span class="sidebar-cat-link">No active sellers listed</span></li>';
        return;
      }
      listEl.innerHTML = SELLERS.map(
        (s) => `
        <li>
          <a href="marketplace.html?seller=${encodeURIComponent(s.username)}" class="sidebar-cat-link">
            <img src="assets/icons/user.svg" alt="" width="14" height="14" />
            <span>${escapeHtml(s.username)}</span>
          </a>
          <span class="sidebar-count">${Number(s.productCount || 0)}</span>
        </li>`
      ).join('');
    });

    document.querySelectorAll('[data-category-count="all"]').forEach((el) => {
      el.textContent = String(PRODUCTS.length);
    });
    document.querySelectorAll('[data-total-categories]').forEach((el) => {
      el.textContent = String(CATEGORIES.length);
    });
    document.querySelectorAll('[data-active-sellers-count]').forEach((el) => {
      el.textContent = String(SELLERS.length);
    });
  }

  function showCartFeedback(messageText) {
    const bar = document.getElementById('cart-feedback-bar');
    const textEl = document.getElementById('cart-feedback-text');
    if (!bar || !textEl) return;
    textEl.textContent = messageText;
    bar.classList.add('is-visible');
  }

  function bindAddToCartButtons(scope = document) {
    scope.querySelectorAll('[data-add-cart]').forEach((button) => {
      if (button.dataset.cartBound === 'true') return;
      button.dataset.cartBound = 'true';

      button.addEventListener('click', () => {
        const productId = button.getAttribute('data-add-cart');
        if (!window.RetroMarketCart) return;
        const added = window.RetroMarketCart.addItem(productId);
        if (!added) {
          showCartFeedback('This item is currently unavailable and cannot be added to your cart.');
          return;
        }
        if (added.stockLimitReached) {
          showCartFeedback(
            'Maximum available stock (' +
              added.maxStock +
              ') is already in your cart for "' +
              added.name +
              '".'
          );
        } else {
          showCartFeedback('Added "' + added.name + '" to your shopping cart.');
        }
      });
    });

    const dismissBtn = document.getElementById('cart-feedback-dismiss');
    if (dismissBtn && !dismissBtn.dataset.bound) {
      dismissBtn.dataset.bound = 'true';
      dismissBtn.addEventListener('click', () => {
        const bar = document.getElementById('cart-feedback-bar');
        if (bar) bar.classList.remove('is-visible');
      });
    }
  }

  function initHeaderSearch() {
    const searchForm = document.getElementById('header-search-form');
    if (!searchForm) return;
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const q = (searchForm.querySelector('input[name="q"]')?.value || '').trim();
      const cat = searchForm.querySelector('select[name="cat"]')?.value || '';
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cat && cat !== 'all') params.set('cat', cat);
      const qs = params.toString();
      window.location.href = qs ? 'marketplace.html?' + qs : 'marketplace.html';
    });
  }

  function renderHomepage() {
    if (!window.RetroMarketData) return;
    const { PRODUCTS, CATEGORIES, SELLERS, getCategoryCount, formatPrice, formatDateShort } =
      window.RetroMarketData;

    const featuredGrid = document.getElementById('home-featured-grid');
    if (featuredGrid) {
      const featuredItems = PRODUCTS.filter((p) => p.featured);
      const displayList = (featuredItems.length > 0 ? featuredItems : PRODUCTS).slice(0, 6);

      if (displayList.length === 0) {
        featuredGrid.innerHTML =
          '<div class="panel-body text-muted">No products are currently listed in the marketplace catalog.</div>';
      } else {
        featuredGrid.innerHTML = displayList
          .map(
            (item) => `
            <article class="product-card">
              <a href="product.html?id=${encodeURIComponent(item.id)}" class="product-thumb-wrap">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="product-thumb" />
              </a>
              <div class="product-card-body">
                <div class="product-cat-line">${escapeHtml(item.categoryName)} &middot; ${escapeHtml(item.condition)}</div>
                <h2 class="product-title">
                  <a href="product.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>
                </h2>
                <div class="product-seller-line">
                  Seller: <a href="marketplace.html?seller=${encodeURIComponent(item.seller)}">${escapeHtml(item.seller)}</a>
                </div>
                <div class="product-footer-row">
                  <span class="product-price">${formatPrice(item.price)}</span>
                  <div class="product-card-actions">
                    <a href="product.html?id=${encodeURIComponent(item.id)}" class="btn btn-compact">Details</a>
                    ${
                      item.inStock
                        ? `<button type="button" class="btn btn-primary btn-compact" data-add-cart="${item.id}">Add to Cart</button>`
                        : `<button type="button" class="btn btn-compact" disabled>Sold Out</button>`
                    }
                  </div>
                </div>
              </div>
            </article>`
          )
          .join('');
        bindAddToCartButtons(featuredGrid);
      }
    }

    const popularCatGrid = document.getElementById('home-popular-categories');
    if (popularCatGrid) {
      if (CATEGORIES.length === 0) {
        popularCatGrid.innerHTML =
          '<div class="panel-body text-muted">No categories have been published yet.</div>';
      } else {
        popularCatGrid.innerHTML = CATEGORIES.slice(0, 6)
          .map(
            (cat) => `
            <div class="category-cell">
              <div class="category-cell-top">
                <a href="marketplace.html?cat=${encodeURIComponent(cat.slug)}" class="category-name-link">${escapeHtml(cat.name)}</a>
                <span class="sidebar-count">${getCategoryCount(cat.slug)} products</span>
              </div>
              <div class="category-subtext">${escapeHtml(cat.description || 'Browse active listings in this department.')}</div>
            </div>`
          )
          .join('');
      }
    }

    const sellersBody = document.getElementById('home-featured-sellers-body');
    if (sellersBody) {
      if (SELLERS.length === 0) {
        sellersBody.innerHTML =
          '<tr><td colspan="4" class="text-center text-muted">No active sellers are currently listed.</td></tr>';
      } else {
        sellersBody.innerHTML = SELLERS.slice(0, 6)
          .map(
            (s) => `
          <tr>
            <td data-label="Seller"><a href="marketplace.html?seller=${encodeURIComponent(s.username)}"><strong>${escapeHtml(s.username)}</strong></a></td>
            <td data-label="Specialty">${escapeHtml(s.specialty || 'General')}</td>
            <td data-label="Listings" class="col-right num">${Number(s.productCount || 0)}</td>
            <td data-label="Member Since" class="col-center num">${escapeHtml(s.joined || '')}</td>
          </tr>`
          )
          .join('');
      }
    }

    const latestSelect = document.getElementById('home-latest-category-filter');
    const latestTbody = document.getElementById('home-latest-listings-body');
    if (latestSelect && latestTbody) {
      const renderLatest = (selectedCat) => {
        const filtered =
          selectedCat === 'all' ? PRODUCTS : PRODUCTS.filter((p) => p.category === selectedCat);
        if (filtered.length === 0) {
          latestTbody.innerHTML =
            '<tr><td colspan="6" class="text-center text-muted">No active listings found.</td></tr>';
          return;
        }
        latestTbody.innerHTML = filtered
          .slice(0, 8)
          .map(
            (item) => `
          <tr>
            <td data-label="Product Title"><a href="product.html?id=${encodeURIComponent(item.id)}"><strong>${escapeHtml(item.name)}</strong></a></td>
            <td data-label="Category"><a href="marketplace.html?cat=${encodeURIComponent(item.category)}">${escapeHtml(item.categoryName)}</a></td>
            <td data-label="Seller"><a href="marketplace.html?seller=${encodeURIComponent(item.seller)}">${escapeHtml(item.seller)}</a></td>
            <td data-label="Condition">${escapeHtml(item.condition)}</td>
            <td data-label="Price" class="col-right price"><strong>${formatPrice(item.price)}</strong></td>
            <td data-label="Listed" class="nowrap text-muted">${escapeHtml(formatDateShort(item.dateAdded))}</td>
          </tr>`
          )
          .join('');
      };
      renderLatest(latestSelect.value);
      latestSelect.addEventListener('change', () => renderLatest(latestSelect.value));
    }
  }

  function initMarketplaceCatalog() {
    const tbody = document.getElementById('marketplace-listings-body');
    if (!tbody || !window.RetroMarketData) return;

    const { PRODUCTS, getCategoryBySlug, formatPrice, formatDateShort } = window.RetroMarketData;

    const filterForm = document.getElementById('marketplace-filter-form');
    const keywordInput = document.getElementById('marketplace-search-input');
    const catSelect = document.getElementById('marketplace-cat-filter');
    const minPriceInput = document.getElementById('marketplace-min-price');
    const maxPriceInput = document.getElementById('marketplace-max-price');
    const sortSelect = document.getElementById('marketplace-sort-select');
    const resetBtn = document.getElementById('marketplace-reset-btn');
    const summaryEl = document.getElementById('marketplace-filter-summary');
    const activeStripEl = document.getElementById('marketplace-active-filters');
    const headerSearchInput = document.getElementById('header-search-input');
    const headerCatSelect = document.getElementById('header-search-category');

    const params = new URLSearchParams(window.location.search);
    const state = {
      q: (params.get('q') || '').trim(),
      cat: params.get('cat') || 'all',
      seller: (params.get('seller') || '').trim(),
      min: params.get('min') || '',
      max: params.get('max') || '',
      sort: params.get('sort') || 'newest',
    };

    if (keywordInput) keywordInput.value = state.q;
    if (headerSearchInput && state.q) headerSearchInput.value = state.q;
    if (catSelect) catSelect.value = state.cat;
    if (headerCatSelect && state.cat) headerCatSelect.value = state.cat;
    if (minPriceInput) minPriceInput.value = state.min;
    if (maxPriceInput) maxPriceInput.value = state.max;
    if (sortSelect) sortSelect.value = state.sort;

    function updateUrlFromState() {
      const nextParams = new URLSearchParams();
      if (state.q) nextParams.set('q', state.q);
      if (state.cat && state.cat !== 'all') nextParams.set('cat', state.cat);
      if (state.seller) nextParams.set('seller', state.seller);
      if (state.min !== '') nextParams.set('min', state.min);
      if (state.max !== '') nextParams.set('max', state.max);
      if (state.sort && state.sort !== 'newest') nextParams.set('sort', state.sort);
      const qs = nextParams.toString();
      const targetUrl = qs ? 'marketplace.html?' + qs : 'marketplace.html';
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', targetUrl);
      }
    }

    function renderCatalog() {
      const lowerQ = state.q.toLowerCase();
      const minVal = state.min !== '' && !Number.isNaN(Number(state.min)) ? Number(state.min) : null;
      const maxVal = state.max !== '' && !Number.isNaN(Number(state.max)) ? Number(state.max) : null;

      const filtered = PRODUCTS.filter((item) => {
        if (state.cat !== 'all' && item.category !== state.cat) return false;
        if (state.seller && item.seller.toLowerCase() !== state.seller.toLowerCase()) return false;
        if (minVal !== null && item.price < minVal) return false;
        if (maxVal !== null && item.price > maxVal) return false;
        if (lowerQ) {
          const hay = [
            String(item.id),
            item.name,
            item.description,
            item.categoryName,
            item.seller,
            item.condition,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(lowerQ)) return false;
        }
        return true;
      });

      const sorted = [...filtered].sort((a, b) => {
        if (state.sort === 'price-asc') return a.price - b.price;
        if (state.sort === 'price-desc') return b.price - a.price;
        if (state.sort === 'name-asc') return a.name.localeCompare(b.name);
        const dateCmp = String(b.createdAt).localeCompare(String(a.createdAt));
        return dateCmp !== 0 ? dateCmp : b.id - a.id;
      });

      if (summaryEl) {
        summaryEl.textContent =
          'Showing ' + sorted.length + ' of ' + PRODUCTS.length + ' catalog items';
      }

      if (activeStripEl) {
        const parts = [];
        if (state.q) parts.push('Keyword: "' + state.q + '"');
        if (state.cat !== 'all') {
          const catObj = getCategoryBySlug(state.cat);
          parts.push('Category: ' + (catObj ? catObj.name : state.cat));
        }
        if (state.seller) parts.push('Seller: ' + state.seller);
        if (minVal !== null) parts.push('Min Price: ' + formatPrice(minVal));
        if (maxVal !== null) parts.push('Max Price: ' + formatPrice(maxVal));
        activeStripEl.innerHTML =
          '<span><strong>Active View:</strong> ' +
          escapeHtml(parts.length ? parts.join(' · ') : 'All Listings') +
          '</span>' +
          (parts.length > 0
            ? '<a href="marketplace.html">Clear All Filters</a>'
            : '<span>Use the toolbar above to search, filter by price, or sort listings.</span>');
      }

      if (PRODUCTS.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="7" class="text-center text-muted">The marketplace catalog currently has no published products. Please check back soon.</td></tr>';
        return;
      }

      if (sorted.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="7" class="text-center text-muted">No products matched your current search or filter criteria. <a href="marketplace.html">Show All Listings</a></td></tr>';
        return;
      }

      tbody.innerHTML = sorted
        .map((item) => {
          const statusClass = getAvailabilityClass(item);
          const shortDesc =
            item.description.length > 105
              ? item.description.slice(0, 102) + '...'
              : item.description;

          return `
          <tr>
            <td class="listing-thumb-cell">
              <a href="product.html?id=${encodeURIComponent(item.id)}">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="listing-thumb" width="64" height="48" />
              </a>
            </td>
            <td data-label="Product">
              <a href="product.html?id=${encodeURIComponent(item.id)}" class="listing-title-link">${escapeHtml(item.name)}</a>
              <div class="listing-snippet">${escapeHtml(shortDesc)}</div>
              <div class="listing-meta-row">ID #${item.id} &middot; Listed ${escapeHtml(formatDateShort(item.dateAdded))}</div>
            </td>
            <td data-label="Category" class="nowrap"><a href="marketplace.html?cat=${encodeURIComponent(item.category)}">${escapeHtml(item.categoryName)}</a></td>
            <td data-label="Seller" class="nowrap"><a href="marketplace.html?seller=${encodeURIComponent(item.seller)}">${escapeHtml(item.seller)}</a></td>
            <td data-label="Condition" class="nowrap">${escapeHtml(item.condition)}</td>
            <td data-label="Availability" class="nowrap"><span class="${statusClass}">${escapeHtml(item.availability)}</span></td>
            <td data-label="Price" class="col-right nowrap">
              <div class="price"><strong>${formatPrice(item.price)}</strong></div>
              <div class="listing-action-row">
                <a href="product.html?id=${encodeURIComponent(item.id)}">Details</a>
                ${
                  item.inStock
                    ? `<button type="button" class="btn btn-primary btn-compact" data-add-cart="${item.id}">Add</button>`
                    : `<button type="button" class="btn btn-compact" disabled>Sold Out</button>`
                }
              </div>
            </td>
          </tr>`;
        })
        .join('');

      bindAddToCartButtons(tbody);
    }

    function applyFormValues() {
      state.q = keywordInput ? keywordInput.value.trim() : '';
      state.cat = catSelect ? catSelect.value : 'all';
      state.min = minPriceInput ? minPriceInput.value.trim() : '';
      state.max = maxPriceInput ? maxPriceInput.value.trim() : '';
      state.sort = sortSelect ? sortSelect.value : 'newest';
      updateUrlFromState();
      renderCatalog();
    }

    if (filterForm) {
      filterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        applyFormValues();
      });
    }
    if (catSelect) catSelect.addEventListener('change', applyFormValues);
    if (sortSelect) sortSelect.addEventListener('change', applyFormValues);
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.q = '';
        state.cat = 'all';
        state.seller = '';
        state.min = '';
        state.max = '';
        state.sort = 'newest';
        if (keywordInput) keywordInput.value = '';
        if (catSelect) catSelect.value = 'all';
        if (minPriceInput) minPriceInput.value = '';
        if (maxPriceInput) maxPriceInput.value = '';
        if (sortSelect) sortSelect.value = 'newest';
        updateUrlFromState();
        renderCatalog();
      });
    }

    renderCatalog();
  }

  function initCategoriesDirectory() {
    const tbody = document.getElementById('categories-directory-body');
    if (!tbody || !window.RetroMarketData) return;

    const { CATEGORIES, PRODUCTS, formatPrice } = window.RetroMarketData;
    const totalCountEl = document.getElementById('categories-total-items');
    if (totalCountEl) totalCountEl.textContent = String(PRODUCTS.length);

    if (CATEGORIES.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-center text-muted">No product categories are currently configured.</td></tr>';
      return;
    }

    tbody.innerHTML = CATEGORIES.map((cat) => {
      const count = Number(cat.productCount || 0);
      const latestHtml = cat.latestProduct
        ? `<a href="product.html?id=${encodeURIComponent(cat.latestProduct.id)}">${escapeHtml(cat.latestProduct.name)}</a> <span class="text-muted">(${formatPrice(cat.latestProduct.price)})</span>`
        : '<span class="text-muted">No items listed yet</span>';

      return `
        <tr>
          <td data-label="Category" class="nowrap">
            <img src="assets/icons/folder.svg" alt="" width="14" height="14" />
            <a href="marketplace.html?cat=${encodeURIComponent(cat.slug)}"><strong>${escapeHtml(cat.name)}</strong></a>
          </td>
          <td data-label="Department Scope">
            <div>${escapeHtml(cat.description || '')}</div>
            <div class="listing-meta-row">Latest item: ${latestHtml}</div>
          </td>
          <td data-label="Products" class="col-right num"><strong>${count}</strong></td>
          <td data-label="Action" class="col-center nowrap">
            <a href="marketplace.html?cat=${encodeURIComponent(cat.slug)}" class="btn btn-compact">Browse (${count})</a>
          </td>
        </tr>`;
    }).join('');
  }

  async function initProductDetailView() {
    const container = document.getElementById('product-detail-container');
    if (!container || !window.RetroMarketData) return;

    const { formatPrice, formatDateShort, fetchProductDetail } = window.RetroMarketData;
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');

    const crumbEl = document.getElementById('product-breadcrumb-title');
    const relatedSection = document.getElementById('related-products-panel');
    const relatedBody = document.getElementById('related-products-body');
    const specsBody = document.getElementById('product-specs-body');
    const shippingBody = document.getElementById('product-shipping-body');
    const detailsGrid = document.getElementById('product-subgrid');

    let payload = null;
    if (requestedId) {
      try {
        payload = await fetchProductDetail(requestedId);
      } catch {
        payload = null;
      }
    }

    if (!payload || !payload.product) {
      if (crumbEl) crumbEl.textContent = 'Listing Not Found';
      document.title = 'Listing Not Found — RetroMarket';
      container.innerHTML = `
        <div class="panel-body">
          <div class="notice-box">
            <strong>Product Listing Not Found:</strong> No active catalog listing matches the requested product ID.
          </div>
          <div class="product-detail-actions">
            <a href="marketplace.html" class="btn btn-primary">Browse Marketplace Catalog</a>
            <a href="categories.html" class="btn">View Categories</a>
          </div>
        </div>`;
      if (detailsGrid) detailsGrid.classList.add('is-hidden');
      if (relatedSection) relatedSection.classList.add('is-hidden');
      return;
    }

    const item = payload.product;
    const seller =
      payload.seller ||
      window.RetroMarketData.getSellerByUsername(item.seller) || {
        username: item.seller || 'RetroMarket Seller',
        location: 'Not specified',
        specialty: 'General',
        responseTime: 'Within 24 hours',
        productCount: 0,
      };
    const related = payload.related || [];
    const gallery = item.images && item.images.length > 0 ? item.images : [{ src: item.image, caption: item.name }];
    const statusClass = getAvailabilityClass(item);

    if (crumbEl) crumbEl.textContent = item.name;
    document.title = item.name + ' — RetroMarket';

    const thumbsHtml =
      gallery.length > 1
        ? `<div class="product-gallery-thumbs" role="group" aria-label="Product Images">
            ${gallery
              .map(
                (imgObj, idx) => `
              <button type="button" class="gallery-thumb-btn ${idx === 0 ? 'is-active' : ''}" data-gallery-src="${escapeHtml(imgObj.src)}" data-gallery-caption="${escapeHtml(imgObj.caption || item.name)}">
                <img src="${escapeHtml(imgObj.src)}" alt="" class="gallery-thumb-img" width="60" height="45" />
              </button>`
              )
              .join('')}
          </div>`
        : '';

    const contact = item.sellerContact || {};
    const telegramUrl = contact.telegramUrl || seller.telegramUrl || '';
    const telegramLabel = contact.telegram || seller.telegram || 'Telegram';
    const directContactBtns = [];
    if (telegramUrl) {
      directContactBtns.push(
        `<a href="${escapeHtml(telegramUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-compact">Telegram (${escapeHtml(telegramLabel)})</a>`
      );
    }
    if (contact.whatsappUrl) {
      directContactBtns.push(
        `<a href="${escapeHtml(contact.whatsappUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-compact">WhatsApp</a>`
      );
    }
    if (contact.email) {
      directContactBtns.push(
        `<a href="mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent('RetroMarket Inquiry: ' + item.name)}" class="btn btn-compact">Email Seller</a>`
      );
    }
    if (contact.phone) {
      directContactBtns.push(
        `<a href="tel:${encodeURIComponent(contact.phone)}" class="btn btn-compact">Call: ${escapeHtml(contact.phone)}</a>`
      );
    }
    if (contact.otherUrl) {
      directContactBtns.push(
        `<a href="${escapeHtml(contact.otherUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-compact">${escapeHtml(contact.otherLabel || 'Seller Link')}</a>`
      );
    }

    const directContactHtml =
      directContactBtns.length > 0 || contact.notes
        ? `<div class="seller-direct-links">
            <div class="seller-direct-links-title">Direct Seller Contact</div>
            ${directContactBtns.length > 0 ? `<div class="seller-contact-btn-row">${directContactBtns.join('')}</div>` : ''}
            ${contact.notes ? `<div class="seller-contact-note">${escapeHtml(contact.notes)}</div>` : ''}
          </div>`
        : '';

    const disabledAttr = item.inStock ? '' : 'disabled';

    container.innerHTML = `
      <div class="product-detail-layout">
        <div>
          <div class="product-detail-photo-box">
            <img id="product-main-image" src="${escapeHtml(gallery[0].src)}" alt="${escapeHtml(item.name)}" class="product-detail-photo" />
            <div id="product-main-caption" class="product-detail-caption">${escapeHtml(gallery[0].caption || item.name)}${gallery.length > 1 ? ' (1 / ' + gallery.length + ')' : ''}</div>
            ${thumbsHtml}
          </div>

          <div class="seller-info-box">
            <div class="seller-info-header">Seller Information</div>
            <table class="sidebar-stat-table">
              <tbody>
                <tr><td class="sidebar-stat-label">Seller</td><td class="sidebar-stat-val"><a href="marketplace.html?seller=${encodeURIComponent(seller.username)}">${escapeHtml(contact.contactName || seller.username)}</a></td></tr>
                <tr><td class="sidebar-stat-label">Location</td><td class="sidebar-stat-val">${escapeHtml(seller.location || 'Not specified')}</td></tr>
                <tr><td class="sidebar-stat-label">Specialty</td><td class="sidebar-stat-val">${escapeHtml(seller.specialty || 'General')}</td></tr>
                <tr><td class="sidebar-stat-label">Avg. Response</td><td class="sidebar-stat-val">${escapeHtml(seller.responseTime || 'Within 24 hours')}</td></tr>
                ${
                  telegramUrl
                    ? `<tr><td class="sidebar-stat-label">Telegram</td><td class="sidebar-stat-val"><a href="${escapeHtml(telegramUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(telegramLabel)}</a></td></tr>`
                    : ''
                }
                <tr><td class="sidebar-stat-label">Catalog Items</td><td class="sidebar-stat-val"><a href="marketplace.html?seller=${encodeURIComponent(seller.username)}">${Number(seller.listingCount || seller.productCount || 0)} active</a></td></tr>
              </tbody>
            </table>
            ${directContactHtml}
          </div>
        </div>

        <div>
          <h1 class="product-detail-title">${escapeHtml(item.name)}</h1>
          <div class="text-muted product-detail-meta">
            Listing ID: <strong class="num">#${item.id}</strong>
            &nbsp;|&nbsp; Category: <a href="marketplace.html?cat=${encodeURIComponent(item.category)}">${escapeHtml(item.categoryName)}</a>
            &nbsp;|&nbsp; Listed: ${escapeHtml(formatDateShort(item.dateAdded))}
          </div>

          <div class="product-price-box">
            <div>
              <span class="text-muted">Item Price:</span>
              <div class="product-detail-price">${formatPrice(item.price)}</div>
            </div>
            <div class="text-right">
              <div><strong>Condition:</strong> ${escapeHtml(item.condition)}</div>
              <div><strong>Availability:</strong> <span class="${statusClass}">${escapeHtml(item.availability)}</span></div>
            </div>
          </div>

          <h2 class="product-desc-heading">Item Description</h2>
          <p>${escapeHtml(item.description)}</p>

          <table class="data-table kv-table product-detail-table">
            <tbody>
              <tr><th scope="row">Category</th><td><a href="marketplace.html?cat=${encodeURIComponent(item.category)}">${escapeHtml(item.categoryName)}</a></td></tr>
              <tr><th scope="row">Condition</th><td>${escapeHtml(item.condition)}</td></tr>
              <tr><th scope="row">Availability</th><td><span class="${statusClass}">${escapeHtml(item.availability)}</span></td></tr>
              <tr><th scope="row">Shipping</th><td>${escapeHtml(item.shipping.method)} &mdash; <strong>${item.shipping.costAmount > 0 ? formatPrice(item.shipping.costAmount) : 'Free (' + formatPrice(0) + ')'}</strong></td></tr>
            </tbody>
          </table>

          <div class="product-detail-actions">
            <button type="button" class="btn btn-primary" data-add-cart="${item.id}" ${disabledAttr}>
              ${item.inStock ? 'Add to Cart' : 'Currently Out of Stock'}
            </button>
            <button type="button" id="buy-now-btn" class="btn" ${disabledAttr}>Buy Now</button>
            ${
              telegramUrl
                ? `<a href="${escapeHtml(telegramUrl)}" target="_blank" rel="noopener noreferrer" class="btn">Contact on Telegram</a>`
                : ''
            }
            <button type="button" id="contact-seller-toggle" class="btn">Contact Seller</button>
            <a href="marketplace.html?cat=${encodeURIComponent(item.category)}" class="btn">More in ${escapeHtml(item.categoryName)}</a>
          </div>
        </div>
      </div>`;

    const mainImg = document.getElementById('product-main-image');
    const mainCaption = document.getElementById('product-main-caption');
    const thumbButtons = Array.from(container.querySelectorAll('.gallery-thumb-btn'));
    thumbButtons.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const nextSrc = btn.getAttribute('data-gallery-src');
        const nextCap = btn.getAttribute('data-gallery-caption');
        if (mainImg && nextSrc) mainImg.src = nextSrc;
        if (mainCaption && nextCap) {
          mainCaption.textContent =
            nextCap + (gallery.length > 1 ? ' (' + (idx + 1) + ' / ' + gallery.length + ')' : '');
        }
        thumbButtons.forEach((el) => el.classList.remove('is-active'));
        btn.classList.add('is-active');
      });
    });

    bindAddToCartButtons(container);

    const buyNowBtn = document.getElementById('buy-now-btn');
    if (buyNowBtn && item.inStock) {
      buyNowBtn.addEventListener('click', () => {
        if (window.RetroMarketCart) window.RetroMarketCart.addItem(item.id);
        window.location.href = 'checkout.html';
      });
    }

    const contactPanel = document.getElementById('contact-seller-panel');
    const contactTelegramHint = document.getElementById('contact-seller-telegram-hint');
    const contactToggleBtn = document.getElementById('contact-seller-toggle');
    const contactSellerName = document.getElementById('contact-seller-name');
    const contactSubject = document.getElementById('contact-subject');
    const contactForm = document.getElementById('contact-seller-form');
    const contactStatus = document.getElementById('contact-seller-status');

    if (contactSellerName) contactSellerName.textContent = seller.username;
    if (contactSubject) contactSubject.value = 'Inquiry regarding #' + item.id + ' — ' + item.name;
    if (contactTelegramHint) {
      if (telegramUrl) {
        contactTelegramHint.classList.remove('is-hidden');
        contactTelegramHint.innerHTML =
          '<div class="notice-box"><strong>Direct Telegram Contact:</strong> Message <strong>' +
          escapeHtml(seller.username) +
          '</strong> directly on Telegram: <a href="' +
          escapeHtml(telegramUrl) +
          '" target="_blank" rel="noopener noreferrer" class="btn btn-compact">Open ' +
          escapeHtml(telegramLabel) +
          ' &raquo;</a></div>';
      } else {
        contactTelegramHint.classList.add('is-hidden');
        contactTelegramHint.innerHTML = '';
      }
    }
    if (contactToggleBtn && contactPanel) {
      contactToggleBtn.addEventListener('click', () => {
        contactPanel.classList.toggle('is-open');
      });
    }

    if (contactForm && contactStatus) {
      contactForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const guestName = (contactForm.querySelector('input[name="sender_name"]')?.value || '').trim();
        const guestEmail = (contactForm.querySelector('input[name="sender_email"]')?.value || '').trim();
        const message = (contactForm.querySelector('textarea[name="message"]')?.value || '').trim();

        try {
          const resp = await fetch('/api/inquiries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: seller.username,
              productId: item.id,
              guestName,
              guestEmail,
              message,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            contactStatus.textContent = data.error || 'Could not send inquiry.';
            contactStatus.className = 'error-box is-visible';
            return;
          }
          contactStatus.textContent = data.message || 'Inquiry submitted.';
          contactStatus.className = 'inline-message is-visible';
          contactForm.reset();
          if (contactSubject) contactSubject.value = 'Inquiry regarding #' + item.id + ' — ' + item.name;
        } catch {
          contactStatus.textContent = 'Network error while sending inquiry.';
          contactStatus.className = 'error-box is-visible';
        }
      });
    }

    if (specsBody) {
      const entries = Object.entries(item.specs || {});
      specsBody.innerHTML =
        entries.length === 0
          ? '<tr><td class="text-muted">No additional technical specifications listed.</td></tr>'
          : entries
              .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
              .join('');
    }

    if (shippingBody && item.shipping) {
      shippingBody.innerHTML = `
        <tr><th scope="row">Shipping Method</th><td>${escapeHtml(item.shipping.method)}</td></tr>
        <tr><th scope="row">Estimated Cost</th><td class="price"><strong>${item.shipping.costAmount > 0 ? formatPrice(item.shipping.costAmount) : 'Free (' + formatPrice(0) + ')'}</strong></td></tr>
        <tr><th scope="row">Handling Time</th><td>${escapeHtml(item.shipping.handling)}</td></tr>
        <tr><th scope="row">Ships From</th><td>${escapeHtml(item.shipping.shipsFrom || 'Not specified')}</td></tr>
        <tr><th scope="row">Return Policy</th><td>${escapeHtml(item.shipping.returns)}</td></tr>`;
    }

    const attrsPanel = document.getElementById('product-attributes-panel');
    const attrsBody = document.getElementById('product-attributes-body');
    if (attrsPanel && attrsBody) {
      const attrEntries = Object.entries(item.customAttributes || {});
      if (attrEntries.length === 0) {
        attrsPanel.classList.add('is-hidden');
        attrsBody.innerHTML = '';
      } else {
        attrsPanel.classList.remove('is-hidden');
        attrsBody.innerHTML = attrEntries
          .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
          .join('');
      }
    }

    if (relatedBody) {
      if (related.length === 0) {
        relatedBody.innerHTML =
          '<tr><td colspan="6" class="text-center text-muted">No related listings available.</td></tr>';
      } else {
        relatedBody.innerHTML = related
          .map(
            (rel) => `
          <tr>
            <td class="listing-thumb-cell">
              <a href="product.html?id=${encodeURIComponent(rel.id)}">
                <img src="${escapeHtml(rel.image)}" alt="${escapeHtml(rel.name)}" class="listing-thumb" width="64" height="48" />
              </a>
            </td>
            <td data-label="Product">
              <a href="product.html?id=${encodeURIComponent(rel.id)}"><strong>${escapeHtml(rel.name)}</strong></a>
              <div class="listing-meta-row">Seller: <a href="marketplace.html?seller=${encodeURIComponent(rel.seller)}">${escapeHtml(rel.seller)}</a></div>
            </td>
            <td data-label="Category"><a href="marketplace.html?cat=${encodeURIComponent(rel.category)}">${escapeHtml(rel.categoryName)}</a></td>
            <td data-label="Condition">${escapeHtml(rel.condition)}</td>
            <td data-label="Availability"><span class="${getAvailabilityClass(rel)}">${escapeHtml(rel.availability)}</span></td>
            <td data-label="Price" class="col-right price"><strong>${formatPrice(rel.price)}</strong></td>
          </tr>`
          )
          .join('');
      }
    }
  }

  function initContactPage() {
    const form = document.getElementById('guest-contact-form');
    if (!form || !window.RetroMarketData) return;

    const { SELLERS, getProductById } = window.RetroMarketData;
    const params = new URLSearchParams(window.location.search);

    const sellerSelect = document.getElementById('contact-seller-select');
    const productRefInput = document.getElementById('contact-product-ref');
    const orderRefInput = document.getElementById('contact-order-ref');
    const statusBox = document.getElementById('guest-contact-status');
    const directoryBody = document.getElementById('contact-seller-directory-body');

    if (sellerSelect) {
      sellerSelect.innerHTML =
        '<option value="RetroMarket Support">RetroMarket General Support</option>' +
        SELLERS.map(
          (s) =>
            '<option value="' +
            escapeHtml(s.username) +
            '">' +
            escapeHtml(s.username + (s.specialty ? ' (' + s.specialty + ')' : '')) +
            '</option>'
        ).join('');
    }

    const urlSeller = (params.get('seller') || '').trim();
    const urlProduct = (params.get('product') || '').trim();
    const urlOrder = (params.get('order') || '').trim();

    if (urlProduct && productRefInput) {
      const prod = getProductById(urlProduct);
      productRefInput.value = prod ? '#' + prod.id + ' — ' + prod.name : urlProduct;
      if (prod && !urlSeller && sellerSelect) sellerSelect.value = prod.seller;
    }
    if (urlSeller && sellerSelect) {
      const match = SELLERS.find((s) => s.username.toLowerCase() === urlSeller.toLowerCase());
      if (match) sellerSelect.value = match.username;
    }
    if (urlOrder && orderRefInput) orderRefInput.value = urlOrder;

    const telegramRow = document.getElementById('contact-seller-telegram-row');
    const telegramCell = document.getElementById('contact-seller-telegram-cell');
    const syncSelectedSellerTelegram = () => {
      if (!telegramRow || !telegramCell || !sellerSelect) return;
      const selectedUsername = sellerSelect.value;
      const sel = SELLERS.find((s) => s.username.toLowerCase() === selectedUsername.toLowerCase());
      if (sel && sel.telegramUrl) {
        telegramRow.classList.remove('is-hidden');
        telegramCell.innerHTML =
          '<a href="' +
          escapeHtml(sel.telegramUrl) +
          '" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-compact">Message ' +
          escapeHtml(sel.username) +
          ' on Telegram (' +
          escapeHtml(sel.telegram || 't.me') +
          ') &raquo;</a>';
      } else {
        telegramRow.classList.add('is-hidden');
        telegramCell.innerHTML = '';
      }
    };

    if (sellerSelect) {
      sellerSelect.addEventListener('change', syncSelectedSellerTelegram);
    }
    syncSelectedSellerTelegram();

    if (directoryBody) {
      if (SELLERS.length === 0) {
        directoryBody.innerHTML =
          '<tr><td colspan="6" class="text-center text-muted">No active sellers are currently listed in the directory.</td></tr>';
      } else {
        directoryBody.innerHTML = SELLERS.map(
          (s) => `
          <tr>
            <td data-label="Seller"><a href="marketplace.html?seller=${encodeURIComponent(s.username)}"><strong>${escapeHtml(s.username)}</strong></a></td>
            <td data-label="Specialty">${escapeHtml(s.specialty || 'General')}</td>
            <td data-label="Location">${escapeHtml(s.location || 'Not specified')}</td>
            <td data-label="Avg. Response">${escapeHtml(s.responseTime || 'Within 24 hours')}</td>
            <td data-label="Telegram">${
              s.telegramUrl
                ? `<a href="${escapeHtml(s.telegramUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-compact">${escapeHtml(s.telegram || 'Telegram')}</a>`
                : '<span class="text-muted">Not linked</span>'
            }</td>
            <td data-label="Action" class="col-center"><a href="contact.html?seller=${encodeURIComponent(s.username)}" class="btn btn-compact">Select Seller</a></td>
          </tr>`
        ).join('');
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const recipient = sellerSelect ? sellerSelect.value : 'RetroMarket Support';
      const productRef = productRefInput ? productRefInput.value.trim() : '';
      const productIdMatch = productRef.match(/#?(\d+)/);
      const orderNumber = orderRefInput ? orderRefInput.value.trim() : '';
      const guestName = (form.querySelector('[name="guest_name"]')?.value || '').trim();
      const guestEmail = (form.querySelector('[name="guest_email"]')?.value || '').trim();
      const message = (form.querySelector('[name="inquiry_message"]')?.value || '').trim();

      try {
        const resp = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient,
            productId: productIdMatch ? Number(productIdMatch[1]) : null,
            orderNumber,
            guestName,
            guestEmail,
            message,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (statusBox) {
            statusBox.textContent = data.error || 'Could not submit inquiry.';
            statusBox.className = 'error-box is-visible';
          }
          return;
        }
        if (statusBox) {
          statusBox.textContent = data.message || 'Inquiry submitted.';
          statusBox.className = 'inline-message is-visible';
        }
        form.reset();
      } catch {
        if (statusBox) {
          statusBox.textContent = 'Network error while submitting inquiry.';
          statusBox.className = 'error-box is-visible';
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initHeaderDate();
    initMobileNav();
    initHeaderSearch();

    if (window.RetroMarketData) {
      await window.RetroMarketData.loadStorefront();
    }

    applyWebsiteSettings();
    syncDynamicNavigationAndStats();

    if (window.RetroMarketCart) {
      window.RetroMarketCart.syncCartBadges();
      window.RetroMarketCart.renderCartPage();
    }

    renderHomepage();
    initMarketplaceCatalog();
    initCategoriesDirectory();
    await initProductDetailView();
    initContactPage();

    if (window.RetroMarketCheckout && window.RetroMarketCheckout.bootstrap) {
      await window.RetroMarketCheckout.bootstrap();
    }
  });
})();

/* ==========================================================================
   RetroMarket — Shopping Cart Module (Vanilla ES6)
   Uses localStorage strictly for temporary cart item selection convenience.
   All prices, stock limits, and totals are reconciled against live server catalog
   data and strictly re-verified server-side during Checkout.
   ========================================================================== */

(() => {
  'use strict';

  const STORAGE_KEY = 'retromarket_cart_v1';

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getMaxStockForProduct(product) {
    if (!product || !product.inStock) return 0;
    const stock = parseInt(product.stockQuantity, 10);
    return Number.isInteger(stock) && stock > 0 ? stock : 0;
  }

  function readRawCart() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeRawCart(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore storage quota restrictions
    }
  }

  function getValidatedItems() {
    const data = window.RetroMarketData;
    const rawItems = readRawCart();
    if (!data) return [];

    const valid = [];
    let mutated = false;

    for (const entry of rawItems) {
      const product = data.getProductById(entry.id);
      if (!product || !product.inStock) {
        mutated = true;
        continue;
      }
      const maxStock = getMaxStockForProduct(product);
      if (maxStock <= 0) {
        mutated = true;
        continue;
      }
      const parsedQty = parseInt(entry.qty, 10);
      if (Number.isNaN(parsedQty) || parsedQty < 1) {
        mutated = true;
        continue;
      }
      const clampedQty = Math.min(parsedQty, maxStock);
      if (clampedQty !== entry.qty) {
        mutated = true;
      }

      const unitShipping = Number(product.shipping?.costAmount || 0);
      const isDigital = Boolean(product.isDigital);

      valid.push({
        id: product.id,
        name: product.name,
        seller: product.seller,
        category: product.category,
        categoryName: product.categoryName,
        condition: product.condition,
        availability: product.availability,
        image: product.image,
        isDigital,
        unitPrice: Number(product.price),
        unitShipping,
        qty: clampedQty,
        maxStock,
        lineTotal: Number((product.price * clampedQty).toFixed(2)),
        lineShipping: Number((isDigital ? 0 : unitShipping).toFixed(2)),
      });
    }

    if (mutated) {
      writeRawCart(valid.map((item) => ({ id: item.id, qty: item.qty })));
    }

    return valid;
  }

  function getTotals() {
    const items = getValidatedItems();
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
    const shipping = Number(items.reduce((sum, item) => sum + item.lineShipping, 0).toFixed(2));
    const grandTotal = Number((subtotal + shipping).toFixed(2));
    const requiresPhysicalShipping = items.some((item) => !item.isDigital);
    return { items, itemCount, subtotal, shipping, grandTotal, requiresPhysicalShipping };
  }

  function addItem(productId, quantity = 1) {
    const data = window.RetroMarketData;
    if (!data) return null;
    const product = data.getProductById(productId);
    if (!product || !product.inStock) return null;

    const qtyToAdd = parseInt(quantity, 10);
    if (Number.isNaN(qtyToAdd) || qtyToAdd < 1) return null;

    const maxStock = getMaxStockForProduct(product);
    if (maxStock <= 0) return null;

    const current = getValidatedItems();
    const existing = current.find((entry) => entry.id === product.id);

    if (existing) {
      if (existing.qty >= maxStock) {
        return { ...product, stockLimitReached: true, maxStock };
      }
      existing.qty = Math.min(existing.qty + qtyToAdd, maxStock);
    } else {
      current.push({ id: product.id, qty: Math.min(qtyToAdd, maxStock) });
    }

    writeRawCart(current.map((entry) => ({ id: entry.id, qty: entry.qty })));
    syncCartBadges();
    return product;
  }

  function updateQuantity(productId, newQuantity) {
    const data = window.RetroMarketData;
    if (!data) return { ok: false, error: 'Catalog data unavailable.' };

    const product = data.getProductById(productId);
    if (!product || !product.inStock) {
      return { ok: false, error: 'This product is no longer available.' };
    }

    const trimmed = String(newQuantity).trim();
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: 'Quantity must be a whole number (1 or greater).' };
    }

    const parsed = parseInt(trimmed, 10);
    if (parsed < 1) {
      return { ok: false, error: 'Quantity must be at least 1. Use Remove to delete an item.' };
    }

    const maxStock = getMaxStockForProduct(product);
    if (parsed > maxStock) {
      return {
        ok: false,
        error:
          'Only ' +
          maxStock +
          ' unit(s) available for "' +
          product.name +
          '". Quantity adjusted to maximum available.',
      };
    }

    const current = getValidatedItems();
    const target = current.find((entry) => entry.id === product.id);
    if (!target) {
      return { ok: false, error: 'Item not found in cart.' };
    }

    target.qty = parsed;
    writeRawCart(current.map((entry) => ({ id: entry.id, qty: entry.qty })));
    syncCartBadges();
    return { ok: true, qty: parsed };
  }

  function removeItem(productId) {
    const numericId = Number(productId);
    const remaining = getValidatedItems().filter((entry) => entry.id !== numericId);
    writeRawCart(remaining.map((entry) => ({ id: entry.id, qty: entry.qty })));
    syncCartBadges();
    return remaining;
  }

  function clearCart() {
    writeRawCart([]);
    syncCartBadges();
  }

  function syncCartBadges() {
    const { itemCount, subtotal } = getTotals();
    const formatPrice = window.RetroMarketData
      ? window.RetroMarketData.formatPrice
      : (v) => '$' + Number(v).toFixed(2);

    document.querySelectorAll('.js-cart-count').forEach((el) => {
      el.textContent = String(itemCount);
    });
    document.querySelectorAll('.js-cart-subtotal').forEach((el) => {
      el.textContent = formatPrice(subtotal);
    });
  }

  function showCartError(message) {
    const box = document.getElementById('cart-error-box');
    if (!box) return;
    if (!message) {
      box.textContent = '';
      box.classList.remove('is-visible');
      return;
    }
    box.textContent = message;
    box.classList.add('is-visible');
  }

  function renderCartPage() {
    const tbody = document.getElementById('cart-table-body');
    if (!tbody) return;

    const totals = getTotals();
    const formatPrice = window.RetroMarketData
      ? window.RetroMarketData.formatPrice
      : (v) => '$' + Number(v).toFixed(2);

    const subtotalEl = document.getElementById('cart-summary-subtotal');
    const shippingEl = document.getElementById('cart-summary-shipping');
    const grandTotalEl = document.getElementById('cart-summary-grand-total');
    const sidebarShippingEl = document.getElementById('sidebar-cart-shipping');
    const sidebarGrandEl = document.getElementById('sidebar-cart-grand');
    const clearBtn = document.getElementById('clear-cart-btn');
    const proceedBtns = document.querySelectorAll('.js-proceed-checkout');
    const totalsWrap = document.getElementById('cart-totals-wrap');

    if (subtotalEl) subtotalEl.textContent = formatPrice(totals.subtotal);
    if (shippingEl) {
      shippingEl.textContent =
        totals.shipping > 0 ? formatPrice(totals.shipping) : formatPrice(0) + ' (Free / Digital)';
    }
    if (grandTotalEl) grandTotalEl.textContent = formatPrice(totals.grandTotal);
    if (sidebarShippingEl) sidebarShippingEl.textContent = formatPrice(totals.shipping);
    if (sidebarGrandEl) sidebarGrandEl.textContent = formatPrice(totals.grandTotal);

    if (totals.items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center">
            <div class="panel-body">
              <p><strong>Your shopping cart is currently empty.</strong></p>
              <p class="text-muted">Browse active marketplace listings to add items to your cart.</p>
              <a href="marketplace.html" class="btn btn-primary">Continue Shopping &raquo;</a>
            </div>
          </td>
        </tr>`;
      if (totalsWrap) totalsWrap.classList.add('is-hidden');
      if (clearBtn) clearBtn.disabled = true;
      proceedBtns.forEach((btn) => {
        btn.setAttribute('aria-disabled', 'true');
        btn.classList.add('is-hidden');
      });
      return;
    }

    if (totalsWrap) totalsWrap.classList.remove('is-hidden');
    if (clearBtn) clearBtn.disabled = false;
    proceedBtns.forEach((btn) => {
      btn.removeAttribute('aria-disabled');
      btn.classList.remove('is-hidden');
    });

    const safeUrl = (url) =>
      window.RetroMarketData
        ? window.RetroMarketData.sanitizeAssetUrl(url, 'assets/images/retro-keyboard.jpg')
        : url;

    tbody.innerHTML = totals.items
      .map(
        (item) => `
      <tr>
        <td class="listing-thumb-cell">
          <a href="product.html?id=${encodeURIComponent(item.id)}">
            <img src="${escapeHtml(safeUrl(item.image))}" alt="${escapeHtml(item.name)}" class="listing-thumb" width="64" height="48" />
          </a>
        </td>
        <td data-label="Product">
          <a href="product.html?id=${encodeURIComponent(item.id)}" class="listing-title-link">${escapeHtml(item.name)}</a>
          <div class="listing-meta-row">
            ID #${item.id} &middot; Seller: <a href="marketplace.html?seller=${encodeURIComponent(item.seller)}">${escapeHtml(item.seller)}</a>
            &middot; ${escapeHtml(item.condition)}
          </div>
          <div class="listing-meta-row">
            Shipping: ${item.lineShipping > 0 ? formatPrice(item.lineShipping) : 'Free (' + formatPrice(0) + ')'}
            &middot; Available stock: ${item.maxStock}
          </div>
        </td>
        <td data-label="Unit Price" class="col-right price nowrap">${formatPrice(item.unitPrice)}</td>
        <td data-label="Quantity" class="col-center nowrap">
          <div class="qty-controls">
            <button type="button" class="qty-btn js-qty-dec" data-id="${item.id}" aria-label="Decrease quantity">&minus;</button>
            <input type="number" min="1" max="${item.maxStock}" step="1" value="${item.qty}" class="qty-input js-qty-input" data-id="${item.id}" aria-label="Quantity" />
            <button type="button" class="qty-btn js-qty-inc" data-id="${item.id}" aria-label="Increase quantity">+</button>
            <button type="button" class="btn btn-compact js-qty-apply" data-id="${item.id}">Update</button>
          </div>
        </td>
        <td data-label="Line Total" class="col-right price nowrap"><strong>${formatPrice(item.lineTotal)}</strong></td>
        <td data-label="Action" class="col-center nowrap">
          <button type="button" class="btn btn-compact js-remove-cart" data-id="${item.id}">Remove</button>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-qty-dec').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        const item = getValidatedItems().find((entry) => entry.id === id);
        if (!item) return;
        if (item.qty <= 1) {
          showCartError('Minimum quantity is 1. Click Remove to delete the item from your cart.');
          return;
        }
        showCartError('');
        updateQuantity(id, item.qty - 1);
        renderCartPage();
      });
    });

    tbody.querySelectorAll('.js-qty-inc').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        const item = getValidatedItems().find((entry) => entry.id === id);
        if (!item) return;
        const result = updateQuantity(id, item.qty + 1);
        showCartError(result.ok ? '' : result.error);
        renderCartPage();
      });
    });

    tbody.querySelectorAll('.js-qty-apply').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        const input = tbody.querySelector('.js-qty-input[data-id="' + id + '"]');
        if (!input) return;
        const result = updateQuantity(id, input.value);
        if (!result.ok) {
          showCartError(result.error);
          const item = getValidatedItems().find((entry) => entry.id === id);
          if (item && parseInt(input.value, 10) > item.maxStock) {
            updateQuantity(id, item.maxStock);
          }
        } else {
          showCartError('');
        }
        renderCartPage();
      });
    });

    tbody.querySelectorAll('.js-remove-cart').forEach((btn) => {
      btn.addEventListener('click', () => {
        showCartError('');
        removeItem(btn.getAttribute('data-id'));
        renderCartPage();
      });
    });

    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = 'true';
      clearBtn.addEventListener('click', () => {
        showCartError('');
        clearCart();
        renderCartPage();
      });
    }
  }

  window.RetroMarketCart = {
    getItems: getValidatedItems,
    getValidatedItems,
    getTotals,
    getCount: () => getTotals().itemCount,
    getSubtotal: () => getTotals().subtotal,
    getMaxStockForProduct,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    syncCartBadges,
    renderCartPage,
  };
})();

/* ==========================================================================
   RetroMarket — Production Guest Checkout, Order Lookup & Payment Client
   Submits orders, order lookups, CyberSource Hosted Checkout initiation,
   Cryptocurrency invoicing/tx submission, and manual seller inquiries to the
   authoritative Express backend (/api/*).
   Never stores authoritative orders in localStorage or simulates payments.
   ========================================================================== */

(() => {
  'use strict';

  const PAYMENT_PREF_KEY = 'retromarket_selected_payment_v1';
  const RECENT_ORDER_SESSION_KEY = 'retromarket_recent_order_ref_v1';

  const PAYMENT_METHODS = {
    cybersource: { code: 'cybersource', label: 'CyberSource' },
    cryptocurrency: { code: 'cryptocurrency', label: 'Cryptocurrency' },
    manual: { code: 'manual', label: 'Contact Seller / Manual Payment' },
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPrice(amount, currency) {
    return window.RetroMarketData
      ? window.RetroMarketData.formatPrice(amount, currency)
      : '$' + Number(amount || 0).toFixed(2);
  }

  function getStatusClass(status) {
    switch (status) {
      case 'Awaiting Verification':
        return 'pay-status-awaiting';
      case 'Paid':
        return 'pay-status-paid';
      case 'Failed':
        return 'pay-status-failed';
      case 'Cancelled':
        return 'pay-status-cancelled';
      case 'Refunded':
        return 'pay-status-refunded';
      default:
        return 'pay-status-pending';
    }
  }

  function getSavedPaymentMethod() {
    try {
      const saved = window.localStorage.getItem(PAYMENT_PREF_KEY);
      return saved && PAYMENT_METHODS[saved] ? saved : 'cybersource';
    } catch {
      return 'cybersource';
    }
  }

  function savePaymentMethod(code) {
    if (!PAYMENT_METHODS[code]) return;
    try {
      window.localStorage.setItem(PAYMENT_PREF_KEY, code);
    } catch {
      // Ignore storage errors
    }
  }

  function rememberSessionOrderRef(orderNumber, email) {
    try {
      window.sessionStorage.setItem(
        RECENT_ORDER_SESSION_KEY,
        JSON.stringify({ orderNumber, email })
      );
    } catch {
      // Ignore storage errors
    }
  }

  function getSessionOrderRef() {
    try {
      const raw = window.sessionStorage.getItem(RECENT_ORDER_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.orderNumber && parsed.email ? parsed : null;
    } catch {
      return null;
    }
  }

  function buildOrderReceiptHtml(order, options = {}) {
    const primarySeller =
      order.products && order.products.length > 0 && order.products[0].seller
        ? order.products[0].seller
        : 'RetroMarket Support';
    const shippingDisplay = order.customer.requiresShipping
      ? order.customer.shippingAddress + ', ' + order.customer.city + ', ' + order.customer.country
      : 'Digital Delivery — ' + order.customer.city + ', ' + order.customer.country;

    const rowsHtml = (order.products || [])
      .map(
        (prod) => `
      <tr>
        <td>${
          prod.id
            ? '<a href="product.html?id=' + encodeURIComponent(prod.id) + '"><strong>' + escapeHtml(prod.name) + '</strong></a>'
            : '<strong>' + escapeHtml(prod.name) + '</strong>'
        }</td>
        <td class="col-center num">${prod.qty}</td>
        <td class="col-right price">${formatPrice(prod.unitPrice, order.currency)}</td>
        <td class="col-right price"><strong>${formatPrice(prod.lineTotal, order.currency)}</strong></td>
      </tr>`
      )
      .join('');

    return `
      ${
        options.showCreatedBanner
          ? `<div class="inline-message is-visible section-gap" role="status" aria-live="polite">
              <strong>Order Confirmed:</strong> Order <strong>${escapeHtml(order.orderNumber)}</strong> has been created in the RetroMarket database.
              Save your Order Reference ID and Email Address to complete payment or look up your order status.
            </div>`
          : ''
      }

      <section class="panel">
        <div class="panel-header panel-header-dark">
          <span>Order Confirmation &mdash; ${escapeHtml(order.orderNumber)}</span>
          <span class="panel-header-sub">${escapeHtml(order.createdAt)} UTC</span>
        </div>
        <table class="data-table">
          <tbody>
            <tr><th scope="row" class="receipt-label-col">Order Reference ID</th><td class="num"><strong>${escapeHtml(order.orderNumber)}</strong></td></tr>
            <tr><th scope="row">Order Status</th><td><strong>${escapeHtml(order.orderStatus)}</strong></td></tr>
            <tr><th scope="row">Payment Method</th><td><strong>${escapeHtml(order.paymentMethodLabel)}</strong></td></tr>
            <tr><th scope="row">Payment Status</th><td><span class="${getStatusClass(order.paymentStatus)}">${escapeHtml(order.paymentStatus)}</span></td></tr>
            <tr><th scope="row">Customer Name</th><td>${escapeHtml(order.customer.fullName)}</td></tr>
            <tr><th scope="row">Contact Email &amp; Phone</th><td>${escapeHtml(order.customer.email)} &middot; ${escapeHtml(order.customer.phone)}</td></tr>
            <tr><th scope="row">Delivery Destination</th><td>${escapeHtml(shippingDisplay)}</td></tr>
            ${
              order.customer.notes
                ? `<tr><th scope="row">Additional Notes</th><td>${escapeHtml(order.customer.notes)}</td></tr>`
                : ''
            }
          </tbody>
        </table>

        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Ordered Product</th>
              <th scope="col" class="col-center">Qty</th>
              <th scope="col" class="col-right">Unit Price</th>
              <th scope="col" class="col-right">Line Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div class="cart-totals-wrap">
          <table class="cart-totals-table">
            <tbody>
              <tr><th>Subtotal</th><td>${formatPrice(order.subtotal, order.currency)}</td></tr>
              <tr><th>Shipping Cost</th><td>${order.shipping > 0 ? formatPrice(order.shipping, order.currency) : formatPrice(0, order.currency) + ' (Free / Digital)'}</td></tr>
              <tr class="totals-grand-row"><th>Order Total (${escapeHtml(order.currency)})</th><td>${formatPrice(order.total, order.currency)}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="panel-footer">
          <div>
            <a href="contact.html?order=${encodeURIComponent(order.orderNumber)}&amp;seller=${encodeURIComponent(primarySeller)}" class="btn">Contact Seller</a>
            <a href="marketplace.html" class="btn">Continue Shopping</a>
          </div>
          <div>
            ${
              order.paymentStatus !== 'Paid' && order.orderStatus !== 'Cancelled'
                ? order.paymentMethod === 'cybersource' && options.enableGatewayButton
                  ? `<button type="button" class="btn btn-primary js-open-cs-gateway-btn">Open Payment Gateway &raquo;</button>
                     <a href="payment.html?order=${encodeURIComponent(order.orderNumber)}" class="btn">Payment Options</a>`
                  : `<a href="payment.html?order=${encodeURIComponent(order.orderNumber)}" class="btn btn-primary">Proceed to Payment &raquo;</a>`
                : ''
            }
          </div>
        </div>
      </section>`;
  }

  /* ========================================================================
     1. Guest Checkout Page (checkout.html)
     ======================================================================== */
  function initCheckoutPage() {
    const form = document.getElementById('checkout-form');
    if (!form || !window.RetroMarketCart) return;

    function updatePaymentOptionUI(selectedCode) {
      const method = PAYMENT_METHODS[selectedCode] || PAYMENT_METHODS.cybersource;
      document.querySelectorAll('.payment-option').forEach((row) => {
        const radio = row.querySelector('input[type="radio"]');
        const isMatch = radio && radio.value === method.code;
        row.classList.toggle('is-selected', Boolean(isMatch));
        if (radio && isMatch) radio.checked = true;
      });
      const summaryMethodEl = document.getElementById('checkout-selected-method');
      if (summaryMethodEl) summaryMethodEl.textContent = method.label;
    }

    function showValidationErrors(errors) {
      const errorBox = document.getElementById('checkout-error-box');
      if (!errorBox) return;
      if (!errors || errors.length === 0) {
        errorBox.innerHTML = '';
        errorBox.classList.remove('is-visible');
        return;
      }
      errorBox.innerHTML =
        '<strong>Please correct the following before placing your order:</strong><ul>' +
        errors.map((err) => '<li>' + escapeHtml(err) + '</li>').join('') +
        '</ul>';
      errorBox.classList.add('is-visible');
      errorBox.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }

    function renderOrderSummary() {
      const totals = window.RetroMarketCart.getTotals();
      const tbody = document.getElementById('checkout-summary-body');
      const countEl = document.getElementById('checkout-item-count');
      const subtotalEl = document.getElementById('checkout-subtotal');
      const shippingEl = document.getElementById('checkout-shipping');
      const totalEl = document.getElementById('checkout-grand-total');
      const emptyGuardEl = document.getElementById('checkout-empty-guard');
      const formSectionEl = document.getElementById('checkout-form-section');
      const submitBtn = document.getElementById('checkout-submit-btn');

      if (countEl) countEl.textContent = String(totals.itemCount);
      if (subtotalEl) subtotalEl.textContent = formatPrice(totals.subtotal);
      if (shippingEl) {
        shippingEl.textContent =
          totals.shipping > 0 ? formatPrice(totals.shipping) : formatPrice(0) + ' (Free / Digital)';
      }
      if (totalEl) totalEl.textContent = formatPrice(totals.grandTotal);

      if (tbody) {
        if (totals.items.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="4" class="text-center text-muted">No items currently in cart.</td></tr>';
        } else {
          tbody.innerHTML = totals.items
            .map(
              (item) => `
            <tr>
              <td>
                <a href="product.html?id=${encodeURIComponent(item.id)}"><strong>${escapeHtml(item.name)}</strong></a>
                <div class="listing-meta-row">Seller: ${escapeHtml(item.seller)}</div>
              </td>
              <td class="col-center num">${item.qty}</td>
              <td class="col-right price">${formatPrice(item.unitPrice)}</td>
              <td class="col-right price"><strong>${formatPrice(item.lineTotal)}</strong></td>
            </tr>`
            )
            .join('');
        }
      }

      const isEmpty = totals.items.length === 0;
      if (emptyGuardEl) emptyGuardEl.classList.toggle('is-hidden', !isEmpty);
      if (formSectionEl) formSectionEl.classList.toggle('is-hidden', isEmpty);
      if (submitBtn) submitBtn.disabled = isEmpty;

      const addressInput = document.getElementById('chk-address');
      const addressReqFlag = document.getElementById('shipping-address-required-flag');
      const addressHint = document.getElementById('shipping-address-hint');
      if (addressInput) {
        if (totals.requiresPhysicalShipping) {
          addressInput.setAttribute('required', 'required');
          if (addressReqFlag) addressReqFlag.textContent = '*';
          if (addressHint) addressHint.textContent = 'Required for physical item delivery.';
        } else {
          addressInput.removeAttribute('required');
          if (addressReqFlag) addressReqFlag.textContent = '(Optional — Digital Only)';
          if (addressHint) {
            addressHint.textContent =
              'Your cart contains digital items only; physical shipping address is optional.';
          }
        }
      }

      return totals;
    }

    updatePaymentOptionUI(getSavedPaymentMethod());
    renderOrderSummary();

    form.querySelectorAll('input[name="payment_method"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        savePaymentMethod(radio.value);
        updatePaymentOptionUI(radio.value);
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const totals = renderOrderSummary();
      if (!totals || totals.items.length === 0) {
        showValidationErrors(['Your shopping cart is empty.']);
        return;
      }

      const submitBtn = document.getElementById('checkout-submit-btn');
      const selectedRadio = form.querySelector('input[name="payment_method"]:checked');
      const payload = {
        fullName: (form.querySelector('[name="full_name"]')?.value || '').trim(),
        email: (form.querySelector('[name="email"]')?.value || '').trim(),
        phone: (form.querySelector('[name="phone"]')?.value || '').trim(),
        country: (form.querySelector('[name="country"]')?.value || '').trim(),
        city: (form.querySelector('[name="city"]')?.value || '').trim(),
        shippingAddress: (form.querySelector('[name="shipping_address"]')?.value || '').trim(),
        notes: (form.querySelector('[name="notes"]')?.value || '').trim(),
        paymentMethod: selectedRadio ? selectedRadio.value : 'cybersource',
        items: totals.items.map((item) => ({ id: item.id, qty: item.qty })),
      };

      if (submitBtn) submitBtn.disabled = true;
      try {
        const resp = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          showValidationErrors(Array.isArray(data.errors) ? data.errors : [data.error || 'Checkout failed.']);
          return;
        }

        showValidationErrors([]);
        savePaymentMethod(payload.paymentMethod);
        rememberSessionOrderRef(data.order.orderNumber, data.order.customer.email);
        window.RetroMarketCart.clearCart();

        const confirmSection = document.getElementById('checkout-confirmation-section');
        const formSection = document.getElementById('checkout-form-section');
        const emptyGuard = document.getElementById('checkout-empty-guard');
        if (formSection) formSection.classList.add('is-hidden');
        if (emptyGuard) emptyGuard.classList.add('is-hidden');
        if (confirmSection) {
          confirmSection.innerHTML = buildOrderReceiptHtml(data.order, {
            showCreatedBanner: true,
            enableGatewayButton: true,
          });
          confirmSection.classList.remove('is-hidden');

          const openOrderGateway = () => {
            if (!window.RetroMarketCyberSourceGateway) return;
            window.RetroMarketCyberSourceGateway.open({
              orderNumber: data.order.orderNumber,
              formattedAmount:
                formatPrice(data.order.total, data.order.currency) + ' ' + data.order.currency,
            });
          };

          const gwBtn = confirmSection.querySelector('.js-open-cs-gateway-btn');
          if (gwBtn) {
            gwBtn.addEventListener('click', openOrderGateway);
          }

          // Open the CyberSource Payment Details gateway ONLY upon completing a CyberSource purchase
          if (data.order.paymentMethod === 'cybersource' && window.RetroMarketCyberSourceGateway) {
            openOrderGateway();
          }
        }
      } catch {
        showValidationErrors(['Network error while submitting your order. Please try again.']);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  /* ========================================================================
     2. Guest Order Lookup Page (orders.html)
     Requires BOTH Order Reference ID and Checkout Email Address
     ======================================================================== */
  async function initOrdersPage() {
    const form = document.getElementById('guest-order-lookup-form');
    const resultEl = document.getElementById('guest-order-lookup-result');
    if (!form || !resultEl) return;

    const orderInput = document.getElementById('guest-order-lookup-input');
    const emailInput = document.getElementById('guest-order-email-input');

    async function runLookup(orderNumber, email) {
      resultEl.classList.remove('is-hidden');
      resultEl.innerHTML = '<div class="notice-box">Looking up order...</div>';
      try {
        const resp = await fetch('/api/orders/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber, email }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.order) {
          resultEl.innerHTML =
            '<div class="error-box is-visible"><strong>Order Not Found:</strong> ' +
            escapeHtml(data.error || 'Check your Order Reference ID and Email Address.') +
            '</div>';
          return;
        }
        rememberSessionOrderRef(data.order.orderNumber, data.order.customer.email);
        resultEl.innerHTML = buildOrderReceiptHtml(data.order, { showCreatedBanner: false });
      } catch {
        resultEl.innerHTML =
          '<div class="error-box is-visible">Network error while looking up your order.</div>';
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const orderNum = (orderInput?.value || '').trim();
      const email = (emailInput?.value || '').trim();
      if (!orderNum || !email) {
        resultEl.classList.remove('is-hidden');
        resultEl.innerHTML =
          '<div class="error-box is-visible">Please enter both your Order Reference ID and checkout Email Address.</div>';
        return;
      }
      runLookup(orderNum, email);
    });

    const params = new URLSearchParams(window.location.search);
    const urlOrder = (params.get('order') || '').trim();
    const recent = getSessionOrderRef();
    if (urlOrder && orderInput) orderInput.value = urlOrder;
    if (recent) {
      if (orderInput && !orderInput.value) orderInput.value = recent.orderNumber;
      if (emailInput && !emailInput.value) emailInput.value = recent.email;
      if (orderInput?.value === recent.orderNumber && emailInput?.value) {
        await runLookup(orderInput.value, emailInput.value);
      }
    }
  }

  /* ========================================================================
     3. Production Payment Page (payment.html)
     ======================================================================== */
  async function initPaymentPage() {
    const paymentApp = document.getElementById('payment-page-app');
    if (!paymentApp) return;

    const params = new URLSearchParams(window.location.search);
    const recent = getSessionOrderRef();
    const orderLookupForm = document.getElementById('payment-order-lookup-form');
    const orderNumInput = document.getElementById('payment-lookup-order-num');
    const orderEmailInput = document.getElementById('payment-lookup-email');
    const orderLookupError = document.getElementById('payment-lookup-error');
    const activeWorkspace = document.getElementById('payment-active-workspace');

    let activeOrder = null;
    let activeEmail = '';
    let currentMethod = 'cybersource';
    let currentCryptoCoin = 'BTC';
    let activeCryptoInvoice = null;

    function activateMethodTab(methodCode) {
      if (!PAYMENT_METHODS[methodCode]) return;
      currentMethod = methodCode;
      document.querySelectorAll('.payment-tab-btn').forEach((btn) => {
        const match = btn.getAttribute('data-payment-tab') === methodCode;
        btn.classList.toggle('is-active', match);
        btn.setAttribute('aria-selected', String(match));
      });
      document.querySelectorAll('.payment-pane').forEach((pane) => {
        pane.classList.toggle('is-active', pane.id === 'payment-pane-' + methodCode);
      });
      const summaryMethodEl = document.getElementById('pay-summary-method');
      if (summaryMethodEl) summaryMethodEl.textContent = PAYMENT_METHODS[methodCode].label;
    }

    document.querySelectorAll('.payment-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => activateMethodTab(btn.getAttribute('data-payment-tab')));
    });

    function renderActiveOrder() {
      if (!activeOrder) {
        if (activeWorkspace) activeWorkspace.classList.add('is-hidden');
        return;
      }
      if (activeWorkspace) activeWorkspace.classList.remove('is-hidden');

      const formattedAmt = formatPrice(activeOrder.total, activeOrder.currency);
      const statusCls = getStatusClass(activeOrder.paymentStatus);

      const setTxt = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      setTxt('sidebar-pay-order', activeOrder.orderNumber);
      setTxt('sidebar-pay-total', formattedAmt);
      setTxt('pay-summary-order-id', activeOrder.orderNumber);
      setTxt('pay-summary-currency', activeOrder.currency);
      setTxt('pay-summary-amount', formattedAmt);
      setTxt('cs-order-ref', activeOrder.orderNumber);
      setTxt('cs-amount', formattedAmt);
      setTxt('cs-currency', activeOrder.currency);
      setTxt('crypto-order-ref', activeOrder.orderNumber);
      setTxt('crypto-amount-usd', formattedAmt + ' ' + activeOrder.currency);
      setTxt('manual-order-ref', activeOrder.orderNumber);
      setTxt('manual-total-amount', formattedAmt + ' ' + activeOrder.currency);

      [
        'sidebar-pay-status',
        'pay-summary-status',
        'cs-payment-status',
        'crypto-payment-status',
        'manual-payment-status',
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = activeOrder.paymentStatus;
          el.className = statusCls;
        }
      });

      const manualRefInput = document.getElementById('manual-inquiry-order-ref');
      const manualNameInput = document.getElementById('manual-inquiry-name');
      const manualEmailInput = document.getElementById('manual-inquiry-email');
      if (manualRefInput) manualRefInput.value = activeOrder.orderNumber;
      if (manualNameInput) manualNameInput.value = activeOrder.customer.fullName;
      if (manualEmailInput) manualEmailInput.value = activeOrder.customer.email;

      // Render CyberSource config status
      const caps = window.RetroMarketData ? window.RetroMarketData.getPaymentCapabilities() : null;
      const csStatusNotice = document.getElementById('cs-config-notice');
      const csInitBtn = document.getElementById('cs-initiate-btn');
      if (csStatusNotice && caps?.cybersource) {
        if (caps.cybersource.configured) {
          csStatusNotice.className = 'notice-box section-gap';
          csStatusNotice.innerHTML =
            '<strong>CyberSource Secure Acceptance Connected (' +
            escapeHtml(caps.cybersource.environment.toUpperCase()) +
            '):</strong> Click below to generate a server-signed session and redirect to CyberSource Hosted Checkout.';
        } else {
          csStatusNotice.className = 'notice-box section-gap';
          csStatusNotice.innerHTML =
            '<strong>CyberSource Payment Gateway Ready:</strong> Click <strong>Proceed to CyberSource Hosted Checkout</strong> below to open the Payment Details card interface for this order. Live settlement activates automatically once merchant Secure Acceptance credentials are configured on the server.';
        }
      }
      if (csInitBtn) {
        csInitBtn.disabled =
          activeOrder.paymentStatus === 'Paid' || activeOrder.orderStatus === 'Cancelled';
      }

      // Render payment attempts history from real DB
      const historyBody = document.getElementById('payment-history-body');
      if (historyBody) {
        const pays = activeOrder.payments || [];
        if (pays.length === 0) {
          historyBody.innerHTML =
            '<tr><td colspan="7" class="text-center text-muted">No payment transactions have been initiated for this order yet.</td></tr>';
        } else {
          historyBody.innerHTML = pays
            .map(
              (p) => `
            <tr>
              <td class="mono-ref">${escapeHtml(p.paymentRef)}</td>
              <td>${escapeHtml(p.method)}${p.cryptoCurrency ? ' (' + escapeHtml(p.cryptoCurrency) + ')' : ''}</td>
              <td class="col-right price">${formatPrice(p.amount, p.currency)}</td>
              <td class="col-center">${escapeHtml(p.currency)}</td>
              <td class="mono-ref">${escapeHtml(p.transactionRef || '—')}</td>
              <td><span class="${getStatusClass(p.status)}">${escapeHtml(p.status)}</span></td>
              <td class="nowrap text-muted">${escapeHtml(p.createdAt)}</td>
            </tr>`
            )
            .join('');
        }
      }

      // Render latest crypto invoice if one exists
      const latestCrypto = (activeOrder.payments || []).find((p) => p.method === 'cryptocurrency');
      if (latestCrypto) {
        activeCryptoInvoice = latestCrypto;
        renderCryptoInvoiceDetails(latestCrypto);
      }

      const urlMethod = params.get('method');
      activateMethodTab(
        urlMethod && PAYMENT_METHODS[urlMethod] ? urlMethod : activeOrder.paymentMethod
      );
    }

    function renderCryptoInvoiceDetails(inv) {
      const box = document.getElementById('crypto-invoice-details');
      if (!box) return;
      if (!inv) {
        box.classList.add('is-hidden');
        return;
      }
      box.classList.remove('is-hidden');
      const setTxt = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      setTxt('crypto-inv-ref', inv.paymentRef || '');
      setTxt('crypto-inv-coin', (inv.cryptoCurrency || inv.coin || '') + ' (' + (inv.cryptoNetwork || inv.network || '') + ')');
      setTxt('crypto-inv-amount', (inv.cryptoExpectedAmount || inv.cryptoAmount || '') + ' ' + (inv.cryptoCurrency || inv.coin || ''));
      setTxt('crypto-inv-expires', inv.expiresAt || '');
      const addrInput = document.getElementById('crypto-wallet-address');
      if (addrInput) addrInput.value = inv.cryptoWalletAddress || inv.walletAddress || '';
    }

    async function loadOrder(orderNumber, email) {
      if (orderLookupError) {
        orderLookupError.textContent = '';
        orderLookupError.classList.remove('is-visible');
      }
      try {
        const resp = await fetch('/api/orders/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber, email }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.order) {
          if (orderLookupError) {
            orderLookupError.textContent = data.error || 'Order not found.';
            orderLookupError.classList.add('is-visible');
          }
          return;
        }
        activeOrder = data.order;
        activeEmail = email;
        rememberSessionOrderRef(activeOrder.orderNumber, activeEmail);
        renderActiveOrder();
      } catch {
        if (orderLookupError) {
          orderLookupError.textContent = 'Network error loading order.';
          orderLookupError.classList.add('is-visible');
        }
      }
    }

    orderLookupForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const ord = (orderNumInput?.value || '').trim();
      const em = (orderEmailInput?.value || '').trim();
      if (!ord || !em) {
        if (orderLookupError) {
          orderLookupError.textContent = 'Enter both your Order Reference ID and checkout Email Address.';
          orderLookupError.classList.add('is-visible');
        }
        return;
      }
      loadOrder(ord, em);
    });

    // CyberSource Hosted Checkout Initiation (Purchase-Only Trigger)
    const csInitBtn = document.getElementById('cs-initiate-btn');
    const csFeedback = document.getElementById('cs-action-feedback');
    csInitBtn?.addEventListener('click', async () => {
      if (!activeOrder || !activeEmail) return;

      const caps = window.RetroMarketData ? window.RetroMarketData.getPaymentCapabilities() : null;
      if (!caps?.cybersource?.configured && window.RetroMarketCyberSourceGateway) {
        window.RetroMarketCyberSourceGateway.open({
          orderNumber: activeOrder.orderNumber,
          formattedAmount:
            formatPrice(activeOrder.total, activeOrder.currency) + ' ' + activeOrder.currency,
          onComplete: (summary) => {
            if (csFeedback) {
              csFeedback.textContent =
                'Card details verified in gateway (' +
                summary.brand +
                ' ' +
                summary.maskedNumber +
                '). Order payment status remains ' +
                activeOrder.paymentStatus +
                ' until live CyberSource merchant settlement is configured.';
              csFeedback.className = 'inline-message is-visible';
            }
          },
          onCancel: () => {
            if (csFeedback) {
              csFeedback.textContent = 'Payment gateway closed. Your order remains saved.';
              csFeedback.className = 'inline-message is-visible';
            }
          },
        });
        return;
      }

      csInitBtn.disabled = true;
      try {
        const resp = await fetch('/api/payments/cybersource/create-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber: activeOrder.orderNumber, email: activeEmail }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (csFeedback) {
            csFeedback.textContent = data.error || 'Could not initiate CyberSource checkout.';
            csFeedback.className = 'error-box is-visible';
          }
          return;
        }
        // Build and submit genuine server-signed POST form to CyberSource Hosted Checkout
        const postForm = document.createElement('form');
        postForm.method = 'POST';
        postForm.action = data.actionUrl;
        for (const [k, v] of Object.entries(data.fields || {})) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = k;
          input.value = String(v);
          postForm.appendChild(input);
        }
        document.body.appendChild(postForm);
        postForm.submit();
      } catch {
        if (csFeedback) {
          csFeedback.textContent = 'Network error contacting payment server.';
          csFeedback.className = 'error-box is-visible';
        }
      } finally {
        csInitBtn.disabled = false;
      }
    });

    // Cryptocurrency Coin Selector + Invoice Generation + Tx Submission
    document.querySelectorAll('.crypto-coin-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentCryptoCoin = btn.getAttribute('data-crypto-coin') || 'BTC';
        document.querySelectorAll('.crypto-coin-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
      });
    });

    const createCryptoBtn = document.getElementById('crypto-generate-invoice-btn');
    const cryptoFeedback = document.getElementById('crypto-tx-feedback');
    createCryptoBtn?.addEventListener('click', async () => {
      if (!activeOrder || !activeEmail) return;
      createCryptoBtn.disabled = true;
      try {
        const resp = await fetch('/api/payments/crypto/create-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderNumber: activeOrder.orderNumber,
            email: activeEmail,
            coin: currentCryptoCoin,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (cryptoFeedback) {
            cryptoFeedback.textContent = data.error || 'Could not generate cryptocurrency invoice.';
            cryptoFeedback.className = 'error-box is-visible';
          }
          return;
        }
        activeCryptoInvoice = data.invoice;
        renderCryptoInvoiceDetails(data.invoice);
        if (cryptoFeedback) {
          cryptoFeedback.textContent =
            'Invoice ' + data.invoice.paymentRef + ' generated. Send the exact amount before expiration.';
          cryptoFeedback.className = 'inline-message is-visible';
        }
        await loadOrder(activeOrder.orderNumber, activeEmail);
      } catch {
        if (cryptoFeedback) {
          cryptoFeedback.textContent = 'Network error generating cryptocurrency invoice.';
          cryptoFeedback.className = 'error-box is-visible';
        }
      } finally {
        createCryptoBtn.disabled = false;
      }
    });

    document.getElementById('crypto-copy-btn')?.addEventListener('click', async () => {
      const addr = document.getElementById('crypto-wallet-address')?.value || '';
      const fb = document.getElementById('crypto-copy-feedback');
      if (!addr) return;
      try {
        await navigator.clipboard.writeText(addr);
        if (fb) fb.textContent = 'Wallet address copied to clipboard.';
      } catch {
        if (fb) fb.textContent = 'Copy manually from the address field.';
      }
    });

    document.getElementById('crypto-tx-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeOrder || !activeEmail) return;
      const txHash = (document.getElementById('crypto-tx-hash')?.value || '').trim();
      try {
        const resp = await fetch('/api/payments/crypto/submit-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderNumber: activeOrder.orderNumber,
            email: activeEmail,
            paymentRef: activeCryptoInvoice?.paymentRef || '',
            coin: currentCryptoCoin,
            txHash,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (cryptoFeedback) {
            cryptoFeedback.textContent = data.error || 'Transaction submission failed.';
            cryptoFeedback.className = 'error-box is-visible';
          }
          return;
        }
        if (cryptoFeedback) {
          cryptoFeedback.textContent = data.message || 'Transaction hash submitted.';
          cryptoFeedback.className = 'inline-message is-visible';
        }
        await loadOrder(activeOrder.orderNumber, activeEmail);
      } catch {
        if (cryptoFeedback) {
          cryptoFeedback.textContent = 'Network error submitting transaction hash.';
          cryptoFeedback.className = 'error-box is-visible';
        }
      }
    });

    // Manual Payment Inquiry Form
    document.getElementById('manual-payment-inquiry-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeOrder) return;
      const fb = document.getElementById('manual-inquiry-feedback');
      const primarySeller =
        activeOrder.products && activeOrder.products[0]?.seller
          ? activeOrder.products[0].seller
          : 'RetroMarket Support';
      const methodChoice = document.getElementById('manual-method-select')?.value || 'Bank Transfer';
      const msg = (document.getElementById('manual-inquiry-msg')?.value || '').trim();

      try {
        const resp = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: primarySeller,
            orderNumber: activeOrder.orderNumber,
            guestName: (document.getElementById('manual-inquiry-name')?.value || '').trim(),
            guestEmail: (document.getElementById('manual-inquiry-email')?.value || '').trim(),
            message: '[' + methodChoice + '] ' + msg,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (fb) {
            fb.textContent = data.error || 'Could not submit payment inquiry.';
            fb.className = 'error-box is-visible';
          }
          return;
        }
        if (fb) {
          fb.textContent = data.message || 'Manual payment inquiry recorded.';
          fb.className = 'inline-message is-visible';
        }
        await loadOrder(activeOrder.orderNumber, activeEmail);
      } catch {
        if (fb) {
          fb.textContent = 'Network error submitting manual payment inquiry.';
          fb.className = 'error-box is-visible';
        }
      }
    });

    // Display CyberSource gateway return banner if redirected back from CyberSource
    const gatewayStatus = params.get('gateway_status');
    const returnedTxRef = params.get('tx_ref');
    const returnBox = document.getElementById('cs-return-state-box');
    if (gatewayStatus && returnBox) {
      returnBox.classList.add('is-visible');
      if (gatewayStatus === 'InvalidSignature') {
        returnBox.classList.add('state-failed');
        returnBox.textContent =
          'CyberSource return signature could not be verified. Order payment status was not altered.';
      } else {
        returnBox.classList.add(
          gatewayStatus === 'Failed' || gatewayStatus === 'Cancelled'
            ? 'state-failed'
            : 'state-awaiting'
        );
        returnBox.textContent =
          'CyberSource return processed. Current status: ' +
          gatewayStatus +
          (returnedTxRef ? ' (Transaction Ref: ' + returnedTxRef + ')' : '') +
          '. Final Paid settlement occurs strictly upon verified server webhook confirmation.';
      }
    }

    // Auto-load order if we have the matching session reference
    const urlOrder = (params.get('order') || '').trim();
    if (urlOrder && orderNumInput) orderNumInput.value = urlOrder;
    if (recent) {
      if (orderNumInput && !orderNumInput.value) orderNumInput.value = recent.orderNumber;
      if (orderEmailInput && !orderEmailInput.value) orderEmailInput.value = recent.email;
      if (orderNumInput?.value === recent.orderNumber && orderEmailInput?.value) {
        await loadOrder(orderNumInput.value, orderEmailInput.value);
      }
    }
  }

  window.RetroMarketCheckout = {
    bootstrap: async () => {
      initCheckoutPage();
      await initOrdersPage();
      await initPaymentPage();
    },
  };
})();

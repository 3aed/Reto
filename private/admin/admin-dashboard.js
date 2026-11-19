/* ==========================================================================
   RetroMarket — Private Administrator Dashboard Controller (Vanilla ES6)
   Uses authenticated HttpOnly server session cookies + X-CSRF-Token headers.
   ========================================================================== */

(() => {
  'use strict';

  const adminBase = document.body.getAttribute('data-admin-base') || '';
  const IMAGE_PRESETS = [
    { label: 'Mechanical Keyboard', path: 'assets/images/retro-keyboard.jpg' },
    { label: 'Portable Cassette Player', path: 'assets/images/retro-walkman.jpg' },
    { label: 'Handheld Console', path: 'assets/images/retro-handheld.jpg' },
    { label: 'PCI Graphics Card', path: 'assets/images/retro-gpu.jpg' },
    { label: 'Compact Digital Camera', path: 'assets/images/retro-camera.jpg' },
    { label: 'Beige CRT Monitor', path: 'assets/images/retro-crt-monitor.jpg' },
    { label: 'Boxed Software Set', path: 'assets/images/retro-software-box.jpg' },
    { label: 'Handheld PDA', path: 'assets/images/retro-pda.jpg' },
    { label: 'Trackball Mouse', path: 'assets/images/retro-trackball.jpg' },
    { label: 'Storage Media', path: 'assets/images/retro-storage-media.jpg' },
  ];

  const state = {
    csrfToken: '',
    admin: null,
    currency: 'USD',
    categories: [],
    sellers: [],
    products: [],
    orders: [],
    payments: [],
    inquiries: [],
    auditLogs: [],
    settings: null,
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(cents, currency) {
    const code = currency || state.currency || 'USD';
    const symbols = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$' };
    return (symbols[code] || '$') + (Number(cents || 0) / 100).toFixed(2);
  }

  function showMessage(elId, text, isError) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.className = (isError ? 'error-box' : 'inline-message') + ' is-visible';
  }

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) {
      headers['X-CSRF-Token'] = state.csrfToken;
    }

    const resp = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (resp.status === 401) {
      window.location.href = adminBase + '/login';
      throw new Error('Session expired');
    }

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || 'Request failed (' + resp.status + ')');
    }
    return data;
  }

  function activateTab(tabName) {
    document.querySelectorAll('.js-admin-tab').forEach((el) => {
      const match = el.getAttribute('data-admin-tab') === tabName;
      el.classList.toggle('is-active', match);
      el.classList.toggle('active', match);
    });
    document.querySelectorAll('.admin-section').forEach((sec) => {
      sec.classList.toggle('is-active', sec.id === 'admin-section-' + tabName);
    });
  }

  function renderOverview(dash) {
    const s = dash.stats;
    document.getElementById('ov-stat-products').textContent = String(s.totalProducts);
    document.getElementById('ov-stat-products-sub').textContent =
      'In Stock: ' + s.inStockProducts + ' · Out of Stock: ' + s.outOfStockProducts;
    document.getElementById('ov-stat-categories').textContent = String(s.totalCategories);
    document.getElementById('ov-stat-sellers').textContent = String(s.activeSellers);
    document.getElementById('ov-stat-sellers-sub').textContent = 'Total Sellers: ' + s.totalSellers;
    document.getElementById('ov-stat-orders').textContent = String(s.totalOrders);
    document.getElementById('ov-stat-revenue-sub').textContent =
      'Verified Paid Revenue: ' + formatMoney(Math.round(s.paidRevenue * 100));
    document.getElementById('ov-stat-pending-payments').textContent = String(s.pendingPayments);
    document.getElementById('ov-stat-inquiries').textContent = String(s.totalInquiries);

    document.getElementById('side-count-products').textContent = String(s.totalProducts);
    document.getElementById('side-count-categories').textContent = String(s.totalCategories);
    document.getElementById('side-count-sellers').textContent = String(s.totalSellers);
    document.getElementById('side-count-orders').textContent = String(s.totalOrders);
    document.getElementById('side-count-payments').textContent = String(s.pendingPayments);
    document.getElementById('side-count-inquiries').textContent = String(s.totalInquiries);

    const integBody = document.getElementById('admin-integration-status-body');
    if (integBody && dash.integrations) {
      const i = dash.integrations;
      const cryptoOk =
        i.crypto.webhookConfigured ||
        i.crypto.btcVerifierConfigured ||
        i.crypto.ethVerifierConfigured;
      integBody.innerHTML =
        '<tr><td class="sidebar-stat-label">CyberSource</td><td class="sidebar-stat-val">' +
        (i.cybersourceConfigured ? 'Configured' : 'Missing Env') +
        '</td></tr>' +
        '<tr><td class="sidebar-stat-label">SMTP Email</td><td class="sidebar-stat-val">' +
        (i.smtpConfigured ? 'Configured' : 'Missing Env') +
        '</td></tr>' +
        '<tr><td class="sidebar-stat-label">Crypto Verifier</td><td class="sidebar-stat-val">' +
        (cryptoOk ? 'Configured' : 'Missing Env') +
        '</td></tr>';
    }

    const recentBody = document.getElementById('ov-recent-audit-body');
    if (recentBody) {
      const logs = dash.auditLogs || [];
      if (logs.length === 0) {
        recentBody.innerHTML =
          '<tr><td colspan="5" class="text-center text-muted">No audit events recorded yet.</td></tr>';
      } else {
        recentBody.innerHTML = logs
          .slice(0, 10)
          .map(
            (l) => `
            <tr>
              <td><span class="badge-activity-type">${escapeHtml(l.action)}</span></td>
              <td>${escapeHtml(l.admin_email || 'system')}</td>
              <td>${escapeHtml([l.target_type, l.target_id].filter(Boolean).join(' #'))}</td>
              <td class="num">${escapeHtml(l.ip_address || '')}</td>
              <td class="col-right nowrap text-muted">${escapeHtml(l.created_at)}</td>
            </tr>`
          )
          .join('');
      }
    }
  }

  function renderCategories() {
    const tbody = document.getElementById('admin-categories-body');
    const prodCatSelect = document.getElementById('admin-prod-category');

    if (prodCatSelect) {
      const prev = prodCatSelect.value;
      prodCatSelect.innerHTML =
        state.categories.length === 0
          ? '<option value="">-- Create a Category first --</option>'
          : state.categories
              .map(
                (c) =>
                  '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>'
              )
              .join('');
      if (prev && state.categories.some((c) => String(c.id) === prev)) {
        prodCatSelect.value = prev;
      }
    }

    if (!tbody) return;
    if (state.categories.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted">No categories created yet. Add your first category above.</td></tr>';
      return;
    }

    tbody.innerHTML = state.categories
      .map(
        (c) => `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td class="mono-ref">${escapeHtml(c.slug)}</td>
          <td>${escapeHtml(c.description || '')}</td>
          <td class="col-right num">${Number(c.product_count || 0)}</td>
          <td class="col-center admin-action-cell">
            <button type="button" class="btn btn-compact js-edit-cat" data-id="${c.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-compact js-del-cat" data-id="${c.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-edit-cat').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = state.categories.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!cat) return;
        document.getElementById('admin-cat-edit-id').value = String(cat.id);
        document.getElementById('admin-cat-name').value = cat.name;
        document.getElementById('admin-cat-slug').value = cat.slug;
        document.getElementById('admin-cat-slug').disabled = true;
        document.getElementById('admin-cat-desc').value = cat.description || '';
        document.getElementById('admin-category-form-heading').textContent =
          'Edit Category: ' + cat.name;
        document.getElementById('admin-cat-cancel-btn').classList.remove('is-hidden');
      });
    });

    tbody.querySelectorAll('.js-del-cat').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/admin/categories/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          showMessage('admin-category-msg', 'Category deleted.', false);
          await refreshAll();
        } catch (err) {
          showMessage('admin-category-msg', err.message, true);
        }
      });
    });
  }

  function renderSellers() {
    const tbody = document.getElementById('admin-sellers-body');
    const prodSellerSelect = document.getElementById('admin-prod-seller');

    if (prodSellerSelect) {
      const prev = prodSellerSelect.value;
      prodSellerSelect.innerHTML =
        state.sellers.length === 0
          ? '<option value="">-- Create a Seller first --</option>'
          : state.sellers
              .map(
                (s) =>
                  '<option value="' +
                  escapeHtml(s.id) +
                  '">' +
                  escapeHtml(s.username) +
                  '</option>'
              )
              .join('');
      if (prev && state.sellers.some((s) => String(s.id) === prev)) {
        prodSellerSelect.value = prev;
      }
    }

    if (!tbody) return;
    if (state.sellers.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted">No sellers registered yet. Add your first seller above.</td></tr>';
      return;
    }

    tbody.innerHTML = state.sellers
      .map(
        (s) => `
        <tr>
          <td><strong>${escapeHtml(s.username)}</strong></td>
          <td>${escapeHtml(s.email)}</td>
          <td>${escapeHtml(s.location || '')}</td>
          <td>${escapeHtml(s.specialty || '')}</td>
          <td class="col-right num">${Number(s.product_count || 0)}</td>
          <td><span class="admin-status-badge ${s.active ? 'badge-active' : 'badge-inactive'}">${s.active ? 'Active' : 'Inactive'}</span></td>
          <td class="col-center admin-action-cell">
            <button type="button" class="btn btn-compact js-edit-seller" data-id="${s.id}">Edit</button>
          </td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-edit-seller').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sel = state.sellers.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!sel) return;
        document.getElementById('admin-seller-edit-id').value = String(sel.id);
        document.getElementById('admin-seller-username').value = sel.username;
        document.getElementById('admin-seller-username').disabled = true;
        document.getElementById('admin-seller-email').value = sel.email;
        document.getElementById('admin-seller-location').value = sel.location || '';
        document.getElementById('admin-seller-specialty').value = sel.specialty || '';
        document.getElementById('admin-seller-response').value = sel.response_time || '';
        document.getElementById('admin-seller-active').checked = Boolean(sel.active);
        document.getElementById('admin-seller-form-heading').textContent =
          'Edit Seller: ' + sel.username;
        document.getElementById('admin-seller-cancel-btn').classList.remove('is-hidden');
      });
    });
  }

  function renderProducts() {
    const tbody = document.getElementById('admin-products-body');
    if (!tbody) return;
    if (state.products.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="text-center text-muted">No products in catalog. Create categories and sellers, then add products above.</td></tr>';
      return;
    }

    tbody.innerHTML = state.products
      .map(
        (p) => `
        <tr>
          <td class="num">#${p.id}</td>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>${escapeHtml(p.category_name)}</td>
          <td>${escapeHtml(p.seller_username)}</td>
          <td class="col-right price">${formatMoney(p.price_cents)}</td>
          <td class="col-center num">${Number(p.stock_quantity || 0)}</td>
          <td><span class="admin-status-badge ${p.in_stock && p.stock_quantity > 0 ? 'badge-active' : 'badge-inactive'}">${p.in_stock && p.stock_quantity > 0 ? 'In Stock' : 'Out of Stock'}</span></td>
          <td class="col-center admin-action-cell">
            <button type="button" class="btn btn-compact js-edit-prod" data-id="${p.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-compact js-del-prod" data-id="${p.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-edit-prod').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = state.products.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!p) return;
        document.getElementById('admin-prod-id').value = String(p.id);
        document.getElementById('admin-prod-name').value = p.name;
        document.getElementById('admin-prod-category').value = String(p.category_id);
        document.getElementById('admin-prod-seller').value = String(p.seller_id);
        document.getElementById('admin-prod-price').value = (Number(p.price_cents) / 100).toFixed(2);
        document.getElementById('admin-prod-stock').value = String(p.stock_quantity);
        document.getElementById('admin-prod-condition').value = p.condition || '';
        document.getElementById('admin-prod-shipping').value = (
          Number(p.shipping_cost_cents || 0) / 100
        ).toFixed(2);
        document.getElementById('admin-prod-instock').checked = Boolean(p.in_stock);
        document.getElementById('admin-prod-digital').checked = Boolean(p.is_digital);
        document.getElementById('admin-prod-featured').checked = Boolean(p.featured);
        document.getElementById('admin-prod-image').value = p.image_url || '';
        document.getElementById('admin-prod-image-preview').src = '/' + (p.image_url || 'assets/images/retro-keyboard.jpg');
        document.getElementById('admin-prod-description').value = p.description || '';
        document.getElementById('admin-product-form-heading').textContent =
          'Edit Product #' + p.id;
        document.getElementById('admin-prod-cancel-btn').classList.remove('is-hidden');
      });
    });

    tbody.querySelectorAll('.js-del-prod').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/admin/products/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          showMessage('admin-product-msg', 'Product deleted.', false);
          await refreshAll();
        } catch (err) {
          showMessage('admin-product-msg', err.message, true);
        }
      });
    });
  }

  function renderOrders() {
    const tbody = document.getElementById('admin-orders-body');
    const drawer = document.getElementById('admin-order-detail-drawer');
    if (!tbody) return;

    if (state.orders.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="text-center text-muted">No customer orders have been placed yet.</td></tr>';
      return;
    }

    tbody.innerHTML = state.orders
      .map(
        (ord) => `
        <tr>
          <td class="num"><strong>${escapeHtml(ord.order_number)}</strong></td>
          <td class="nowrap text-muted">${escapeHtml(ord.created_at)}</td>
          <td>${escapeHtml(ord.customer_name)}<div class="listing-meta-row">${escapeHtml(ord.customer_email)}</div></td>
          <td>${escapeHtml(ord.payment_method)}</td>
          <td><span class="admin-status-badge">${escapeHtml(ord.payment_status)}</span></td>
          <td><span class="admin-status-badge">${escapeHtml(ord.order_status)}</span></td>
          <td class="col-right price"><strong>${formatMoney(ord.total_cents, ord.currency)}</strong></td>
          <td class="col-center"><button type="button" class="btn btn-compact js-view-order" data-id="${ord.id}">Manage</button></td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-view-order').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ord = state.orders.find((o) => String(o.id) === btn.getAttribute('data-id'));
        if (!ord || !drawer) return;
        const itemsHtml = (ord.items || [])
          .map(
            (it) =>
              '<li>' +
              escapeHtml(it.product_name) +
              ' &times; ' +
              it.quantity +
              ' (' +
              formatMoney(it.line_total_cents, ord.currency) +
              ')</li>'
          )
          .join('');
        drawer.innerHTML = `
          <div class="panel-header panel-header-dark">
            <span>Order ${escapeHtml(ord.order_number)}</span>
            <button type="button" id="close-order-drawer" class="btn btn-compact">Close</button>
          </div>
          <div class="admin-detail-grid">
            <div>
              <strong>Customer Details</strong>
              <p>${escapeHtml(ord.customer_name)}<br/>${escapeHtml(ord.customer_email)}<br/>${escapeHtml(ord.customer_phone)}<br/>${escapeHtml(ord.shipping_address)}, ${escapeHtml(ord.customer_city)}, ${escapeHtml(ord.customer_country)}</p>
              <strong>Items</strong>
              <ul>${itemsHtml}</ul>
            </div>
            <div>
              <form id="admin-order-update-form">
                <label for="ord-status-select"><strong>Order Status</strong></label><br/>
                <select id="ord-status-select" class="form-select">
                  ${['Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled']
                    .map(
                      (st) =>
                        '<option value="' +
                        st +
                        '" ' +
                        (ord.order_status === st ? 'selected' : '') +
                        '>' +
                        st +
                        '</option>'
                    )
                    .join('')}
                </select><br/><br/>
                <label for="ord-internal-notes"><strong>Internal Notes</strong></label><br/>
                <textarea id="ord-internal-notes" class="form-textarea">${escapeHtml(ord.internal_notes || '')}</textarea><br/><br/>
                <button type="submit" class="btn btn-primary">Update Order</button>
                <div id="admin-order-drawer-msg" class="inline-message"></div>
              </form>
            </div>
          </div>`;
        drawer.classList.remove('is-hidden');
        document.getElementById('close-order-drawer')?.addEventListener('click', () => {
          drawer.classList.add('is-hidden');
        });
        document.getElementById('admin-order-update-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/api/admin/orders/' + ord.id, {
              method: 'PATCH',
              body: {
                orderStatus: document.getElementById('ord-status-select').value,
                internalNotes: document.getElementById('ord-internal-notes').value,
              },
            });
            showMessage('admin-order-drawer-msg', 'Order updated.', false);
            await refreshAll();
          } catch (err) {
            showMessage('admin-order-drawer-msg', err.message, true);
          }
        });
      });
    });
  }

  function renderPayments() {
    const tbody = document.getElementById('admin-payments-body');
    const drawer = document.getElementById('admin-payment-review-drawer');
    if (!tbody) return;

    if (state.payments.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted">No payment records exist yet.</td></tr>';
      return;
    }

    tbody.innerHTML = state.payments
      .map(
        (p) => `
        <tr>
          <td class="mono-ref">${escapeHtml(p.payment_ref)}</td>
          <td class="num"><strong>${escapeHtml(p.order_number)}</strong></td>
          <td>${escapeHtml(p.method)}${p.crypto_currency ? ' (' + escapeHtml(p.crypto_currency) + ')' : ''}</td>
          <td class="col-right price">${formatMoney(p.expected_amount_cents, p.currency)}</td>
          <td class="mono-ref">${escapeHtml(p.provider_transaction_id || p.tx_hash || '—')}</td>
          <td><span class="admin-status-badge">${escapeHtml(p.status)}</span></td>
          <td class="col-center"><button type="button" class="btn btn-compact js-review-pay" data-id="${p.id}">Review</button></td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-review-pay').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = state.payments.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!p || !drawer) return;
        const allowManualPaid = p.method === 'manual';
        const statusOptions = allowManualPaid
          ? ['Pending', 'Awaiting Verification', 'Paid', 'Failed', 'Cancelled', 'Refunded']
          : ['Pending', 'Awaiting Verification', 'Failed', 'Cancelled', 'Refunded'];

        drawer.innerHTML = `
          <div class="panel-header panel-header-dark">
            <span>Payment ${escapeHtml(p.payment_ref)} (${escapeHtml(p.order_number)})</span>
            <button type="button" id="close-pay-drawer" class="btn btn-compact">Close</button>
          </div>
          <div class="panel-body">
            <p><strong>Method:</strong> ${escapeHtml(p.method)} &middot; <strong>Amount:</strong> ${formatMoney(p.expected_amount_cents, p.currency)} &middot; <strong>Reference:</strong> <code>${escapeHtml(p.provider_transaction_id || p.tx_hash || 'None')}</code></p>
            <form id="admin-pay-review-form">
              <label for="pay-status-select"><strong>Status:</strong></label>
              <select id="pay-status-select" class="form-select">
                ${statusOptions
                  .map(
                    (st) =>
                      '<option value="' +
                      st +
                      '" ' +
                      (p.status === st ? 'selected' : '') +
                      '>' +
                      st +
                      '</option>'
                  )
                  .join('')}
              </select><br/><br/>
              <label for="pay-review-note"><strong>Verification / Audit Note:</strong></label><br/>
              <textarea id="pay-review-note" class="form-textarea">${escapeHtml(p.review_note || '')}</textarea><br/><br/>
              <button type="submit" class="btn btn-primary">Save Payment Review</button>
              <div id="admin-pay-drawer-msg" class="inline-message"></div>
            </form>
          </div>`;
        drawer.classList.remove('is-hidden');
        document.getElementById('close-pay-drawer')?.addEventListener('click', () => {
          drawer.classList.add('is-hidden');
        });
        document.getElementById('admin-pay-review-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/api/admin/payments/' + p.id, {
              method: 'PATCH',
              body: {
                status: document.getElementById('pay-status-select').value,
                reviewNote: document.getElementById('pay-review-note').value,
              },
            });
            showMessage('admin-pay-drawer-msg', 'Payment record updated.', false);
            await refreshAll();
          } catch (err) {
            showMessage('admin-pay-drawer-msg', err.message, true);
          }
        });
      });
    });
  }

  function renderInquiries() {
    const tbody = document.getElementById('admin-inquiries-body');
    if (!tbody) return;
    if (state.inquiries.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted">No guest inquiries received yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.inquiries
      .map(
        (inq) => `
        <tr>
          <td class="mono-ref">${escapeHtml(inq.inquiry_ref)}</td>
          <td>${escapeHtml(inq.recipient)}</td>
          <td>${escapeHtml(inq.guest_name)}<div class="listing-meta-row">${escapeHtml(inq.guest_email)}</div></td>
          <td class="num">${escapeHtml(inq.order_number || '—')}</td>
          <td>${escapeHtml(inq.message)}</td>
          <td>${inq.email_delivered ? 'Yes' : 'DB Only'}</td>
          <td class="col-right nowrap text-muted">${escapeHtml(inq.created_at)}</td>
        </tr>`
      )
      .join('');
  }

  function renderAuditLogs() {
    const tbody = document.getElementById('admin-audit-body');
    if (!tbody) return;
    if (state.auditLogs.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted">No audit logs recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.auditLogs
      .map(
        (l) => `
        <tr>
          <td class="num">#${l.id}</td>
          <td><span class="badge-activity-type">${escapeHtml(l.action)}</span></td>
          <td>${escapeHtml(l.admin_email || 'system')}</td>
          <td>${escapeHtml([l.target_type, l.target_id].filter(Boolean).join(' #'))}</td>
          <td class="mono-ref">${escapeHtml(l.details_json || '')}</td>
          <td class="num">${escapeHtml(l.ip_address || '')}</td>
          <td class="col-right nowrap text-muted">${escapeHtml(l.created_at)}</td>
        </tr>`
      )
      .join('');
  }

  function populateSettingsForm(settings) {
    if (!settings) return;
    state.currency = settings.default_currency || 'USD';
    document.getElementById('set-site-name').value = settings.site_name || '';
    document.getElementById('set-site-tagline').value = settings.tagline || '';
    document.getElementById('set-logo-path').value = settings.logo_path || '';
    document.getElementById('set-default-currency').value = settings.default_currency || 'USD';
    document.getElementById('set-support-email').value = settings.support_email || '';
    document.getElementById('set-seller-contact-info').value = settings.seller_contact_info || '';
    document.getElementById('set-guest-notice').value = settings.guest_checkout_notice || '';
    document.getElementById('set-btc-wallet').value = settings.btc_wallet_address || '';
    document.getElementById('set-eth-wallet').value = settings.eth_wallet_address || '';
    document.getElementById('set-usdt-wallet').value = settings.usdt_wallet_address || '';
    document.getElementById('set-usdt-network').value = settings.usdt_network || 'ERC-20';
  }

  async function refreshAll() {
    const [dash, cats, sels, prods, ords, pays, inqs, logs, sets] = await Promise.all([
      api('/api/admin/dashboard'),
      api('/api/admin/categories'),
      api('/api/admin/sellers'),
      api('/api/admin/products'),
      api('/api/admin/orders'),
      api('/api/admin/payments'),
      api('/api/admin/inquiries'),
      api('/api/admin/audit-logs'),
      api('/api/admin/settings'),
    ]);

    state.categories = cats.categories || [];
    state.sellers = sels.sellers || [];
    state.products = prods.products || [];
    state.orders = ords.orders || [];
    state.payments = pays.payments || [];
    state.inquiries = inqs.inquiries || [];
    state.auditLogs = logs.auditLogs || [];
    state.settings = sets.settings || null;

    populateSettingsForm(state.settings);
    renderOverview(dash);
    renderCategories();
    renderSellers();
    renderProducts();
    renderOrders();
    renderPayments();
    renderInquiries();
    renderAuditLogs();
  }

  function bindForms() {
    const presetSel = document.getElementById('admin-prod-image-preset');
    const imgInput = document.getElementById('admin-prod-image');
    const imgPrev = document.getElementById('admin-prod-image-preview');
    if (presetSel) {
      presetSel.innerHTML = IMAGE_PRESETS.map(
        (p) => '<option value="' + escapeHtml(p.path) + '">' + escapeHtml(p.label) + '</option>'
      ).join('');
      presetSel.addEventListener('change', () => {
        imgInput.value = presetSel.value;
        imgPrev.src = '/' + presetSel.value;
      });
    }
    if (imgInput) {
      imgInput.addEventListener('input', () => {
        const v = imgInput.value.trim();
        if (v.startsWith('assets/') || v.startsWith('https://')) {
          imgPrev.src = v.startsWith('assets/') ? '/' + v : v;
        }
      });
    }

    // Category form
    const catForm = document.getElementById('admin-category-form');
    const catCancel = document.getElementById('admin-cat-cancel-btn');
    const resetCatForm = () => {
      catForm.reset();
      document.getElementById('admin-cat-edit-id').value = '';
      document.getElementById('admin-cat-slug').disabled = false;
      document.getElementById('admin-category-form-heading').textContent = 'Create Category';
      catCancel.classList.add('is-hidden');
    };
    catCancel?.addEventListener('click', resetCatForm);
    catForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('admin-cat-edit-id').value;
      try {
        if (editId) {
          await api('/api/admin/categories/' + editId, {
            method: 'PUT',
            body: {
              name: document.getElementById('admin-cat-name').value,
              description: document.getElementById('admin-cat-desc').value,
            },
          });
          showMessage('admin-category-msg', 'Category updated.', false);
        } else {
          await api('/api/admin/categories', {
            method: 'POST',
            body: {
              name: document.getElementById('admin-cat-name').value,
              slug: document.getElementById('admin-cat-slug').value,
              description: document.getElementById('admin-cat-desc').value,
            },
          });
          showMessage('admin-category-msg', 'Category created.', false);
        }
        resetCatForm();
        await refreshAll();
      } catch (err) {
        showMessage('admin-category-msg', err.message, true);
      }
    });

    // Seller form
    const sellerForm = document.getElementById('admin-seller-form');
    const sellerCancel = document.getElementById('admin-seller-cancel-btn');
    const resetSellerForm = () => {
      sellerForm.reset();
      document.getElementById('admin-seller-edit-id').value = '';
      document.getElementById('admin-seller-username').disabled = false;
      document.getElementById('admin-seller-active').checked = true;
      document.getElementById('admin-seller-form-heading').textContent = 'Add Seller';
      sellerCancel.classList.add('is-hidden');
    };
    sellerCancel?.addEventListener('click', resetSellerForm);
    sellerForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('admin-seller-edit-id').value;
      const payload = {
        username: document.getElementById('admin-seller-username').value,
        email: document.getElementById('admin-seller-email').value,
        location: document.getElementById('admin-seller-location').value,
        specialty: document.getElementById('admin-seller-specialty').value,
        responseTime: document.getElementById('admin-seller-response').value,
        active: document.getElementById('admin-seller-active').checked,
      };
      try {
        if (editId) {
          await api('/api/admin/sellers/' + editId, { method: 'PUT', body: payload });
          showMessage('admin-seller-msg', 'Seller updated.', false);
        } else {
          await api('/api/admin/sellers', { method: 'POST', body: payload });
          showMessage('admin-seller-msg', 'Seller created.', false);
        }
        resetSellerForm();
        await refreshAll();
      } catch (err) {
        showMessage('admin-seller-msg', err.message, true);
      }
    });

    // Product form
    const prodForm = document.getElementById('admin-product-form');
    const prodCancel = document.getElementById('admin-prod-cancel-btn');
    const resetProdForm = () => {
      prodForm.reset();
      document.getElementById('admin-prod-id').value = '';
      document.getElementById('admin-prod-stock').value = '1';
      document.getElementById('admin-prod-condition').value = 'Used - Tested';
      document.getElementById('admin-prod-shipping').value = '0.00';
      document.getElementById('admin-prod-image').value = 'assets/images/retro-keyboard.jpg';
      document.getElementById('admin-prod-image-preview').src = '/assets/images/retro-keyboard.jpg';
      document.getElementById('admin-product-form-heading').textContent = 'Add New Product';
      prodCancel.classList.add('is-hidden');
    };
    prodCancel?.addEventListener('click', resetProdForm);
    prodForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('admin-prod-id').value;
      const payload = {
        name: document.getElementById('admin-prod-name').value,
        categoryId: document.getElementById('admin-prod-category').value,
        sellerId: document.getElementById('admin-prod-seller').value,
        price: document.getElementById('admin-prod-price').value,
        stockQuantity: document.getElementById('admin-prod-stock').value,
        condition: document.getElementById('admin-prod-condition').value,
        shippingCost: document.getElementById('admin-prod-shipping').value,
        inStock: document.getElementById('admin-prod-instock').checked,
        isDigital: document.getElementById('admin-prod-digital').checked,
        featured: document.getElementById('admin-prod-featured').checked,
        imageUrl: document.getElementById('admin-prod-image').value,
        description: document.getElementById('admin-prod-description').value,
      };
      try {
        if (editId) {
          await api('/api/admin/products/' + editId, { method: 'PUT', body: payload });
          showMessage('admin-product-msg', 'Product updated.', false);
        } else {
          await api('/api/admin/products', { method: 'POST', body: payload });
          showMessage('admin-product-msg', 'Product created.', false);
        }
        resetProdForm();
        await refreshAll();
      } catch (err) {
        showMessage('admin-product-msg', err.message, true);
      }
    });

    // Settings form
    document.getElementById('admin-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/settings', {
          method: 'PUT',
          body: {
            siteName: document.getElementById('set-site-name').value,
            tagline: document.getElementById('set-site-tagline').value,
            logoPath: document.getElementById('set-logo-path').value,
            defaultCurrency: document.getElementById('set-default-currency').value,
            supportEmail: document.getElementById('set-support-email').value,
            sellerContactInfo: document.getElementById('set-seller-contact-info').value,
            guestCheckoutNotice: document.getElementById('set-guest-notice').value,
            btcWalletAddress: document.getElementById('set-btc-wallet').value,
            ethWalletAddress: document.getElementById('set-eth-wallet').value,
            usdtWalletAddress: document.getElementById('set-usdt-wallet').value,
            usdtNetwork: document.getElementById('set-usdt-network').value,
          },
        });
        showMessage('admin-settings-msg', 'Website settings saved to database.', false);
        await refreshAll();
      } catch (err) {
        showMessage('admin-settings-msg', err.message, true);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const dateEl = document.getElementById('admin-current-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }

    document.querySelectorAll('.js-admin-tab').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        activateTab(el.getAttribute('data-admin-tab'));
      });
    });

    document.querySelectorAll('.js-admin-logout').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/admin/auth/logout', { method: 'POST' });
        } catch {
          // Ignore network errors on sign out
        }
        window.location.href = adminBase + '/login';
      });
    });

    document.getElementById('admin-refresh-all-btn')?.addEventListener('click', () => {
      refreshAll().catch(() => {});
    });

    bindForms();

    try {
      const me = await api('/api/admin/auth/me');
      state.admin = me.admin;
      state.csrfToken = me.csrfToken;
      document.getElementById('admin-session-email').textContent = me.admin.email;
      document.getElementById('admin-session-role').textContent = me.admin.role;
      document.getElementById('admin-session-expires').textContent = me.admin.expiresAt;
      await refreshAll();
    } catch {
      window.location.href = adminBase + '/login';
    }
  });
})();

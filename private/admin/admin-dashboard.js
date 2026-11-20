/* ==========================================================================
   RetroMarket — Private Administrator Dashboard Controller (Vanilla ES6)
   Uses authenticated HttpOnly server session cookies + X-CSRF-Token headers.
   Supports persistent multi-image uploads (JPG/PNG/WebP), full product specs,
   custom attributes, shipping configuration, and seller contact links.
   ========================================================================== */

(() => {
  'use strict';

  const adminBase = document.body.getAttribute('data-admin-base') || '';
  const MAX_PRODUCT_IMAGES = 12;

  const state = {
    csrfToken: '',
    admin: null,
    currency: 'USD',
    categories: [],
    sellers: [],
    products: [],
    cryptoMethods: [],
    orders: [],
    payments: [],
    inquiries: [],
    auditLogs: [],
    settings: null,
    // Active product form gallery state: Array<{ src: string, caption: string, newlyUploaded?: boolean }>
    productGallery: [],
    replacingGalleryIndex: -1,
    newlyUploadedQrUrl: '',
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseJsonField(val, fallback) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    try {
      const parsed = JSON.parse(String(val));
      return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function formatMoney(cents, currency) {
    const code = currency || state.currency || 'USD';
    const symbols = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$' };
    return (symbols[code] || '$') + (Number(cents || 0) / 100).toFixed(2);
  }

  function resolvePreviewSrc(src) {
    const raw = String(src || '').trim();
    if (!raw) return '/assets/images/retro-keyboard.jpg';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      return raw;
    }
    return '/' + raw;
  }

  function deleteUnsavedStorageUrl(url) {
    const cleaned = String(url || '').trim();
    if (!cleaned || !cleaned.includes('/storage/v1/object/public/')) return;
    api('/api/admin/uploads/images', {
      method: 'DELETE',
      body: { url: cleaned },
    }).catch(() => {});
  }

  function showMessage(elId, text, isError) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.className = 'inline-message';
      return;
    }
    el.textContent = text;
    el.className = (isError ? 'error-box' : 'inline-message') + ' is-visible';
  }

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const isFormData = options.formData instanceof FormData;
    const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    if (options.body !== undefined && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) {
      headers['X-CSRF-Token'] = state.csrfToken;
    }

    const resp = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: isFormData
        ? options.formData
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
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

  /* ------------------------------------------------------------------------
     Dynamic Key/Value Row Builder (Specifications & Custom Attributes)
     ------------------------------------------------------------------------ */
  function appendKeyValueRow(containerId, keyVal, valVal, keyPlaceholder, valPlaceholder) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'admin-kv-row';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'form-input js-kv-key';
    keyInput.placeholder = keyPlaceholder;
    keyInput.value = keyVal || '';

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'form-input js-kv-val';
    valInput.placeholder = valPlaceholder;
    valInput.value = valVal || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-danger btn-compact';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }

  function setKeyValueRows(containerId, mapObj, keyPlaceholder, valPlaceholder) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const entries = mapObj && typeof mapObj === 'object' ? Object.entries(mapObj) : [];
    if (entries.length === 0) {
      appendKeyValueRow(containerId, '', '', keyPlaceholder, valPlaceholder);
      return;
    }
    entries.forEach(([k, v]) => {
      appendKeyValueRow(containerId, k, String(v ?? ''), keyPlaceholder, valPlaceholder);
    });
  }

  function collectKeyValueRows(containerId) {
    const container = document.getElementById(containerId);
    const result = {};
    if (!container) return result;
    container.querySelectorAll('.admin-kv-row').forEach((row) => {
      const k = (row.querySelector('.js-kv-key')?.value || '').trim();
      const v = (row.querySelector('.js-kv-val')?.value || '').trim();
      if (k && v) {
        result[k] = v;
      }
    });
    return result;
  }

  /* ------------------------------------------------------------------------
     Multi-Image Gallery Manager (Upload, Preview, Replace, Reorder, Delete)
     ------------------------------------------------------------------------ */
  async function uploadImageFiles(fileList, folder = 'products') {
    const files = Array.from(fileList || []);
    if (files.length === 0) return [];

    const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    for (const file of files) {
      if (!allowedTypes.has(String(file.type || '').toLowerCase())) {
        throw new Error('Unsupported file "' + file.name + '". Only JPG, PNG, and WebP images are allowed.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('File "' + file.name + '" exceeds the 5 MB limit.');
      }
    }

    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));

    const data = await api('/api/admin/uploads/images?folder=' + encodeURIComponent(folder), {
      method: 'POST',
      formData,
    });
    return Array.isArray(data.images) ? data.images : [];
  }

  function renderProductGallery() {
    const listEl = document.getElementById('admin-prod-gallery-list');
    if (!listEl) return;

    if (state.productGallery.length === 0) {
      listEl.innerHTML =
        '<div class="text-muted">No images uploaded yet. Choose JPG, PNG, or WebP files above to upload product photos.</div>';
      return;
    }

    listEl.innerHTML = state.productGallery
      .map(
        (img, idx) => `
        <div class="admin-gallery-item ${idx === 0 ? 'is-primary' : ''}">
          <div class="admin-gallery-thumb-row">
            <img src="${escapeHtml(resolvePreviewSrc(img.src))}" alt="Product image ${idx + 1}" class="admin-gallery-thumb" />
            <div>
              ${idx === 0 ? '<span class="admin-status-badge badge-active">Primary</span>' : '<span class="admin-status-badge">Image #' + (idx + 1) + '</span>'}
            </div>
          </div>
          <input
            type="text"
            class="form-input js-gallery-caption"
            data-idx="${idx}"
            value="${escapeHtml(img.caption || '')}"
            placeholder="Image caption"
          />
          <div class="admin-gallery-actions">
            ${idx > 0 ? `<button type="button" class="btn btn-compact js-gallery-primary" data-idx="${idx}">Make Primary</button>` : ''}
            <button type="button" class="btn btn-compact js-gallery-replace" data-idx="${idx}">Replace</button>
            <button type="button" class="btn btn-danger btn-compact js-gallery-remove" data-idx="${idx}">Delete</button>
          </div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('.js-gallery-caption').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.getAttribute('data-idx'));
        if (state.productGallery[idx]) {
          state.productGallery[idx].caption = input.value;
        }
      });
    });

    listEl.querySelectorAll('.js-gallery-primary').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        if (idx > 0 && idx < state.productGallery.length) {
          const [picked] = state.productGallery.splice(idx, 1);
          state.productGallery.unshift(picked);
          renderProductGallery();
        }
      });
    });

    listEl.querySelectorAll('.js-gallery-replace').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        const replaceInput = document.getElementById('admin-prod-replace-file');
        if (!replaceInput) return;
        state.replacingGalleryIndex = idx;
        replaceInput.value = '';
        replaceInput.click();
      });
    });

    listEl.querySelectorAll('.js-gallery-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.getAttribute('data-idx'));
        const removed = state.productGallery[idx];
        if (!removed) return;
        state.productGallery.splice(idx, 1);
        renderProductGallery();

        // If this image was just uploaded and not yet saved to a product, remove it from Supabase Storage
        if (removed.newlyUploaded) {
          deleteUnsavedStorageUrl(removed.src);
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     Dashboard Section Renderers
     ------------------------------------------------------------------------ */
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
      integBody.innerHTML =
        '<tr><td class="sidebar-stat-label">Supabase DB</td><td class="sidebar-stat-val">' +
        (i.supabaseConnected ? 'Connected' : 'Not Configured') +
        '</td></tr>' +
        '<tr><td class="sidebar-stat-label">Storage Bucket</td><td class="sidebar-stat-val">' +
        escapeHtml(i.storageBucket || 'product-images') +
        '</td></tr>' +
        '<tr><td class="sidebar-stat-label">CyberSource</td><td class="sidebar-stat-val">' +
        escapeHtml(i.cybersourceStatus || 'Unavailable') +
        '</td></tr>' +
        '<tr><td class="sidebar-stat-label">Crypto Options</td><td class="sidebar-stat-val">' +
        escapeHtml(String(i.activeCryptoMethods ?? 0)) +
        ' active</td></tr>';
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
              <td data-label="Action"><span class="badge-activity-type">${escapeHtml(l.action)}</span></td>
              <td data-label="Admin">${escapeHtml(l.admin_email || 'system')}</td>
              <td data-label="Target">${escapeHtml([l.target_type, l.target_id].filter(Boolean).join(' #'))}</td>
              <td data-label="IP Address" class="num">${escapeHtml(l.ip_address || '')}</td>
              <td data-label="Timestamp (UTC)" class="col-right nowrap text-muted">${escapeHtml(l.created_at)}</td>
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
          <td data-label="Name"><strong>${escapeHtml(c.name)}</strong></td>
          <td data-label="Slug" class="mono-ref">${escapeHtml(c.slug)}</td>
          <td data-label="Description">${escapeHtml(c.description || '')}</td>
          <td data-label="Products" class="col-right num">${Number(c.product_count || 0)}</td>
          <td data-label="Actions" class="col-center admin-action-cell">
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
          <td data-label="Seller"><strong>${escapeHtml(s.username)}</strong></td>
          <td data-label="Contact">${escapeHtml(s.email)}${s.whatsapp ? '<div class="listing-meta-row">WA: ' + escapeHtml(s.whatsapp) + '</div>' : ''}${s.telegram ? '<div class="listing-meta-row">TG: ' + escapeHtml(s.telegram) + '</div>' : ''}</td>
          <td data-label="Location">${escapeHtml(s.location || '')}</td>
          <td data-label="Specialty">${escapeHtml(s.specialty || '')}</td>
          <td data-label="Products" class="col-right num">${Number(s.product_count || 0)}</td>
          <td data-label="Status"><span class="admin-status-badge ${s.active ? 'badge-active' : 'badge-inactive'}">${s.active ? 'Active' : 'Inactive'}</span></td>
          <td data-label="Actions" class="col-center admin-action-cell">
            <button type="button" class="btn btn-compact js-edit-seller" data-id="${s.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-compact js-del-seller" data-id="${s.id}">Delete</button>
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
        document.getElementById('admin-seller-phone').value = sel.phone || '';
        document.getElementById('admin-seller-whatsapp').value = sel.whatsapp || '';
        document.getElementById('admin-seller-telegram').value = sel.telegram || '';
        document.getElementById('admin-seller-other-url').value = sel.other_contact_url || '';
        document.getElementById('admin-seller-active').checked = Boolean(sel.active);
        document.getElementById('admin-seller-form-heading').textContent =
          'Edit Seller: ' + sel.username;
        document.getElementById('admin-seller-cancel-btn').classList.remove('is-hidden');
      });
    });

    tbody.querySelectorAll('.js-del-seller').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.armed !== 'true') {
          btn.dataset.armed = 'true';
          btn.textContent = 'Confirm?';
          setTimeout(() => {
            if (btn.isConnected && btn.dataset.armed === 'true') {
              btn.dataset.armed = 'false';
              btn.textContent = 'Delete';
            }
          }, 4000);
          return;
        }
        try {
          await api('/api/admin/sellers/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          showMessage('admin-seller-msg', 'Seller deleted.', false);
          await refreshAll();
        } catch (err) {
          showMessage('admin-seller-msg', err.message, true);
        }
      });
    });
  }

  function renderProducts() {
    const tbody = document.getElementById('admin-products-body');
    if (!tbody) return;
    if (state.products.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted">No products in catalog. Create categories and sellers, then add products above.</td></tr>';
      return;
    }

    tbody.innerHTML = state.products
      .map((p) => {
        const parsed = parseJsonField(p.gallery_json, []);
        const imgCount = Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 1;
        return `
        <tr>
          <td data-label="ID" class="num">#${p.id}</td>
          <td data-label="Photo" class="col-center">
            <img src="${escapeHtml(resolvePreviewSrc(p.image_url))}" alt="" class="admin-prod-table-thumb" />
            <div class="listing-meta-row">${imgCount} photo${imgCount === 1 ? '' : 's'}</div>
          </td>
          <td data-label="Product"><strong>${escapeHtml(p.name)}</strong><div class="listing-meta-row">${escapeHtml(p.condition || '')}</div></td>
          <td data-label="Category">${escapeHtml(p.category_name)}</td>
          <td data-label="Seller">${escapeHtml(p.seller_username)}</td>
          <td data-label="Price" class="col-right price">${formatMoney(p.price_cents)}</td>
          <td data-label="Stock" class="col-center num">${Number(p.stock_quantity || 0)}</td>
          <td data-label="Availability"><span class="admin-status-badge ${p.in_stock && p.stock_quantity > 0 ? 'badge-active' : 'badge-inactive'}">${escapeHtml(p.availability || (p.in_stock && p.stock_quantity > 0 ? 'In Stock' : 'Out of Stock'))}</span></td>
          <td data-label="Actions" class="col-center admin-action-cell">
            <a href="/product.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener noreferrer" class="btn btn-compact">View</a>
            <button type="button" class="btn btn-compact js-edit-prod" data-id="${p.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-compact js-del-prod" data-id="${p.id}">Delete</button>
          </td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.js-edit-prod').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = state.products.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!p) return;

        document.getElementById('admin-prod-id').value = String(p.id);
        document.getElementById('admin-prod-name').value = p.name || '';
        document.getElementById('admin-prod-category').value = String(p.category_id);
        document.getElementById('admin-prod-seller').value = String(p.seller_id);
        document.getElementById('admin-prod-price').value = (Number(p.price_cents) / 100).toFixed(2);
        document.getElementById('admin-prod-stock').value = String(p.stock_quantity);
        document.getElementById('admin-prod-availability').value = p.availability || '';
        document.getElementById('admin-prod-condition').value = p.condition || '';
        document.getElementById('admin-prod-instock').checked = Boolean(p.in_stock);
        document.getElementById('admin-prod-digital').checked = Boolean(p.is_digital);
        document.getElementById('admin-prod-featured').checked = Boolean(p.featured);
        document.getElementById('admin-prod-description').value = p.description || '';

        // Shipping fields
        document.getElementById('admin-prod-shipping').value = (
          Number(p.shipping_cost_cents || 0) / 100
        ).toFixed(2);
        document.getElementById('admin-prod-shipping-method').value =
          p.shipping_method || 'Standard Ground Shipping';
        document.getElementById('admin-prod-shipping-handling').value =
          p.shipping_handling || 'Ships within 2 business days';
        document.getElementById('admin-prod-shipping-from').value = p.shipping_from || '';
        document.getElementById('admin-prod-return-policy').value =
          p.return_policy || '14-day return policy';

        // Gallery images
        let parsedGallery = parseJsonField(p.gallery_json, []);
        if (!Array.isArray(parsedGallery)) parsedGallery = [];
        if (parsedGallery.length === 0 && p.image_url) {
          parsedGallery = [{ src: p.image_url, caption: p.name }];
        }
        state.productGallery = parsedGallery.map((item) => ({
          src: item.src,
          caption: item.caption || p.name || '',
          newlyUploaded: false,
        }));
        renderProductGallery();

        // Specifications & Custom Attributes
        const specsObj = parseJsonField(p.specs_json, {});
        const attrsObj = parseJsonField(p.custom_attributes_json, {});
        const contactObj = parseJsonField(p.seller_contact_json, {});

        setKeyValueRows(
          'admin-prod-specs-list',
          specsObj,
          'Specification (e.g. Brand, Interface)',
          'Value'
        );
        setKeyValueRows(
          'admin-prod-attrs-list',
          attrsObj,
          'Attribute (e.g. Color, Region, SKU)',
          'Value'
        );

        document.getElementById('admin-prod-contact-name').value = contactObj.contactName || '';
        document.getElementById('admin-prod-contact-email').value = contactObj.email || '';
        document.getElementById('admin-prod-contact-whatsapp').value = contactObj.whatsapp || '';
        document.getElementById('admin-prod-contact-telegram').value = contactObj.telegram || '';
        document.getElementById('admin-prod-contact-phone').value = contactObj.phone || '';
        document.getElementById('admin-prod-contact-other-label').value =
          contactObj.otherLabel || '';
        document.getElementById('admin-prod-contact-other-url').value = contactObj.otherUrl || '';
        document.getElementById('admin-prod-contact-notes').value = contactObj.notes || '';

        document.getElementById('admin-product-form-heading').textContent =
          'Edit Product #' + p.id + ' — ' + p.name;
        document.getElementById('admin-prod-cancel-btn').classList.remove('is-hidden');
        document
          .getElementById('admin-product-form-heading')
          .scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    tbody.querySelectorAll('.js-del-prod').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.armed !== 'true') {
          btn.dataset.armed = 'true';
          btn.textContent = 'Confirm?';
          setTimeout(() => {
            if (btn.isConnected && btn.dataset.armed === 'true') {
              btn.dataset.armed = 'false';
              btn.textContent = 'Delete';
            }
          }, 4000);
          return;
        }
        try {
          await api('/api/admin/products/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          showMessage('admin-product-msg', 'Product deleted from catalog and database.', false);
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
          <td data-label="Order #" class="num"><strong>${escapeHtml(ord.order_number)}</strong></td>
          <td data-label="Date (UTC)" class="nowrap text-muted">${escapeHtml(ord.created_at)}</td>
          <td data-label="Customer">${escapeHtml(ord.customer_name)}<div class="listing-meta-row">${escapeHtml(ord.customer_email)}</div></td>
          <td data-label="Method">${escapeHtml(ord.payment_method)}</td>
          <td data-label="Payment Status"><span class="admin-status-badge">${escapeHtml(ord.payment_status)}</span></td>
          <td data-label="Order Status"><span class="admin-status-badge">${escapeHtml(ord.order_status)}</span></td>
          <td data-label="Total" class="col-right price"><strong>${formatMoney(ord.total_cents, ord.currency)}</strong></td>
          <td data-label="Action" class="col-center"><button type="button" class="btn btn-compact js-view-order" data-id="${ord.id}">Manage</button></td>
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
          <td data-label="Payment Ref" class="mono-ref">${escapeHtml(p.payment_ref)}</td>
          <td data-label="Order #" class="num"><strong>${escapeHtml(p.order_number)}</strong></td>
          <td data-label="Method">${escapeHtml(p.method)}${p.crypto_currency ? ' (' + escapeHtml(p.crypto_currency) + (p.crypto_network ? ' / ' + escapeHtml(p.crypto_network) : '') + ')' : ''}</td>
          <td data-label="Amount" class="col-right price">${formatMoney(p.expected_amount_cents, p.currency)}</td>
          <td data-label="Customer Ref / Tx" class="mono-ref">${escapeHtml(p.customer_reference || p.tx_hash || p.provider_transaction_id || '—')}</td>
          <td data-label="Status"><span class="admin-status-badge">${escapeHtml(p.status)}</span></td>
          <td data-label="Action" class="col-center"><button type="button" class="btn btn-compact js-review-pay" data-id="${p.id}">Review</button></td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-review-pay').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = state.payments.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!p || !drawer) return;
        const allowManualPaid = p.method === 'cryptocurrency' || p.method === 'manual';
        const statusOptions = allowManualPaid
          ? ['Pending', 'Pending Verification', 'Paid', 'Failed', 'Cancelled', 'Refunded']
          : ['Pending', 'Pending Verification', 'Failed', 'Cancelled', 'Refunded'];

        const extraDetails = [
          p.crypto_currency ? '<strong>Currency:</strong> ' + escapeHtml(p.crypto_currency) : '',
          p.crypto_network ? '<strong>Network:</strong> ' + escapeHtml(p.crypto_network) : '',
          p.wallet_address ? '<strong>Wallet:</strong> <code>' + escapeHtml(p.wallet_address) + '</code>' : '',
          p.customer_note ? '<strong>Customer Note:</strong> ' + escapeHtml(p.customer_note) : '',
        ]
          .filter(Boolean)
          .join(' &middot; ');

        drawer.innerHTML = `
          <div class="panel-header panel-header-dark">
            <span>Payment ${escapeHtml(p.payment_ref)} (${escapeHtml(p.order_number)})</span>
            <button type="button" id="close-pay-drawer" class="btn btn-compact">Close</button>
          </div>
          <div class="panel-body">
            <p><strong>Method:</strong> ${escapeHtml(p.method)} &middot; <strong>Amount:</strong> ${formatMoney(p.expected_amount_cents, p.currency)} &middot; <strong>Customer Reference:</strong> <code>${escapeHtml(p.customer_reference || p.tx_hash || p.provider_transaction_id || 'None')}</code></p>
            ${extraDetails ? '<p>' + extraDetails + '</p>' : ''}
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
              <label for="pay-review-note"><strong>Verification / Audit Note (required to mark Paid):</strong></label><br/>
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
        '<tr><td colspan="6" class="text-center text-muted">No guest inquiries received yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.inquiries
      .map(
        (inq) => `
        <tr>
          <td data-label="Ref" class="mono-ref">${escapeHtml(inq.inquiry_ref)}</td>
          <td data-label="Recipient">${escapeHtml(inq.recipient)}</td>
          <td data-label="Sender">${escapeHtml(inq.guest_name)}<div class="listing-meta-row">${escapeHtml(inq.guest_email)}</div></td>
          <td data-label="Order #" class="num">${escapeHtml(inq.order_number || '—')}</td>
          <td data-label="Message">${escapeHtml(inq.message)}</td>
          <td data-label="Date (UTC)" class="col-right nowrap text-muted">${escapeHtml(inq.created_at)}</td>
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
      .map((l) => {
        const detailsText =
          typeof l.details_json === 'string'
            ? l.details_json
            : l.details_json && typeof l.details_json === 'object'
              ? JSON.stringify(l.details_json)
              : '';
        return `
        <tr>
          <td class="num">#${l.id}</td>
          <td><span class="badge-activity-type">${escapeHtml(l.action)}</span></td>
          <td>${escapeHtml(l.admin_email || 'system')}</td>
          <td>${escapeHtml([l.target_type, l.target_id].filter(Boolean).join(' #'))}</td>
          <td class="mono-ref">${escapeHtml(detailsText)}</td>
          <td class="num">${escapeHtml(l.ip_address || '')}</td>
          <td class="col-right nowrap text-muted">${escapeHtml(l.created_at)}</td>
        </tr>`;
      })
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
  }

  function updateQrPreview(url) {
    const cleaned = String(url || '').trim();
    const wrap = document.getElementById('admin-crypto-qr-preview');
    const img = document.getElementById('admin-crypto-qr-img');
    const clearBtn = document.getElementById('admin-crypto-qr-clear-btn');
    if (!wrap || !img) return;
    if (cleaned) {
      img.src = resolvePreviewSrc(cleaned);
      wrap.classList.remove('is-hidden');
      clearBtn?.classList.remove('is-hidden');
    } else {
      img.src = '';
      wrap.classList.add('is-hidden');
      clearBtn?.classList.add('is-hidden');
    }
  }

  function renderCryptoMethods() {
    const tbody = document.getElementById('admin-crypto-methods-body');
    if (!tbody) return;
    if (state.cryptoMethods.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-center text-muted">No manual cryptocurrency options configured yet. Add one above to enable manual crypto checkout.</td></tr>';
      return;
    }

    tbody.innerHTML = state.cryptoMethods
      .map(
        (m) => `
        <tr>
          <td data-label="Currency"><strong>${escapeHtml(m.name)}</strong> <span class="badge-activity-type">${escapeHtml(m.symbol)}</span></td>
          <td data-label="Network">${escapeHtml(m.network)}</td>
          <td data-label="Wallet Address" class="mono-ref">${escapeHtml(m.wallet_address)}</td>
          <td data-label="QR Code" class="col-center">${m.qr_code_url ? '<img src="' + escapeHtml(resolvePreviewSrc(m.qr_code_url)) + '" alt="QR" class="admin-crypto-table-qr" />' : '<span class="text-muted">None</span>'}</td>
          <td data-label="Status"><span class="admin-status-badge ${m.active ? 'badge-active' : 'badge-inactive'}">${m.active ? 'Active' : 'Disabled'}</span></td>
          <td data-label="Actions" class="col-center admin-action-cell">
            <button type="button" class="btn btn-compact js-edit-crypto" data-id="${m.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-compact js-del-crypto" data-id="${m.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.js-edit-crypto').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = state.cryptoMethods.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (!m) return;
        document.getElementById('admin-crypto-edit-id').value = String(m.id);
        document.getElementById('admin-crypto-name').value = m.name || '';
        document.getElementById('admin-crypto-symbol').value = m.symbol || '';
        document.getElementById('admin-crypto-network').value = m.network || '';
        document.getElementById('admin-crypto-sort').value = String(m.sort_order ?? 0);
        document.getElementById('admin-crypto-wallet').value = m.wallet_address || '';
        document.getElementById('admin-crypto-qr-url').value = m.qr_code_url || '';
        document.getElementById('admin-crypto-instructions').value = m.instructions || '';
        document.getElementById('admin-crypto-active').checked = Boolean(m.active);
        state.newlyUploadedQrUrl = '';
        updateQrPreview(m.qr_code_url || '');
        document.getElementById('admin-crypto-form-heading').textContent =
          'Edit Cryptocurrency Option: ' + m.name + ' (' + m.symbol + ')';
        document.getElementById('admin-crypto-cancel-btn').classList.remove('is-hidden');
        document
          .getElementById('admin-crypto-form-heading')
          .scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    tbody.querySelectorAll('.js-del-crypto').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.armed !== 'true') {
          btn.dataset.armed = 'true';
          btn.textContent = 'Confirm?';
          setTimeout(() => {
            if (btn.isConnected && btn.dataset.armed === 'true') {
              btn.dataset.armed = 'false';
              btn.textContent = 'Delete';
            }
          }, 4000);
          return;
        }
        try {
          await api('/api/admin/crypto-methods/' + btn.getAttribute('data-id'), {
            method: 'DELETE',
          });
          showMessage('admin-crypto-msg', 'Cryptocurrency payment option deleted.', false);
          await refreshAll();
        } catch (err) {
          showMessage('admin-crypto-msg', err.message, true);
        }
      });
    });
  }

  async function refreshAll() {
    const [dash, cats, sels, prods, cryptos, ords, pays, inqs, logs, sets] = await Promise.all([
      api('/api/admin/dashboard'),
      api('/api/admin/categories'),
      api('/api/admin/sellers'),
      api('/api/admin/products'),
      api('/api/admin/crypto-methods'),
      api('/api/admin/orders'),
      api('/api/admin/payments'),
      api('/api/admin/inquiries'),
      api('/api/admin/audit-logs'),
      api('/api/admin/settings'),
    ]);

    state.categories = cats.categories || [];
    state.sellers = sels.sellers || [];
    state.products = prods.products || [];
    state.cryptoMethods = cryptos.cryptoMethods || [];
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
    renderCryptoMethods();
    renderOrders();
    renderPayments();
    renderInquiries();
    renderAuditLogs();
  }

  function bindForms() {
    // Initialize dynamic product gallery + spec/attribute rows
    renderProductGallery();
    setKeyValueRows('admin-prod-specs-list', {}, 'Specification (e.g. Brand, Interface)', 'Value');
    setKeyValueRows('admin-prod-attrs-list', {}, 'Attribute (e.g. Color, Region, SKU)', 'Value');

    document.getElementById('admin-add-spec-btn')?.addEventListener('click', () => {
      appendKeyValueRow('admin-prod-specs-list', '', '', 'Specification (e.g. Brand, Interface)', 'Value');
    });
    document.getElementById('admin-add-attr-btn')?.addEventListener('click', () => {
      appendKeyValueRow('admin-prod-attrs-list', '', '', 'Attribute (e.g. Color, Region, SKU)', 'Value');
    });

    // Multi-image uploader
    const fileInput = document.getElementById('admin-prod-image-files');
    const uploadBtn = document.getElementById('admin-prod-upload-btn');
    const replaceInput = document.getElementById('admin-prod-replace-file');

    const handleUploadSelection = async () => {
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showMessage('admin-prod-upload-status', 'Select one or more JPG, PNG, or WebP images first.', true);
        return;
      }
      if (state.productGallery.length + fileInput.files.length > MAX_PRODUCT_IMAGES) {
        showMessage(
          'admin-prod-upload-status',
          'A product can have at most ' + MAX_PRODUCT_IMAGES + ' images.',
          true
        );
        return;
      }

      if (uploadBtn) uploadBtn.disabled = true;
      showMessage('admin-prod-upload-status', 'Uploading images to persistent server storage...', false);
      try {
        const uploaded = await uploadImageFiles(fileInput.files);
        uploaded.forEach((item) => {
          state.productGallery.push({
            src: item.src,
            caption: item.caption || document.getElementById('admin-prod-name')?.value || 'Product photo',
            newlyUploaded: true,
          });
        });
        fileInput.value = '';
        renderProductGallery();
        showMessage(
          'admin-prod-upload-status',
          uploaded.length + ' image(s) uploaded and saved to persistent storage.',
          false
        );
      } catch (err) {
        showMessage('admin-prod-upload-status', err.message, true);
      } finally {
        if (uploadBtn) uploadBtn.disabled = false;
      }
    };

    uploadBtn?.addEventListener('click', handleUploadSelection);
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleUploadSelection();
      }
    });

    replaceInput?.addEventListener('change', async () => {
      const idx = state.replacingGalleryIndex;
      state.replacingGalleryIndex = -1;
      if (idx < 0 || idx >= state.productGallery.length) return;
      if (!replaceInput.files || replaceInput.files.length === 0) return;

      showMessage('admin-prod-upload-status', 'Uploading replacement image...', false);
      try {
        const uploaded = await uploadImageFiles([replaceInput.files[0]]);
        if (uploaded.length > 0) {
          const prev = state.productGallery[idx];
          state.productGallery[idx] = {
            src: uploaded[0].src,
            caption: prev.caption || uploaded[0].caption || 'Product photo',
            newlyUploaded: true,
          };
          renderProductGallery();
          showMessage('admin-prod-upload-status', 'Image replaced successfully.', false);

          if (prev.newlyUploaded) {
            deleteUnsavedStorageUrl(prev.src);
          }
        }
      } catch (err) {
        showMessage('admin-prod-upload-status', err.message, true);
      } finally {
        replaceInput.value = '';
      }
    });

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
        phone: document.getElementById('admin-seller-phone').value,
        whatsapp: document.getElementById('admin-seller-whatsapp').value,
        telegram: document.getElementById('admin-seller-telegram').value,
        otherContactUrl: document.getElementById('admin-seller-other-url').value,
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
      document.getElementById('admin-prod-availability').value = '';
      document.getElementById('admin-prod-condition').value = 'Used - Tested';
      document.getElementById('admin-prod-shipping').value = '0.00';
      document.getElementById('admin-prod-shipping-method').value = 'Standard Ground Shipping';
      document.getElementById('admin-prod-shipping-handling').value = 'Ships within 2 business days';
      document.getElementById('admin-prod-shipping-from').value = '';
      document.getElementById('admin-prod-return-policy').value = '14-day return policy';
      document.getElementById('admin-prod-instock').checked = true;
      document.getElementById('admin-prod-digital').checked = false;
      document.getElementById('admin-prod-featured').checked = false;
      state.productGallery = [];
      renderProductGallery();
      showMessage('admin-prod-upload-status', '', false);
      setKeyValueRows('admin-prod-specs-list', {}, 'Specification (e.g. Brand, Interface)', 'Value');
      setKeyValueRows('admin-prod-attrs-list', {}, 'Attribute (e.g. Color, Region, SKU)', 'Value');
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
        availability: document.getElementById('admin-prod-availability').value,
        condition: document.getElementById('admin-prod-condition').value,
        shippingCost: document.getElementById('admin-prod-shipping').value,
        shippingMethod: document.getElementById('admin-prod-shipping-method').value,
        shippingHandling: document.getElementById('admin-prod-shipping-handling').value,
        shippingFrom: document.getElementById('admin-prod-shipping-from').value,
        returnPolicy: document.getElementById('admin-prod-return-policy').value,
        inStock: document.getElementById('admin-prod-instock').checked,
        isDigital: document.getElementById('admin-prod-digital').checked,
        featured: document.getElementById('admin-prod-featured').checked,
        description: document.getElementById('admin-prod-description').value,
        images: state.productGallery.map((g) => ({ src: g.src, caption: g.caption })),
        specs: collectKeyValueRows('admin-prod-specs-list'),
        customAttributes: collectKeyValueRows('admin-prod-attrs-list'),
        sellerContact: {
          contactName: document.getElementById('admin-prod-contact-name').value,
          email: document.getElementById('admin-prod-contact-email').value,
          whatsapp: document.getElementById('admin-prod-contact-whatsapp').value,
          telegram: document.getElementById('admin-prod-contact-telegram').value,
          phone: document.getElementById('admin-prod-contact-phone').value,
          otherLabel: document.getElementById('admin-prod-contact-other-label').value,
          otherUrl: document.getElementById('admin-prod-contact-other-url').value,
          notes: document.getElementById('admin-prod-contact-notes').value,
        },
      };

      try {
        if (editId) {
          await api('/api/admin/products/' + editId, { method: 'PUT', body: payload });
          showMessage('admin-product-msg', 'Product updated and published to the public marketplace.', false);
        } else {
          await api('/api/admin/products', { method: 'POST', body: payload });
          showMessage('admin-product-msg', 'Product created and published to the public marketplace.', false);
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
          },
        });
        showMessage('admin-settings-msg', 'Website settings saved to Supabase.', false);
        await refreshAll();
      } catch (err) {
        showMessage('admin-settings-msg', err.message, true);
      }
    });

    // Manual Cryptocurrency Payment Methods form & QR uploader
    const cryptoForm = document.getElementById('admin-crypto-form');
    const cryptoCancel = document.getElementById('admin-crypto-cancel-btn');
    const qrFileInput = document.getElementById('admin-crypto-qr-file');
    const qrUploadBtn = document.getElementById('admin-crypto-qr-upload-btn');
    const qrClearBtn = document.getElementById('admin-crypto-qr-clear-btn');
    const qrUrlInput = document.getElementById('admin-crypto-qr-url');

    const resetCryptoForm = () => {
      if (state.newlyUploadedQrUrl) {
        deleteUnsavedStorageUrl(state.newlyUploadedQrUrl);
        state.newlyUploadedQrUrl = '';
      }
      cryptoForm?.reset();
      document.getElementById('admin-crypto-edit-id').value = '';
      document.getElementById('admin-crypto-sort').value = '0';
      document.getElementById('admin-crypto-active').checked = true;
      document.getElementById('admin-crypto-form-heading').textContent =
        'Add Manual Cryptocurrency Payment Option';
      cryptoCancel?.classList.add('is-hidden');
      updateQrPreview('');
      showMessage('admin-crypto-qr-status', '', false);
    };

    cryptoCancel?.addEventListener('click', resetCryptoForm);

    qrUrlInput?.addEventListener('input', () => {
      updateQrPreview(qrUrlInput.value);
    });

    qrClearBtn?.addEventListener('click', () => {
      if (state.newlyUploadedQrUrl && qrUrlInput.value.trim() === state.newlyUploadedQrUrl) {
        deleteUnsavedStorageUrl(state.newlyUploadedQrUrl);
        state.newlyUploadedQrUrl = '';
      }
      qrUrlInput.value = '';
      updateQrPreview('');
      showMessage('admin-crypto-qr-status', 'QR code cleared.', false);
    });

    const handleQrUpload = async () => {
      if (!qrFileInput || !qrFileInput.files || qrFileInput.files.length === 0) {
        showMessage('admin-crypto-qr-status', 'Select a JPG, PNG, or WebP QR code image first.', true);
        return;
      }
      if (qrUploadBtn) qrUploadBtn.disabled = true;
      showMessage('admin-crypto-qr-status', 'Uploading QR code to Supabase Storage...', false);
      try {
        const uploaded = await uploadImageFiles([qrFileInput.files[0]], 'crypto-qr');
        if (uploaded.length > 0) {
          if (state.newlyUploadedQrUrl) {
            deleteUnsavedStorageUrl(state.newlyUploadedQrUrl);
          }
          state.newlyUploadedQrUrl = uploaded[0].src;
          qrUrlInput.value = uploaded[0].src;
          qrFileInput.value = '';
          updateQrPreview(uploaded[0].src);
          showMessage('admin-crypto-qr-status', 'QR code uploaded to Supabase Storage.', false);
        }
      } catch (err) {
        showMessage('admin-crypto-qr-status', err.message, true);
      } finally {
        if (qrUploadBtn) qrUploadBtn.disabled = false;
      }
    };

    qrUploadBtn?.addEventListener('click', handleQrUpload);
    qrFileInput?.addEventListener('change', () => {
      if (qrFileInput.files && qrFileInput.files.length > 0) {
        handleQrUpload();
      }
    });

    cryptoForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('admin-crypto-edit-id').value;
      const payload = {
        name: document.getElementById('admin-crypto-name').value,
        symbol: document.getElementById('admin-crypto-symbol').value,
        network: document.getElementById('admin-crypto-network').value,
        sortOrder: document.getElementById('admin-crypto-sort').value,
        walletAddress: document.getElementById('admin-crypto-wallet').value,
        qrCodeUrl: document.getElementById('admin-crypto-qr-url').value,
        instructions: document.getElementById('admin-crypto-instructions').value,
        active: document.getElementById('admin-crypto-active').checked,
      };
      try {
        if (editId) {
          await api('/api/admin/crypto-methods/' + editId, { method: 'PUT', body: payload });
          showMessage('admin-crypto-msg', 'Cryptocurrency payment option updated.', false);
        } else {
          await api('/api/admin/crypto-methods', { method: 'POST', body: payload });
          showMessage('admin-crypto-msg', 'Cryptocurrency payment option added.', false);
        }
        state.newlyUploadedQrUrl = '';
        resetCryptoForm();
        await refreshAll();
      } catch (err) {
        showMessage('admin-crypto-msg', err.message, true);
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

    const adminNav = document.querySelector('.main-nav');
    const adminNavToggle = adminNav?.querySelector('.nav-toggle-btn');
    const setAdminNavOpen = (isOpen) => {
      if (!adminNav || !adminNavToggle) return;
      adminNav.classList.toggle('is-open', isOpen);
      adminNavToggle.setAttribute('aria-expanded', String(isOpen));
    };

    adminNavToggle?.addEventListener('click', () => {
      setAdminNavOpen(!adminNav.classList.contains('is-open'));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && adminNav?.classList.contains('is-open')) {
        setAdminNavOpen(false);
      }
    });

    document.querySelectorAll('.js-admin-tab').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        activateTab(el.getAttribute('data-admin-tab'));
        if (el.closest('.main-nav')) {
          setAdminNavOpen(false);
        }
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

    const seedBtn = document.getElementById('admin-seed-catalog-btn');
    seedBtn?.addEventListener('click', async () => {
      seedBtn.disabled = true;
      showMessage('admin-product-msg', 'Populating starter categories, sellers, and products...', false);
      try {
        const res = await api('/api/admin/catalog/seed', { method: 'POST' });
        showMessage(
          'admin-product-msg',
          'Catalog populated: ' +
            (res.categoriesInserted || 0) +
            ' categories, ' +
            (res.sellersInserted || 0) +
            ' sellers, ' +
            (res.productsInserted || 0) +
            ' products added.',
          false
        );
        await refreshAll();
      } catch (err) {
        showMessage('admin-product-msg', err.message, true);
      } finally {
        seedBtn.disabled = false;
      }
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

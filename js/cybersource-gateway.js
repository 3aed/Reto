/* ==========================================================================
   RetroMarket — Purchase-Only CyberSource "Payment Details" Gateway Modal
   Hidden by default and mounted/opened ONLY when a customer actively
   initiates card payment during checkout or on payment.html.
   Strictly adheres to CSP (script-src 'self', style-src 'self'):
   - Zero inline scripts or onclick attributes
   - Zero inline style attributes
   - Never transmits or stores raw card numbers or CVN on RetroMarket servers
   ========================================================================== */

(() => {
  'use strict';

  const BRAND_LABELS = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    discover: 'Discover',
  };

  let overlayEl = null;
  let activeContext = null;

  function detectCardBrand(digits) {
    if (!digits) return null;
    if (/^4/.test(digits)) return 'visa';
    if (/^(34|37)/.test(digits)) return 'amex';
    if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(digits)) {
      return 'mastercard';
    }
    if (/^5/.test(digits)) return 'mastercard';
    if (/^(6011|65|64[4-9]|622)/.test(digits) || /^6/.test(digits)) {
      return 'discover';
    }
    return null;
  }

  function formatCardNumber(digits, brand) {
    const maxLen = brand === 'amex' ? 15 : 16;
    const trimmed = digits.slice(0, maxLen);
    if (brand === 'amex') {
      const p1 = trimmed.slice(0, 4);
      const p2 = trimmed.slice(4, 10);
      const p3 = trimmed.slice(10, 15);
      return [p1, p2, p3].filter(Boolean).join(' ');
    }
    return trimmed.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  function passesLuhn(digits) {
    if (!/^\d{13,19}$/.test(digits)) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let n = parseInt(digits.charAt(i), 10);
      if (shouldDouble) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function maskCardNumber(digits, brand) {
    const last4 = digits.slice(-4);
    if (brand === 'amex') {
      return '•••• •••••• •' + last4;
    }
    return '•••• •••• •••• ' + last4;
  }

  function buildMonthOptions() {
    let html = '<option value="">Month</option>';
    for (let m = 1; m <= 12; m += 1) {
      const val = String(m).padStart(2, '0');
      html += '<option value="' + val + '">' + val + '</option>';
    }
    return html;
  }

  function buildYearOptions() {
    const currentYear = Math.max(new Date().getFullYear(), 2026);
    let html = '<option value="">Year</option>';
    for (let i = 0; i <= 12; i += 1) {
      const yr = String(currentYear + i);
      html += '<option value="' + yr + '">' + yr + '</option>';
    }
    return html;
  }

  function buildModalMarkup() {
    return `
      <div class="cs-gw-card" role="dialog" aria-modal="true" aria-labelledby="cs-gw-heading">
        <div class="cs-gw-header">
          <h2 id="cs-gw-heading" class="cs-gw-title">Payment Details</h2>
          <span class="cs-gw-padlock" aria-hidden="true" title="Secure Payment">
            <svg width="16" height="19" viewBox="0 0 16 19" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.5 8V5.5C4.5 3.567 6.067 2 8 2C9.933 2 11.5 3.567 11.5 5.5V8" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round"/>
              <rect x="2" y="7.5" width="12" height="9.5" rx="1.5" fill="#F2C21A" stroke="#C7960C" stroke-width="1"/>
              <circle cx="8" cy="11.5" r="1.2" fill="#7A5B04"/>
              <path d="M8 12.2V14.4" stroke="#7A5B04" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </span>
        </div>

        <div class="cs-gw-meta-row">
          <span id="cs-gw-order-context" class="cs-gw-order-context"></span>
          <span class="cs-gw-required-note">* Required field</span>
        </div>

        <!-- Primary Payment Details Form View -->
        <form id="cs-gw-form" novalidate>
          <!-- 1. Card Type -->
          <div class="cs-gw-field">
            <span class="cs-gw-label">Card Type <span class="cs-gw-req">*</span></span>
            <div class="cs-gw-card-grid" role="radiogroup" aria-label="Card Type">
              <label class="cs-gw-card-option">
                <input type="radio" name="cs_card_type" value="visa" />
                <span class="cs-gw-badge" aria-hidden="true">
                  <svg width="38" height="22" viewBox="0 0 38 22" xmlns="http://www.w3.org/2000/svg">
                    <rect width="38" height="22" fill="#FFFFFF"/>
                    <path d="M5.5 7.4L8.2 7.4L9.2 12.6L11.1 7.4H13.3L9.9 15.2H7.7L5.8 8.7C5.3 8.3 4.5 8 3.9 7.8L4.1 7.4H5.5Z" fill="#1A1F71"/>
                    <path d="M4.1 7.4H6.5L5.7 9.1C5.1 8.5 4.4 8 3.9 7.8L4.1 7.4Z" fill="#F7B600"/>
                    <polygon points="14.5,7.4 16.6,7.4 15.2,15.2 13.1,15.2" fill="#1A1F71"/>
                    <path d="M22.2 7.6C21.6 7.4 20.8 7.2 19.9 7.2C17.9 7.2 16.5 8.2 16.5 9.7C16.5 10.8 17.5 11.4 18.3 11.8C19.1 12.2 19.4 12.4 19.4 12.8C19.4 13.3 18.8 13.6 18.1 13.6C17.2 13.6 16.6 13.4 15.9 13.1L15.6 14.8C16.3 15.1 17.2 15.3 18.1 15.3C20.2 15.3 21.6 14.3 21.6 12.7C21.6 11.7 20.9 11 19.7 10.4C19 10.1 18.6 9.8 18.6 9.5C18.6 9.1 19 8.8 19.8 8.8C20.5 8.8 21.1 8.9 21.6 9.1L22.2 7.6Z" fill="#1A1F71"/>
                    <path d="M26.9 7.4H25.2C24.7 7.4 24.3 7.6 24.1 8.1L21.3 15.2H23.5L24 13.9H26.6L26.8 15.2H28.8L26.9 7.4ZM24.6 12.3L25.7 9.4L26.3 12.3H24.6Z" fill="#1A1F71"/>
                  </svg>
                </span>
                <span class="cs-gw-brand-text">Visa</span>
              </label>

              <label class="cs-gw-card-option">
                <input type="radio" name="cs_card_type" value="mastercard" />
                <span class="cs-gw-badge" aria-hidden="true">
                  <svg width="38" height="22" viewBox="0 0 38 22" xmlns="http://www.w3.org/2000/svg">
                    <rect width="38" height="22" fill="#FFFFFF"/>
                    <circle cx="15" cy="9.5" r="6.2" fill="#EB001B"/>
                    <circle cx="23" cy="9.5" r="6.2" fill="#F79E1B"/>
                    <path d="M19 4.6C20.4 5.7 21.2 7.5 21.2 9.5C21.2 11.5 20.4 13.3 19 14.4C17.6 13.3 16.8 11.5 16.8 9.5C16.8 7.5 17.6 5.7 19 4.6Z" fill="#FF5F00"/>
                    <text x="19" y="20.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="4.4" font-weight="700" fill="#333333">mastercard</text>
                  </svg>
                </span>
                <span class="cs-gw-brand-text">Mastercard</span>
              </label>

              <label class="cs-gw-card-option">
                <input type="radio" name="cs_card_type" value="amex" />
                <span class="cs-gw-badge cs-gw-badge-amex" aria-hidden="true">
                  <svg width="42" height="26" viewBox="0 0 42 26" xmlns="http://www.w3.org/2000/svg">
                    <rect width="42" height="26" fill="#016FD0"/>
                    <rect x="2" y="2" width="38" height="22" fill="none" stroke="#62B2F5" stroke-width="0.7"/>
                    <text x="21" y="16" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9.5" font-weight="700" letter-spacing="0.4" fill="#FFFFFF">AMEX</text>
                  </svg>
                </span>
                <span class="cs-gw-brand-text">Amex</span>
              </label>

              <label class="cs-gw-card-option">
                <input type="radio" name="cs_card_type" value="discover" />
                <span class="cs-gw-badge" aria-hidden="true">
                  <svg width="38" height="22" viewBox="0 0 38 22" xmlns="http://www.w3.org/2000/svg">
                    <rect width="38" height="22" fill="#FFFFFF"/>
                    <path d="M16 22C25 21 33 17.5 38 12.5V22H16Z" fill="#F47216"/>
                    <text x="19" y="12.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6.1" font-weight="700" letter-spacing="0.1" fill="#231F20">DISCOVER</text>
                    <circle cx="21.9" cy="10.1" r="2.2" fill="#F47216"/>
                  </svg>
                </span>
                <span class="cs-gw-brand-text">Discover</span>
              </label>
            </div>
            <div id="cs-gw-err-brand" class="cs-gw-error" role="alert"></div>
          </div>

          <!-- 2. Card Number -->
          <div class="cs-gw-field">
            <label for="cs-gw-card-number" class="cs-gw-label">Card Number <span class="cs-gw-req">*</span></label>
            <input
              id="cs-gw-card-number"
              name="cs_card_number"
              type="text"
              inputmode="numeric"
              autocomplete="cc-number"
              maxlength="19"
              class="cs-gw-input cs-gw-input-card"
            />
            <div id="cs-gw-err-number" class="cs-gw-error" role="alert"></div>
          </div>

          <!-- 3. Expiration Month & Year -->
          <div class="cs-gw-exp-row">
            <div class="cs-gw-exp-col">
              <label for="cs-gw-exp-month" class="cs-gw-label">Expiration Month <span class="cs-gw-req">*</span></label>
              <select id="cs-gw-exp-month" name="cs_exp_month" autocomplete="cc-exp-month" class="cs-gw-select cs-gw-select-exp">
                ${buildMonthOptions()}
              </select>
              <div id="cs-gw-err-month" class="cs-gw-error" role="alert"></div>
            </div>
            <div class="cs-gw-exp-col">
              <label for="cs-gw-exp-year" class="cs-gw-label">Expiration Year <span class="cs-gw-req">*</span></label>
              <select id="cs-gw-exp-year" name="cs_exp_year" autocomplete="cc-exp-year" class="cs-gw-select cs-gw-select-exp">
                ${buildYearOptions()}
              </select>
              <div id="cs-gw-err-year" class="cs-gw-error" role="alert"></div>
            </div>
          </div>

          <!-- 4. CVN -->
          <div class="cs-gw-field">
            <label for="cs-gw-cvn" class="cs-gw-label">CVN <span class="cs-gw-req">*</span></label>
            <p class="cs-gw-cvn-help">This code is a three or four digit number printed on the back or front of credit cards.</p>
            <div class="cs-gw-cvn-row">
              <input
                id="cs-gw-cvn"
                name="cs_cvn"
                type="text"
                inputmode="numeric"
                autocomplete="cc-csc"
                maxlength="4"
                class="cs-gw-input cs-gw-input-cvn"
              />
              <span class="cs-gw-cvn-diagram" aria-hidden="true">
                <svg width="64" height="36" viewBox="0 0 64 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <!-- Card back -->
                  <rect x="2" y="4" width="44" height="27" rx="2.5" fill="#E5E7EB" stroke="#9CA3AF" stroke-width="1"/>
                  <!-- Magnetic stripe -->
                  <rect x="2.5" y="8" width="43" height="5" fill="#374151"/>
                  <!-- Signature strip -->
                  <rect x="6" y="16" width="24" height="6" fill="#FFFFFF" stroke="#D1D5DB" stroke-width="0.7"/>
                  <line x1="8" y1="19" x2="21" y2="19" stroke="#9CA3AF" stroke-width="1"/>
                  <line x1="8" y1="20.8" x2="17" y2="20.8" stroke="#D1D5DB" stroke-width="0.8"/>
                  <!-- Magnifying glass handle -->
                  <line x1="47.5" y1="25.5" x2="56.5" y2="32.5" stroke="#4B5563" stroke-width="3.2" stroke-linecap="round"/>
                  <line x1="47.5" y1="25.5" x2="56.5" y2="32.5" stroke="#1F2937" stroke-width="1.6" stroke-linecap="round"/>
                  <!-- Magnifying glass lens -->
                  <circle cx="40" cy="19" r="11" fill="#FFFFFF" stroke="#6B7280" stroke-width="2"/>
                  <circle cx="40" cy="19" r="9.4" fill="#F9FAFB" stroke="#D1D5DB" stroke-width="0.6"/>
                  <!-- Green highlighted CVN digits -->
                  <text id="cs-gw-cvn-svg-text" x="40" y="22.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9.5" font-weight="700" fill="#2E8B3C">123</text>
                </svg>
              </span>
            </div>
            <div id="cs-gw-err-cvn" class="cs-gw-error" role="alert"></div>
          </div>

          <!-- 5. Action Area -->
          <div class="cs-gw-actions">
            <button type="submit" class="cs-gw-next-btn">Next</button>
          </div>

          <!-- 6. Footer -->
          <div class="cs-gw-footer">
            <button type="button" id="cs-gw-cancel-btn" class="cs-gw-cancel-link">Cancel Order</button>
          </div>
        </form>

        <!-- Clean Confirmation View after Valid Submission -->
        <div id="cs-gw-confirm-view" class="cs-gw-view-hidden">
          <div class="cs-gw-confirm-banner">
            <strong>Card Details Validated</strong>
            Your payment card details passed format verification for this order.
          </div>

          <table class="cs-gw-confirm-table">
            <tbody>
              <tr>
                <th scope="row">Order Reference</th>
                <td id="cs-gw-cf-order">&mdash;</td>
              </tr>
              <tr>
                <th scope="row">Amount</th>
                <td id="cs-gw-cf-amount">&mdash;</td>
              </tr>
              <tr>
                <th scope="row">Card Type</th>
                <td id="cs-gw-cf-brand">&mdash;</td>
              </tr>
              <tr>
                <th scope="row">Card Number</th>
                <td id="cs-gw-cf-masked">&mdash;</td>
              </tr>
              <tr>
                <th scope="row">Expiration</th>
                <td id="cs-gw-cf-exp">&mdash;</td>
              </tr>
            </tbody>
          </table>

          <div class="cs-gw-confirm-note">
            <strong>Security Notice:</strong> Raw card numbers and CVN codes are never transmitted to or stored on RetroMarket servers. Live card settlement occurs exclusively once CyberSource merchant credentials are configured on the server.
          </div>

          <div class="cs-gw-confirm-actions">
            <button type="button" id="cs-gw-back-btn" class="cs-gw-secondary-btn">Edit Details</button>
            <button type="button" id="cs-gw-done-btn" class="cs-gw-next-btn">Done</button>
          </div>

          <div class="cs-gw-footer">
            <button type="button" id="cs-gw-cancel-confirm-btn" class="cs-gw-cancel-link">Cancel Order</button>
          </div>
        </div>
      </div>
    `;
  }

  function ensureMounted() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'rm-cybersource-gateway-overlay';
    overlayEl.className = 'rm-gateway-overlay';
    overlayEl.innerHTML = buildModalMarkup();
    document.body.appendChild(overlayEl);
    bindEvents();
    return overlayEl;
  }

  function getSelectedBrand() {
    if (!overlayEl) return '';
    const checked = overlayEl.querySelector('input[name="cs_card_type"]:checked');
    return checked ? checked.value : '';
  }

  function setSelectedBrand(brand) {
    if (!overlayEl) return;
    overlayEl.querySelectorAll('input[name="cs_card_type"]').forEach((radio) => {
      radio.checked = radio.value === brand;
    });
    updateCvnForBrand(brand);
  }

  function updateCvnForBrand(brand) {
    if (!overlayEl) return;
    const cvnInput = overlayEl.querySelector('#cs-gw-cvn');
    const cvnSvgText = overlayEl.querySelector('#cs-gw-cvn-svg-text');
    const isAmex = brand === 'amex';
    if (cvnInput) {
      cvnInput.maxLength = isAmex ? 4 : 3;
      if (!isAmex && cvnInput.value.length > 3) {
        cvnInput.value = cvnInput.value.slice(0, 3);
      }
    }
    if (cvnSvgText) {
      cvnSvgText.textContent = isAmex ? '1234' : '123';
    }
  }

  function setFieldError(errId, inputEl, message) {
    if (!overlayEl) return;
    const errEl = overlayEl.querySelector('#' + errId);
    if (errEl) {
      errEl.textContent = message || '';
      errEl.classList.toggle('is-visible', Boolean(message));
    }
    if (inputEl) {
      inputEl.classList.toggle('is-invalid', Boolean(message));
    }
  }

  function clearAllErrors() {
    if (!overlayEl) return;
    setFieldError('cs-gw-err-brand', null, '');
    setFieldError('cs-gw-err-number', overlayEl.querySelector('#cs-gw-card-number'), '');
    setFieldError('cs-gw-err-month', overlayEl.querySelector('#cs-gw-exp-month'), '');
    setFieldError('cs-gw-err-year', overlayEl.querySelector('#cs-gw-exp-year'), '');
    setFieldError('cs-gw-err-cvn', overlayEl.querySelector('#cs-gw-cvn'), '');
  }

  function resetFormState() {
    if (!overlayEl) return;
    const form = overlayEl.querySelector('#cs-gw-form');
    const confirmView = overlayEl.querySelector('#cs-gw-confirm-view');
    if (form) {
      form.reset();
      form.classList.remove('cs-gw-view-hidden');
    }
    if (confirmView) {
      confirmView.classList.add('cs-gw-view-hidden');
    }
    updateCvnForBrand('');
    clearAllErrors();
  }

  function bindEvents() {
    const form = overlayEl.querySelector('#cs-gw-form');
    const confirmView = overlayEl.querySelector('#cs-gw-confirm-view');
    const cardInput = overlayEl.querySelector('#cs-gw-card-number');
    const monthSelect = overlayEl.querySelector('#cs-gw-exp-month');
    const yearSelect = overlayEl.querySelector('#cs-gw-exp-year');
    const cvnInput = overlayEl.querySelector('#cs-gw-cvn');
    const cancelBtn = overlayEl.querySelector('#cs-gw-cancel-btn');
    const cancelConfirmBtn = overlayEl.querySelector('#cs-gw-cancel-confirm-btn');
    const backBtn = overlayEl.querySelector('#cs-gw-back-btn');
    const doneBtn = overlayEl.querySelector('#cs-gw-done-btn');

    overlayEl.querySelectorAll('input[name="cs_card_type"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const brand = radio.value;
        updateCvnForBrand(brand);
        setFieldError('cs-gw-err-brand', null, '');
        if (cardInput && cardInput.value) {
          const digits = cardInput.value.replace(/\D/g, '');
          cardInput.value = formatCardNumber(digits, brand);
        }
      });
    });

    cardInput.addEventListener('input', () => {
      const digits = cardInput.value.replace(/\D/g, '');
      const detected = detectCardBrand(digits);
      if (detected) {
        setSelectedBrand(detected);
        setFieldError('cs-gw-err-brand', null, '');
      }
      const activeBrand = detected || getSelectedBrand();
      cardInput.value = formatCardNumber(digits, activeBrand);
      setFieldError('cs-gw-err-number', cardInput, '');
    });

    monthSelect.addEventListener('change', () => {
      setFieldError('cs-gw-err-month', monthSelect, '');
    });

    yearSelect.addEventListener('change', () => {
      setFieldError('cs-gw-err-year', yearSelect, '');
    });

    cvnInput.addEventListener('input', () => {
      const brand = getSelectedBrand();
      const maxLen = brand === 'amex' ? 4 : 3;
      cvnInput.value = cvnInput.value.replace(/\D/g, '').slice(0, maxLen);
      setFieldError('cs-gw-err-cvn', cvnInput, '');
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearAllErrors();

      let valid = true;
      const brand = getSelectedBrand();
      const rawDigits = cardInput.value.replace(/\D/g, '');
      const expMonth = monthSelect.value;
      const expYear = yearSelect.value;
      const cvn = cvnInput.value.replace(/\D/g, '');

      if (!brand) {
        setFieldError('cs-gw-err-brand', null, 'Please select a card type.');
        valid = false;
      }

      const expectedCardLen = brand === 'amex' ? 15 : 16;
      if (!rawDigits) {
        setFieldError('cs-gw-err-number', cardInput, 'Card number is required.');
        valid = false;
      } else if (rawDigits.length !== expectedCardLen) {
        setFieldError(
          'cs-gw-err-number',
          cardInput,
          'Enter a valid ' + expectedCardLen + '-digit card number.'
        );
        valid = false;
      } else if (!passesLuhn(rawDigits)) {
        setFieldError('cs-gw-err-number', cardInput, 'Card number is invalid. Please check digits.');
        valid = false;
      }

      if (!expMonth) {
        setFieldError('cs-gw-err-month', monthSelect, 'Select month.');
        valid = false;
      }
      if (!expYear) {
        setFieldError('cs-gw-err-year', yearSelect, 'Select year.');
        valid = false;
      }
      if (expMonth && expYear) {
        const now = new Date();
        const yrNum = parseInt(expYear, 10);
        const moNum = parseInt(expMonth, 10);
        if (yrNum < now.getFullYear() || (yrNum === now.getFullYear() && moNum < now.getMonth() + 1)) {
          setFieldError('cs-gw-err-year', yearSelect, 'Card has expired.');
          valid = false;
        }
      }

      const expectedCvnLen = brand === 'amex' ? 4 : 3;
      if (!cvn) {
        setFieldError('cs-gw-err-cvn', cvnInput, 'CVN is required.');
        valid = false;
      } else if (cvn.length !== expectedCvnLen) {
        setFieldError(
          'cs-gw-err-cvn',
          cvnInput,
          'Enter a ' + expectedCvnLen + '-digit security code.'
        );
        valid = false;
      }

      if (!valid) return;

      const masked = maskCardNumber(rawDigits, brand);
      const summary = {
        orderNumber: activeContext?.orderNumber || 'Pending Order',
        formattedAmount: activeContext?.formattedAmount || '$0.00 USD',
        brand: BRAND_LABELS[brand] || brand,
        maskedNumber: masked,
        expiration: expMonth + '/' + expYear,
      };

      overlayEl.querySelector('#cs-gw-cf-order').textContent = summary.orderNumber;
      overlayEl.querySelector('#cs-gw-cf-amount').textContent = summary.formattedAmount;
      overlayEl.querySelector('#cs-gw-cf-brand').textContent = summary.brand;
      overlayEl.querySelector('#cs-gw-cf-masked').textContent = summary.maskedNumber;
      overlayEl.querySelector('#cs-gw-cf-exp').textContent = summary.expiration;

      // Immediately clear sensitive inputs from DOM memory
      cardInput.value = '';
      cvnInput.value = '';

      form.classList.add('cs-gw-view-hidden');
      confirmView.classList.remove('cs-gw-view-hidden');

      if (typeof activeContext?.onComplete === 'function') {
        activeContext.onComplete(summary);
      }
    });

    function handleCancel() {
      const cb = activeContext?.onCancel;
      closeGateway();
      if (typeof cb === 'function') {
        cb();
      }
    }

    cancelBtn.addEventListener('click', handleCancel);
    cancelConfirmBtn.addEventListener('click', handleCancel);

    backBtn.addEventListener('click', () => {
      confirmView.classList.add('cs-gw-view-hidden');
      form.classList.remove('cs-gw-view-hidden');
      clearAllErrors();
      cardInput.focus();
    });

    doneBtn.addEventListener('click', () => {
      closeGateway();
    });

    overlayEl.addEventListener('click', (event) => {
      if (event.target === overlayEl) {
        handleCancel();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlayEl && overlayEl.classList.contains('is-open')) {
        handleCancel();
      }
    });
  }

  function openGateway(options = {}) {
    const el = ensureMounted();
    activeContext = {
      orderNumber: options.orderNumber || '',
      formattedAmount:
        options.formattedAmount ||
        (options.amount !== undefined
          ? '$' + Number(options.amount || 0).toFixed(2) + ' ' + (options.currency || 'USD')
          : ''),
      onComplete: options.onComplete || null,
      onCancel: options.onCancel || null,
    };

    resetFormState();

    const ctxEl = el.querySelector('#cs-gw-order-context');
    if (ctxEl) {
      const parts = [];
      if (activeContext.orderNumber) parts.push('Order ' + activeContext.orderNumber);
      if (activeContext.formattedAmount) parts.push(activeContext.formattedAmount);
      ctxEl.textContent = parts.join(' · ');
    }

    el.classList.add('is-open');
    const cardInput = el.querySelector('#cs-gw-card-number');
    if (cardInput) {
      cardInput.focus();
    }
  }

  function closeGateway() {
    if (!overlayEl) return;
    overlayEl.classList.remove('is-open');
    resetFormState();
    activeContext = null;
  }

  window.RetroMarketCyberSourceGateway = {
    open: openGateway,
    close: closeGateway,
  };
})();

/* ==========================================================================
   RetroMarket — Private Admin Login Client (Vanilla ES6)
   Authenticates administrators via server-side Supabase Auth proxy endpoints.
   ========================================================================== */

(() => {
  'use strict';

  const adminBase = document.body.getAttribute('data-admin-base') || '';

  function showBox(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.className = (isError ? 'error-box' : 'inline-message') + ' is-visible';
  }

  function initLogin() {
    const form = document.getElementById('admin-login-form');
    const msgEl = document.getElementById('admin-login-message');
    const submitBtn = document.getElementById('admin-signin-btn');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = (document.getElementById('admin-email')?.value || '').trim();
      const password = document.getElementById('admin-password')?.value || '';

      if (!email || !password) {
        showBox(msgEl, 'Please enter both your administrator email address and password.', true);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        const resp = await fetch('/api/admin/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          showBox(msgEl, data.error || 'Sign-in failed.', true);
          return;
        }
        window.location.href = adminBase + '/';
      } catch {
        showBox(msgEl, 'Network error while contacting authentication server.', true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
  });
})();

/* ==========================================================================
   RetroMarket — Private Admin Login & Password Recovery Client (Vanilla ES6)
   Communicates exclusively with server-side /api/admin/auth/* endpoints.
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

    const toggleForgotBtn = document.getElementById('toggle-forgot-password-btn');
    const forgotPanel = document.getElementById('admin-forgot-panel');
    if (toggleForgotBtn && forgotPanel) {
      toggleForgotBtn.addEventListener('click', () => {
        forgotPanel.classList.toggle('is-hidden');
      });
    }

    const forgotForm = document.getElementById('admin-forgot-form');
    const forgotMsg = document.getElementById('admin-forgot-message');
    const forgotBtn = document.getElementById('admin-forgot-submit-btn');
    if (forgotForm) {
      forgotForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = (document.getElementById('forgot-email')?.value || '').trim();
        if (!email) {
          showBox(forgotMsg, 'Please enter your administrator email address.', true);
          return;
        }
        if (forgotBtn) forgotBtn.disabled = true;
        try {
          const resp = await fetch('/api/admin/auth/forgot-password', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            showBox(forgotMsg, data.error || 'Unable to process password reset request.', true);
            return;
          }
          showBox(forgotMsg, data.message || 'Password reset request processed.', false);
          forgotForm.reset();
        } catch {
          showBox(forgotMsg, 'Network error while contacting recovery server.', true);
        } finally {
          if (forgotBtn) forgotBtn.disabled = false;
        }
      });
    }
  }

  function initResetPassword() {
    const form = document.getElementById('admin-reset-form');
    const msgEl = document.getElementById('admin-reset-message');
    const submitBtn = document.getElementById('admin-reset-submit-btn');
    if (!form) return;

    const params = new URLSearchParams(window.location.search);
    const token = (params.get('token') || '').trim();
    if (!token) {
      showBox(msgEl, 'Missing password reset token. Open the full link sent to your email.', true);
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newPassword = document.getElementById('reset-new-password')?.value || '';
      const confirmPassword = document.getElementById('reset-confirm-password')?.value || '';

      if (newPassword !== confirmPassword) {
        showBox(msgEl, 'Passwords do not match.', true);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        const resp = await fetch('/api/admin/auth/reset-password', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          showBox(msgEl, data.error || 'Password reset failed.', true);
          return;
        }
        showBox(msgEl, data.message || 'Password updated successfully.', false);
        form.reset();
      } catch {
        showBox(msgEl, 'Network error while updating password.', true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initResetPassword();
  });
})();

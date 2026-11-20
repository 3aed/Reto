/* ==========================================================================
   RetroMarket — Private Admin Login Client (Vanilla ES6)
   Authenticates administrators via server-side Supabase Auth proxy endpoints.
   Displays server-enforced brute-force cooldown timers when HTTP 429 occurs.
   ========================================================================== */

(() => {
  'use strict';

  const adminBase = document.body.getAttribute('data-admin-base') || '';
  let cooldownTimerId = null;

  function showBox(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.className = (isError ? 'error-box' : 'inline-message') + ' is-visible';
  }

  function formatRemaining(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return mins + 'm ' + String(secs).padStart(2, '0') + 's';
    }
    return secs + 's';
  }

  function startCooldownUi(submitBtn, msgEl, initialSeconds) {
    let remaining = Math.max(1, Math.ceil(Number(initialSeconds) || 0));
    if (cooldownTimerId) {
      clearInterval(cooldownTimerId);
      cooldownTimerId = null;
    }

    const update = () => {
      if (remaining <= 0) {
        clearInterval(cooldownTimerId);
        cooldownTimerId = null;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In »';
        }
        showBox(msgEl, 'Cooldown ended. You may attempt to sign in again.', false);
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Locked (' + formatRemaining(remaining) + ')';
      }
      showBox(
        msgEl,
        'Too many failed login attempts. Please wait ' +
          formatRemaining(remaining) +
          ' before trying again.',
        true
      );
      remaining -= 1;
    };

    update();
    cooldownTimerId = setInterval(update, 1000);
  }

  function initLogin() {
    const form = document.getElementById('admin-login-form');
    const msgEl = document.getElementById('admin-login-message');
    const submitBtn = document.getElementById('admin-signin-btn');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (cooldownTimerId) return;

      const email = (document.getElementById('admin-email')?.value || '').trim();
      const password = document.getElementById('admin-password')?.value || '';

      if (!email || !password) {
        showBox(msgEl, 'Please enter both your administrator email address and password.', true);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      let lockedByCooldown = false;
      try {
        const resp = await fetch('/api/admin/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await resp.json().catch(() => ({}));

        if (resp.status === 429) {
          const retryAfter =
            Number(data.retryAfterSeconds) ||
            Number(resp.headers.get('Retry-After')) ||
            300;
          lockedByCooldown = true;
          startCooldownUi(submitBtn, msgEl, retryAfter);
          return;
        }

        if (!resp.ok) {
          let errText = data.error || 'Sign-in failed.';
          if (typeof data.remainingAttempts === 'number' && data.remainingAttempts > 0) {
            errText +=
              ' (' +
              data.remainingAttempts +
              ' attempt' +
              (data.remainingAttempts === 1 ? '' : 's') +
              ' remaining before temporary cooldown.)';
          }
          showBox(msgEl, errText, true);
          return;
        }

        window.location.href = adminBase + '/';
      } catch {
        showBox(msgEl, 'Network error while contacting authentication server.', true);
      } finally {
        if (submitBtn && !lockedByCooldown) submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
  });
})();

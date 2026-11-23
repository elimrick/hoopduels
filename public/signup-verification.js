(async function () {
  const container = document.getElementById('signup-verification');
  const status = document.getElementById('signup-verification-status');
  let widgetId;
  let token;
  let required = true;

  window.HoopSignupVerification = {
    getToken() {
      if (required && !token) {
        throw new Error(status.textContent || 'Complete the sign-up verification and try again.');
      }
      return token;
    },
    reset() {
      if (!token || widgetId == null) return;
      token = undefined;
      window.turnstile.reset(widgetId);
    }
  };

  function showError() {
    token = undefined;
    status.textContent = 'Sign-up verification could not load. Reload the page to try again.';
  }

  try {
    const response = await fetch('/api/auth/signup-config');
    if (!response.ok) throw new Error('Could not load signup configuration');
    const { siteKey } = await response.json();
    if (!siteKey) {
      required = false;
      status.textContent = '';
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => {
      try {
        widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          action: 'signup',
          theme: 'dark',
          size: 'flexible',
          callback(value) {
            token = value;
            status.textContent = '';
          },
          'expired-callback'() {
            token = undefined;
            status.textContent = 'Verification expired. Please wait for it to refresh.';
          },
          'error-callback': showError
        });
      } catch {
        showError();
      }
    };
    script.onerror = showError;
    document.head.append(script);
  } catch {
    showError();
  }
})();

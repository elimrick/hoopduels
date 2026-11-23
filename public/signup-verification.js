(async function () {
  const container = document.getElementById('signup-verification');
  try {
    const response = await fetch('/api/auth/signup-config');
    if (!response.ok) throw new Error();
    const { siteKey } = await response.json();
    if (!siteKey) return;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => window.turnstile.ready(() => {
      window.turnstile.render(container, { sitekey: siteKey, action: 'signup', appearance: 'interaction-only' });
    });
    script.onerror = showError;
    document.head.append(script);
  } catch {
    showError();
  }

  function showError() {
    container.textContent = 'Sign-up verification could not load. Reload the page to try again.';
  }
})();

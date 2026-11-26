'use strict';
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = document.getElementById('loginMessage');
  const btn = e.target.querySelector('button[type="submit"]');
  message.className = 'small mt-3 text-secondary';
  message.textContent = 'Signing in…';
  if (btn) btn.disabled = true;
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('sf_token', data.token);
    localStorage.setItem('sf_user', JSON.stringify(data.user));
    const role = data.user.role;
    location.href =
      role === 'SALESMAN' ? '/sales.html' :
      role === 'PRODUCTION' ? '/production.html' :
      role === 'ACCOUNTANT' ? '/auditor.html' :
      '/dashboard.html';
  } catch (err) {
    message.className = 'small mt-3 text-danger';
    message.textContent = err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});

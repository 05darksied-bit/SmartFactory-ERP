# SmartFactory ERP – Production Security Checklist

Verify every item below before sharing your public HTTPS URL:

## 1. Secrets & Credentials
- [ ] `.env` is **not** tracked in Git (`git ls-files .env` returns empty).
- [ ] `JWT_SECRET` is a unique 64+ character random hex string (`openssl rand -hex 32`), NOT `replace_with_a_long_random_secret`.
- [ ] `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` are strong, unique passwords.
- [ ] Application connects as least-privilege user `DB_USER=smartfactory_app` (not `root`).
- [ ] Demo account passwords (`ChangeMe123!`) are changed or documented strictly as internship demo accounts.

## 2. Network & Container Isolation
- [ ] MySQL port `3306` is **not** published in `docker-compose.yml` and **blocked** in UFW/cloud firewall.
- [ ] Express port `3000` is bound only to `127.0.0.1:3000` on the host; public traffic enters only via Nginx (`80`/`443`).
- [ ] `app` container runs as non-root `USER node` inside `Dockerfile`.
- [ ] `NODE_ENV=production` is set so stack traces and internal MySQL error messages are never sent to clients.

## 3. HTTPS & Reverse Proxy
- [ ] Let's Encrypt TLS certificate is active and auto-renewing (`certbot renew`).
- [ ] HTTP (`80`) redirects to HTTPS (`443`) with `301`.
- [ ] `Strict-Transport-Security` (HSTS), `X-Frame-Options`, and `X-Content-Type-Options` headers are enabled in `nginx/smartfactory.conf`.
- [ ] Express `trust proxy` is enabled (`app.set('trust proxy', 1)`) so rate limiters see real client IPs behind Nginx.

## 4. Application & API Security
- [ ] Login rate limiter (`10` failed attempts / 15 min) and global API rate limiter are active.
- [ ] Helmet security headers are enabled.
- [ ] All SQL queries use parameterized `db.execute()` or static queries (zero SQL string interpolation of user input).
- [ ] All frontend HTML templates escape user/DB strings via `esc()`.
- [ ] Role-based access control (`allowRoles`) is enforced on every protected API endpoint.

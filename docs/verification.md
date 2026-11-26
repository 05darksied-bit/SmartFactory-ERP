# Verification record

## Checks completed while packaging

Run `npm run verify` to repeat the checks below without installing project dependencies.

- Six dependency-free Node tests pass: exact NIT benchmark stock/tax/costing, intra-state GST, inter-state GST, odd-paise split, invalid/unsafe monetary values and unit conversions.
- JavaScript syntax checked for backend, frontend and test files.
- Confirmed every route module mounted by `backend/app.js` exists.
- Confirmed all local page and asset references in frontend HTML resolve.
- Confirmed invoice sequence table exists in schema and is reset by seed script.
- Database-backed integration checks remain outstanding because MySQL and Docker are not installed in the packaging environment.

## Required local integration verification

The full Express + MySQL integration suite was not executed in this packaging environment because MySQL/Docker were unavailable and npm dependency installation could not complete. Run the following on a machine with Node.js 20+ and MySQL 8, or use Docker Compose:

```bash
npm install
# Create schema first if running without Docker:
mysql -u root -p < database/schema.sql
cp .env.example .env
# Edit DB credentials and set a long JWT_SECRET
npm run seed
npm test
npm run benchmark
npm start
```

For Docker:

```bash
docker compose up --build -d
docker compose exec app npm run seed
docker compose exec app npm test
docker compose exec app npm run benchmark
```

The seed script resets the dummy business transactions. Run it only against this project's dedicated database. The benchmark command creates the complete demo transaction set; seed again before repeating it.

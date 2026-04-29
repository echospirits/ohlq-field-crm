# Deploy Echo Field CRM to Vercel

## Recommended Vercel setup

Use this as a normal Git-backed Vercel app, not as a one-off zip upload.

### 1. Create a GitHub repo

```bash
git init
git add .
git commit -m "Initial Echo Field CRM MVP"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 2. Create the Vercel project

1. In Vercel, choose **Add New > Project**.
2. Import the GitHub repo.
3. Framework preset should auto-detect **Next.js**.
4. Keep the build command as `npm run build`.

### 3. Add Postgres

Use Vercel Marketplace Postgres, Neon, Supabase, or another hosted Postgres provider.

Set this environment variable in Vercel:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/ohlq_crm?sslmode=require
```

Use a pooled connection string if your provider offers one.

### 4. Create database tables

Run this locally against the production database once:

```bash
npm install
npx prisma db push
```

For a more formal production workflow later, switch to:

```bash
npx prisma migrate dev --name init
npx prisma migrate deploy
```

### 5. Deploy

Push to GitHub. Vercel will deploy automatically.

After deploy, test:

```text
https://your-app.vercel.app/api/health
```

Expected result:

```json
{ "ok": true, "database": "connected" }
```

### 6. Data import path

For the first production import, run from your computer with `DATABASE_URL` pointed at the production database and your CSVs available locally:

```bash
DATA_DIR="/path/to/your/csv-folder" npm run import:sample
```

Do not upload large OHLQ CSV files into the Vercel app bundle. Keep imports as admin scripts or build a protected import UI later.

## Immediate next engineering steps

1. Add authentication and roles.
2. Build protected CSV import UI.
3. Add account detail pages.
4. Add photo upload using Vercel Blob or S3.
5. Finish Eventbrite sync as a scheduled Vercel Cron job.

# Echo Field CRM MVP

Internal web-based CRM for liquor agency and bar/restaurant field work.

## MVP included
- Account pages for liquor agencies and future bars/restaurants
- Store tags: Cut, Fix, Add, Outperform, Watchlist, Menu Target, Display Opportunity
- Sales/inventory database model for OHLQ files
- Alert/worklist model for lapsed buyers and follow-ups
- Visit/photo model for shelf, display, menu, back bar, competitor evidence
- EventShift model for tour guide scheduling and future Eventbrite sync
- Recipe database for cocktail suggestions

## Setup
1. Create a Postgres database, ideally Neon/Supabase/Vercel Postgres.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Run:
```bash
npm install
npm run db:push
npm run import:sample
npm run dev
```

## Deploy to Vercel
- Push this folder to GitHub.
- Import the repo into Vercel.
- Add `DATABASE_URL` and optional `EVENTBRITE_TOKEN` as environment variables.
- Deploy.

## Next build steps
1. Add auth and roles: admin, sales rep, tour guide.
2. Replace local upload paths with Vercel Blob/S3 photo storage.
3. Build CSV import UI for monthly OHLQ files.
4. Finish Eventbrite sync.
5. Add alert rules:
   - bar/restaurant ordered but stopped for 30/45/60 days
   - agency has inventory but no recent retail sales
   - agency has strong sales but low/no inventory
   - tasting completed but no follow-up note
   - menu/display promised but no photo proof

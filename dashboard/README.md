# Clinic Dashboard

A Next.js (App Router) dashboard for clinic owners to manage the appointments their
WhatsApp booking agent creates, and to configure the clinic's availability/profile.

It talks to the existing Express backend in the parent repo via a REST API (`/api/*`).

## Run it

1. **Backend** (parent folder) — set `JWT_SECRET` and `DASHBOARD_ORIGIN=http://localhost:3001`
   in `.env`, then:
   ```bash
   npm run dev        # serves the API + WhatsApp webhook (default :5000 here)
   ```
2. **Dashboard** (this folder):
   ```bash
   npm run dev        # http://localhost:3001
   ```

Point the dashboard at the API with `NEXT_PUBLIC_API_URL` in `.env.local`
(default `http://localhost:5000/api`).

## What's here

- `/login` — clinic owner sign-in (one account per clinic; provisioned by us, no public signup).
- `/appointments` — view/book/reschedule/cancel; filter Upcoming / All / Cancelled.
- `/settings` — edit hours, open days, slot length, clinic profile, and password. Changes take
  effect immediately for the WhatsApp agent (both read the same `clinics` table).

## Stack

Next.js 16 · React 19 · Tailwind v4 · lucide-react. UI primitives are hand-built in
`components/ui.tsx` (Button, Input, Card, Badge, etc.) with a toast system and modal.

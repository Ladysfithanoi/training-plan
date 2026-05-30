# Training Plan

Advanced fitness periodisation & workout tracking app — built with **Next.js 16**, **Supabase**, and **Tailwind CSS v4**, optimised for Vercel deployment.

---

## Design System

| Token | Hex | Usage |
|-------|-----|-------|
| `paper` | `#F6F2EA` | Background (90 % of surfaces) |
| `ink` | `#14110E` | Primary text & strong CTAs |
| `amber` | `#B5651E` | Eyebrow / links / italic highlights (≤5 %) |
| `herb` | `#5C6E48` | Coach notes, neutral data |
| `slate` | `#3A5567` | Success / online / achieved |
| `danger` | `#A33A2A` | Errors / delays / overshoots |

Font: **Montserrat** (variable, loaded via `next/font/google`).

---

## Periodisation Logic

### Training Phase (Mesocycles 1–3)

| Mesocycle | Frequency / muscle | Rep Zones |
|-----------|-------------------|-----------|
| Meso 1 | 2× / week | 5–10 |
| Meso 2 | 3× / week | 5–10 + 10–20 (machine/cable) |
| Meso 3 | 4× / week | 5–10 + 10–20 (machine) + 20–30 (cable) |

### Post-Block Options

| Option | Duration | Frequency | Sets | Intensity |
|--------|----------|-----------|------|-----------|
| **Low-Volume Maintenance** | 3–4 wk | 2× / week | 1/3 of Meso-2 | 5–10 reps + deload at end |
| **Active Rest** | 2–3 wk | ≤2 sessions / week | ≤50 % | max 10 RIR |

---

## Getting Started

### 1 — Environment variables

```bash
cp .env.local.example .env.local
```

Fill in your Supabase project URL, anon key, and service-role key.

### 2 — Supabase setup

1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. In the SQL editor run **`supabase/schema.sql`** (creates tables, RLS, triggers).
3. Then run **`supabase/seed.sql`** (populates movement patterns & exercises).

### 3 — Create the first admin account

In the Supabase dashboard → Authentication → Users, create a user manually, then in the SQL editor:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
```

### 4 — Local development

```bash
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/          # Login page
│   ├── (dashboard)/           # Protected user pages
│   │   ├── dashboard/         # Home dashboard
│   │   ├── programs/          # Active program & phase timeline
│   │   └── workouts/          # Session log & workout logger
│   ├── admin/                 # Admin-only pages
│   │   ├── users/             # Manage athletes, assign programs
│   │   └── programs/          # Training block builder
│   └── api/                   # Route handlers
│       ├── auth/              # login / logout / me
│       ├── admin/users/       # CRUD users (admin)
│       ├── programs/          # CRUD training blocks
│       ├── user-programs/     # Assign + advance phases
│       ├── workouts/          # CRUD sessions + sets
│       └── exercises/         # Exercise library
├── components/
│   ├── ui/                    # Button, Card, Badge, Input, Modal, Select
│   ├── layout/                # Sidebar
│   └── programs/              # PhaseTimeline, RepRangeMatrix
├── lib/
│   ├── supabase/              # client.ts + server.ts
│   ├── auth.ts                # requireAdmin / requireAuth helpers
│   └── utils.ts               # cn(), date helpers, label helpers
├── middleware.ts               # Route protection + admin guard
└── types/index.ts             # All TypeScript interfaces
supabase/
├── schema.sql                 # Full DB schema + RLS
└── seed.sql                   # Seed data (movement patterns, exercises)
```

---

## Deployment (Vercel)

1. Push to GitHub.
2. Import the repo in [vercel.com/new](https://vercel.com/new).
3. Add the three environment variables in the Vercel dashboard.
4. Deploy — Vercel auto-detects Next.js.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/auth/me` | Current profile |
| `GET/POST` | `/api/programs` | List / create training blocks |
| `GET/PATCH/DELETE` | `/api/programs/[id]` | Manage a block |
| `POST` | `/api/user-programs` | Assign block to user |
| `POST` | `/api/user-programs/[id]/advance` | Advance to next phase |
| `GET/POST` | `/api/workouts` | List / create sessions |
| `GET/PATCH/DELETE` | `/api/workouts/[id]` | Manage a session |
| `GET/POST` | `/api/workouts/[id]/sets` | List / log sets |
| `GET/POST` | `/api/exercises` | Exercise library |
| `GET/POST` | `/api/admin/users` | Admin: list / create users |
| `PATCH/DELETE` | `/api/admin/users/[id]` | Admin: update / delete user |

# AI-ERP

AI-ERP is an AI-powered academic communication platform that ingests campus documents, extracts structured intent and audience conditions, routes notifications to matched users/students, and provides an admin review and scheduling workflow.

## Project Status

- Frontend + backend integration is implemented.
- AI extraction/routing flow is implemented with provider fallback support.
- Core CRUD and approval/rejection/scheduling workflows are implemented.
- Responsive UI for desktop/tablet/mobile is implemented.
- Demo-ready with local API + web run.

## Monorepo Structure

- `apps/api` - Express + MongoDB API
- `apps/web` - React + Vite admin dashboard
- `packages/schemas` - shared schema contracts

## Key Features

### End-to-End Flow

1. Upload PDF (or compose custom notification).
2. Extract structured information via AI pipeline.
3. Build recipient list with targeting rules.
4. Admin review/approve/reject.
5. Deliver immediately or schedule delivery.
6. Track queue/history/status and per-recipient logs.

### Frontend (UI/UX)

- Dashboard with document listing, status chips, search, and quick actions
- Multi-step upload wizard with job progress polling and cancel
- Document detail tabs (intelligence, schedule, routing, recipients, raw)
- Review panel with targeting editor, recipient preview, delivery options, reject flow
- Compose modal for ad-hoc notifications
- Notifications queue + history views with status filtering
- Student management view with CSV import + seed demo data
- PIN login gate and session-based auth state
- Responsive layout across desktop, tablet, and mobile

### Backend (API)

- Tenant-aware request context (`x-tenant-id`)
- REST routes for documents, notifications, students, users, targeting, jobs, health, and system metrics
- Async job store for upload processing progress/cancellation
- Centralized error middleware and structured validation/error responses
- Compression + conservative cache policy for dynamic endpoints

### AI Integration

- Input -> extraction -> routing -> output workflow implemented
- Provider ordering/fallback via environment configuration
- Configurable workflow toggles (AI on/off, OCR behavior, fallback usage)
- Confidence-aware statuses (`pending_approval`, `review_required`, etc.)

### Database

- Mongoose models for documents, versions, notification logs, users, and students
- CRUD support across main entities
- Status lifecycle and audit fields for consistency and traceability
- Tenant-scoped queries and indexes for isolation

## Setup

### Prerequisites

- Node.js 18+
- npm (workspace support)
- MongoDB running locally or reachable remotely
- At least one AI provider API key (`GEMINI_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY`)

### Installation

1. Copy environment template:

   `cp .env.example .env`

2. Install dependencies:

   `npm install`

3. Update `.env` values as needed (especially database + AI keys).

### Run (Development)

Start API:

`npm run dev:api`

Start web app (new terminal):

`npm run dev:web`

### Build (Web)

`npm run build:web`

## Root Scripts

- `npm run dev:api` - start API with nodemon
- `npm run start:api` - start API in normal mode
- `npm run dev:web` - start web dev server
- `npm run build:web` - production web build

## Important Environment Variables

- `PORT` (default `4000`)
- `MONGODB_URI` (default `mongodb://127.0.0.1:27017/ai_erp`)
- `UPLOAD_DIR` (default `apps/api/uploads`)
- `DEFAULT_TENANT_ID` (default `default-campus`)
- `AI_PROVIDER_ORDER` (default fallback order when unset/invalid)
- `AI_TIMEOUT_MS` (default `30000`)
- `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`

## API Overview

### Health

- `GET /health`
- `GET /health/ai`

### Documents

- `POST /documents/upload`
- `GET /documents`
- `GET /documents/:id`
- `PATCH /documents/:id`
- `DELETE /documents/:id`
- `POST /documents/:id/approve`
- `POST /documents/:id/reject`
- `POST /documents/:id/reprocess`

### Notifications

- `GET /notifications`
- `GET /notifications/document/:documentId`
- `GET /notifications/document/:documentId/summary`
- `POST /notifications/compose`
- `PATCH /notifications/:id/update`
- `PATCH /notifications/:id/read`

### Students

- `GET /students`
- `POST /students`
- `POST /students/bulk`
- `POST /students/import-csv`
- `POST /students/seed`
- `GET /students/:id`
- `PATCH /students/:id`
- `DELETE /students/:id`

### Users

- `GET /users`
- `POST /users`
- `POST /users/bulk`
- `GET /users/:userId`
- `PATCH /users/:userId`
- `DELETE /users/:userId`
- `POST /users/preview-routing/:documentId`
- `POST /users/seed`

### Targeting

- `POST /targeting/preview`
- `POST /targeting/update/:documentId`
- `POST /targeting/add-recipients/:documentId`
- `POST /targeting/remove-recipients/:documentId`

### System + Jobs

- `GET /system`
- `GET /jobs/:jobId`
- `POST /jobs/:jobId/cancel`

## Checklist Mapping

### Completed

- Project functionality (frontend + backend + AI flow)
- Frontend responsiveness and UX
- API routing and centralized error handling
- AI input -> processing -> output pipeline
- Database schema + CRUD + consistency fields
- Codebase structure and maintainability conventions
- Demo readiness (web build succeeds)

### Notes

- Current authentication is PIN/session-based for demo.
- **Recommended next step:** implement JWT-based authentication/authorization for production security.

## Developer Notes

- Multi-tenant behavior relies on `x-tenant-id`; default tenant fallback is available.
- Scheduled notification reconciliation runs on server startup + interval.
- Dist assets under `apps/web/dist` are build outputs and may change frequently.

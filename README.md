# AI-ERP

AI-powered ERP focused on academic document intelligence.

## Current Implementation Status

Phase 1 foundation is implemented with a tenant-aware Node.js API for document ingestion and extraction bootstrap.

## Monorepo Structure

- apps/api: Express + MongoDB service
- apps/web: frontend placeholder
- packages/schemas: shared JSON schema contracts

## Quick Start

1. Copy `.env.example` to `.env`
2. Ensure MongoDB is running locally
3. Install dependencies:

   npm install

4. Start API:

<<<<<<< HEAD
- Dashboard with document listing, status chips, search, and quick actions
- Multi-step upload wizard with job progress polling and cancel
- Document detail tabs (intelligence, schedule, routing, recipients, raw)
- Review panel with targeting editor, recipient preview, delivery options, reject flow
- Compose modal for ad-hoc notifications
- Notifications queue + history views with status filtering
- Student management view with CSV import + seed demo data
- URL-based frontend routing with deep links and browser history support
- JWT-backed login flow with session storage persistence
- Responsive layout across desktop, tablet, and mobile

### Frontend Route Map

- `/login` - authentication screen
- `/dashboard` - system overview and pending approvals
- `/documents` - documents list and search
- `/documents/:docId` - document detail workspace
- `/documents/:docId/review` - review/approve/reject modal route
- `/students` - student directory and CSV import tools
- `/notifications` - queue and history hub (supports query params)
- `/notifications/compose` - compose modal route
- `/settings` - AI/workflow configuration

Query params:

- `/documents/:docId?tab=intelligence|schedule|routing|recipients|raw`
- `/notifications?tab=queue|history&status=delivered|scheduled|pending|failed|skipped|all`

### Backend (API)
=======
   npm run dev:api

## API Endpoints
>>>>>>> parent of 79c88fa (lwt auth)

- GET /health
- POST /documents/upload (multipart form-data with `file`, optional `title`, optional `docType`)
- GET /documents
- GET /documents/:id

## Notes

<<<<<<< HEAD
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

- Current authentication uses JWT token issuance (`/auth/login`) and bearer validation middleware on protected API routes.
- Optional next step: add role-based policy granularity for sensitive operations.

## Developer Notes

- Multi-tenant behavior relies on `x-tenant-id`; default tenant fallback is available.
- Scheduled notification reconciliation runs on server startup + interval.
- Dist assets under `apps/web/dist` are build outputs and may change frequently.
=======
- Current extractor is a deterministic stub to validate end-to-end flow.
- Gemini/API extraction integration is the next implementation step.
- Documents with low confidence are marked as `review_required`.
>>>>>>> parent of 79c88fa (lwt auth)

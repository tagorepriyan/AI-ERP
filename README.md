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

   npm run dev:api

## API Endpoints

- GET /health
- POST /documents/upload (multipart form-data with `file`, optional `title`, optional `docType`)
- GET /documents
- GET /documents/:id

## Notes

- Current extractor is a deterministic stub to validate end-to-end flow.
- Gemini/API extraction integration is the next implementation step.
- Documents with low confidence are marked as `review_required`.

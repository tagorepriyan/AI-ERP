# Deployment Guide

## Quick Start: Netlify + Railway (Recommended)

### Backend Deployment (Railway)

1. **Create Railway account** → https://railway.app
2. **Connect your GitHub repository**
3. **Set environment variables in Railway:**
   ```
   PORT=4000
   NODE_ENV=production
   MONGODB_URI=[your MongoDB URI - use MongoDB Atlas free tier]
   GEMINI_API_KEY=[your key]
   GROQ_API_KEY=[your key]
   OPENROUTER_API_KEY=[your key]
   JWT_SECRET=[generate a random string for production!]
   DEMO_ADMIN_PIN=1111
   ```
4. **Railway will auto-deploy** from your repo
5. **Get your backend URL** from Railway dashboard (e.g., `https://your-app.railway.app`)

### Frontend Deployment (Netlify)

1. **Connect your GitHub repository** → https://netlify.com
2. **Build settings:**
   - Base directory: `apps/web`
   - Build command: `npm run build:web`
   - Publish directory: `apps/web/dist`

3. **Set environment variable:**
   - Go to **Site settings** → **Build & deploy** → **Environment**
   - Add: `VITE_API_BASE_URL` = `https://your-app.railway.app` (replace with your Railway URL)
   - **Do NOT include trailing slash**

4. **Redeploy** (or push a new commit to trigger automatic redeploy)

### Testing After Deployment

1. Open your Netlify site URL
2. Enter PIN: `1111` (or your custom PIN if changed)
3. Should now authenticate and load dashboard ✅

---

## Troubleshooting: "Failed to Fetch" After PIN Entry

### Issue: Frontend can't reach backend

**Solution 1: Check VITE_API_BASE_URL is set**
- Netlify dashboard → Site settings → Build & deploy → Environment
- Confirm `VITE_API_BASE_URL` is set correctly
- Redeploy site (`Deploys → Trigger deploy`)

**Solution 2: Verify backend is running**
- Visit your backend URL directly: `https://your-app.railway.app/health`
- Should return: `{"status":"ok","service":"ai-erp-api",...}`
- If error, check Railway logs for startup errors

**Solution 3: Check CORS headers**
- The backend already has CORS enabled
- Backend is at [apps/api/src/app.js](apps/api/src/app.js#L21)

**Solution 4: Check browser console**
- Open: Inspect → Console tab
- Look for exact fetch error (may show blocked URL or timeout)
- Screenshot and check if URL looks correct

### Issue: "Invalid credentials" after entering correct PIN

**Solution:**
- Check Railway environment: `DEMO_ADMIN_PIN` matches what you entered
- Default PIN is `1111`
- Change it in Railway: update `DEMO_ADMIN_PIN` env variable and redeploy

---

## Local Development Setup

### Prerequisites
- Node.js 18+ and npm
- MongoDB (local or MongoDB Atlas)

### Install & Run

```bash
# Install all dependencies
npm install

# Go to workspace root
cd apps/api

# Set .env variables (copy from .env.example)
cp .env.example .env
# Edit .env with your settings

# Start backend
npm run dev

# In another terminal:
cd apps/web
npm run dev

# Open http://localhost:5173
# Backend runs on http://localhost:4000
```

### Environment Variables

**Backend (.env in apps/api):**
```
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/ai_erp
GEMINI_API_KEY=your_key
GROQ_API_KEY=your_key
OPENROUTER_API_KEY=your_key
JWT_SECRET=dev-secret-change-for-production
DEMO_ADMIN_PIN=1111
```

**Frontend (.env.local in apps/web):**
```
VITE_API_BASE_URL=http://localhost:4000
```

---

## API Endpoint Configuration

### How Frontend Finds Backend

The frontend uses this logic to find your API:

```javascript
const API = import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:4000`;
```

**Priority order:**
1. **`VITE_API_BASE_URL` environment variable** (set in Netlify/vercel/build process)
2. **Fallback**: `http://yoursite.local:4000` (only works if backend on same domain)

### For Different Hosting Platforms

**Railway Backend + Netlify Frontend:**
```
VITE_API_BASE_URL=https://your-app.railway.app
```

**Vercel Frontend + Railway Backend:**
```
# In Vercel project settings → Environment Variables
VITE_API_BASE_URL=https://your-app.railway.app
```

**Docker / Self-hosted:**
```
VITE_API_BASE_URL=https://api.yourdomain.com
```

---

## Database Setup

### MongoDB Atlas (Recommended for production)

1. Create free account: https://mongodb.com/cloud/atlas
2. Create M0 (free) cluster
3. Whitelist IP or allow all (0.0.0.0/0)
4. Get connection string: `mongodb+srv://user:pass@cluster.mongodb.net/dbname`
5. Set in `MONGODB_URI` env variable

### Local MongoDB

```bash
# Windows with MongoDB installed
mongod

# Or use Docker
docker run -d -p 27017:27017 --name mongodb mongo
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| "Failed to fetch" | API URL misconfigured | Set `VITE_API_BASE_URL` in Netlify env vars |
| "Invalid credentials" | Wrong PIN | Check `DEMO_ADMIN_PIN` env variable |
| 502 Bad Gateway | Backend down | Check Railway logs |
| CORS error | Shouldn't occur - backend has cors enabled | If it happens, check backend logs |
| "Unauthorized" | JWT token invalid | May need to restart backend |


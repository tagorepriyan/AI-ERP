# ⚡ Quick Netlify Deployment Checklist

## For Your "Failed to Fetch" Issue

### ✅ Step 1: Deploy Backend (if not already done)
- [ ] Choose platform: Railway, Render, Heroku, or your own server
- [ ] Push your code to GitHub
- [ ] Connect your repo and deploy
- [ ] Get your backend URL: `https://your-backend-url.com`
- [ ] Test backend is running: visit `https://your-backend-url.com/health`

### ✅ Step 2: Configure Frontend in Netlify
1. Go to https://app.netlify.com
2. Select your site
3. **Site settings** → **Build & deploy** → **Environment**
4. Click **Add variable**
5. Enter:
   - **Key:** `VITE_API_BASE_URL`
   - **Value:** `https://your-backend-url.com` (NO trailing slash)
6. **Save**

### ✅ Step 3: Redeploy Frontend
- [ ] Go to **Deploys** tab
- [ ] Click **Trigger deploy** → **Deploy site**
- Wait for build to complete

### ✅ Step 4: Test
- [ ] Open your Netlify site URL
- [ ] Enter PIN: `1111`
- [ ] Should see dashboard ✅

---

## 🐛 Debug If Still Not Working

### Check 1: Backend URL in Environment
```
Netlify → Site → Settings → Build & deploy → Environment
Look for: VITE_API_BASE_URL = https://your-backend-url.com
```

### Check 2: Backend is Actually Running
```
Paste in browser: https://your-backend-url.com/health
Expected response:
{
  "status": "ok",
  "service": "ai-erp-api",
  ...
}
```

### Check 3: Browser Console
```
Open deployed site
Press F12 (Inspect)
Go to Console tab
Look for: [LoginPage] API endpoint: https://...
If it shows :4000 → Environment variable not set correctly
```

### Check 4: Verify PIN
- Backend env var: `DEMO_ADMIN_PIN=1111`
- Or whatever PIN you configured

---

## 📋 Common Misconfigurations

| Problem | Solution |
|---------|----------|
| `VITE_API_BASE_URL=http://localhost:4000` | ❌ Wrong for Netlify. Use your production backend URL |
| `VITE_API_BASE_URL=https://yoursite.netlify.app` | ❌ Wrong. Should point to backend, not frontend |
| `VITE_API_BASE_URL=https://your-backend.com/` | ⚠️ Remove trailing slash |
| No `VITE_API_BASE_URL` set | ❌ Frontend defaults to `:4000` which won't exist |

---

## 🚀 Deployment Options

### Recommended: Railway (Backend) + Netlify (Frontend)
- **Backend:** Railway ($5/month minimum, free tier available)
- **Frontend:** Netlify (free tier)
- **Database:** MongoDB Atlas (free tier)

### Alternative: Vercel (Both Backend & Frontend)
- Deploy both together
- Still need to set `VITE_API_BASE_URL` in Vercel environment

### Alternative: Docker on Your Server
- Deploy both as Docker containers
- Set `VITE_API_BASE_URL` during frontend build

---

## 🔧 If Deploying Backend to Railway

```bash
# 1. Create Railway account → https://railway.app
# 2. Connect GitHub repo
# 3. Auto-detects apps/api as Node.js project
# 4. Set environment variables in Railway:
#    PORT=4000
#    NODE_ENV=production
#    MONGODB_URI=mongodb+srv://...
#    JWT_SECRET=your-random-secret
#    GEMINI_API_KEY=...
#    GROQ_API_KEY=...
#    OPENROUTER_API_KEY=...
#    DEMO_ADMIN_PIN=1111
# 5. Railway deploys automatically
# 6. Get public URL: https://your-app.railway.app
# 7. Use this URL as VITE_API_BASE_URL in Netlify
```

---

## Questions?

- Check [DEPLOYMENT.md](../DEPLOYMENT.md) for detailed guide
- Frontend API logic: [apps/web/src/App.jsx](../apps/web/src/App.jsx#L8)
- Backend setup: [apps/api/src/app.js](../apps/api/src/app.js)

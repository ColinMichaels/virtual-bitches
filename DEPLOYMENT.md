# 🚀 Deployment Guide - BISCUITS Dice Game

## Firebase Migration Plan (New)

For the backend-enabled production path (API + auth + multiplayer), use:
- [docs/FIREBASE-MIGRATION-PLAN.md](docs/FIREBASE-MIGRATION-PLAN.md)

This documents the migration from GitHub Pages static hosting to:
- Firebase Hosting (frontend)
- Cloud Run (`/api`)
- Firebase Auth + Firestore

with specific notes for WebSocket routing and timeout constraints.

## Quick Deploy to Vercel (Recommended - 5 minutes)

### Step 1: Push to GitHub

1. Create a new repository on GitHub: https://github.com/new
2. Add your GitHub remote and push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git add .
git commit -m "Initial commit - BISCUITS dice game"
git push -u origin main
```

### Step 2: Deploy to Vercel

1. Go to https://vercel.com
2. Sign up/login with your GitHub account
3. Click **"Add New Project"**
4. **Import** your GitHub repository
5. Vercel will auto-detect the Vite configuration
6. Click **"Deploy"**

**That's it!** Your game will be live at: `https://your-project-name.vercel.app`

### Automatic Updates

Every time you push to GitHub, Vercel will automatically:
- Build your project
- Deploy the new version
- Update your live site

Just commit and push:
```bash
git add .
git commit -m "Add new feature"
git push
```

---

## Alternative: Netlify

### Option 1: Direct Deploy (Drag & Drop)

1. Build your project locally:
```bash
npm run build
```

2. Go to https://app.netlify.com/drop
3. Drag the `dist` folder onto the page
4. Done! Instant live URL

### Option 2: GitHub Integration

1. Push to GitHub (see Step 1 above)
2. Go to https://netlify.com
3. Click "Add new site" → "Import an existing project"
4. Connect GitHub and select your repo
5. Build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
6. Click "Deploy site"

---

## Alternative: GitHub Pages

1. Install gh-pages:
```bash
npm install --save-dev gh-pages
```

2. Add to `package.json` scripts:
```json
"scripts": {
  "deploy": "npm run build && npx gh-pages -d dist"
}
```

3. Deploy:
```bash
npm run deploy
```

Your game will be at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

---

## Environment Variables

The game uses different environment configs for dev/prod:
- `src/environments/environment.dev.ts` - Development
- `src/environments/environment.prod.ts` - Production

Vercel/Netlify automatically use production settings when deploying.

---

## Testing Before Deploy

Always test locally first:

```bash
# Development server
npm run dev

# Production build preview
npm run build
npm run preview
```

---

## Custom Domain (Optional)

### Vercel:
1. Go to your project settings
2. Navigate to "Domains"
3. Add your custom domain
4. Update DNS records as instructed

### Netlify:
1. Go to "Domain settings"
2. Add custom domain
3. Follow DNS configuration steps

---

## Troubleshooting

**Build fails?**
- Check that all dependencies are in `package.json`
- Run `npm install` and `npm run build` locally first

**404 on routes?**
- Vite is configured for SPA routing
- Vercel/Netlify handle this automatically

**Assets not loading?**
- Check `vite.config.ts` has `base: "./"` (already configured)

---

## 🎮 Share Your Game!

Once deployed, share your URL with players to get feedback:
- Twitter/X
- Reddit (r/webgames, r/incremental_games)
- Discord servers
- itch.io (upload the `dist` folder as HTML5 game)

Good luck with your game! 🎲

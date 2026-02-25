# Alpha Release Setup Guide

This document explains the alpha warning modal and updates panel system added for the pre-beta release.

## Components Added

### 1. Alpha Warning Modal (`src/ui/alphaWarning.ts`)
- Shows a one-time warning about pre-release status
- localStorage tracking: `biscuits-alpha-seen`
- Dismissible with checkbox "Don't show this again"
- Displays on first visit with 1-second delay
- Includes hero image support

### 2. Updates Panel (`src/ui/updates.ts`)
- Small collapsible blog panel for game updates/notifications
- JSON-based content system (`public/updates.json`)
- Badge shows unread update count
- localStorage tracking: `biscuits-last-seen-update`
- **Desktop**: Accessible via top-right icon (bell/message icon)
- **Mobile**: Integrated into mobile menu with "Game Updates" button and badge

### 3. Updates Feed (`public/updates.json`)
- JSON file containing game updates
- Fields: id, date, title, content, version, type
- Sorted by date (newest first)
- Supports HTML in content for formatting

## Adding the Alpha Warning Image

The alpha warning modal is optimized for **16:9 aspect ratio** images (e.g., 1920×1080, 1280×720).

### Image Priority (Automatic Fallback):
The modal will try to load images in this order:
1. `/public/alpha-banner.png` (primary - 16:9 format)
2. `/public/alpha-warning.png` (fallback)
3. `/public/alpha-warning.svg` (default placeholder)

### Recommended Image Specifications:
- **Aspect Ratio**: 16:9 (optimal for social media sharing)
- **Dimensions**: 1920×1080px or 1280×720px recommended
- **Format**: PNG with transparency preferred (JPG also works)
- **File Size**: < 500KB for fast loading
- **Content**: Eye-catching visual representing alpha/pre-release status
- **Style**: Should match game's visual style (dark theme, red accents)

### To Add Your 16:9 Image:
1. Prepare your 16:9 image (1920×1080px recommended)
2. Save it as `alpha-banner.png` (or `alpha-warning.png`)
3. Place it in `/public/` directory
4. The modal will automatically use it!

### Current Setup (2026-02-25):
- ✅ Modal styled for 16:9 aspect ratio (aspect-ratio: 16 / 9)
- ✅ Image uses `object-fit: cover` for perfect fit
- ✅ Automatic fallback chain to SVG placeholder
- ✅ Max width increased to 700px to accommodate wider format
- ✅ Mobile responsive (full width, maintains aspect ratio)

### Alternative Image Paths:
If you want to use a different path, edit `src/ui/alphaWarning.ts` line 28:
```typescript
<img src="/alpha-banner.png" alt="Alpha Release" class="alpha-image"
     onerror="this.onerror=null; this.src='/alpha-warning.png'; this.onerror=function() { this.src='/alpha-warning.svg'; };" />
```

Change `/alpha-banner.png` to your preferred path.

## Managing Game Updates

### Adding a New Update

Edit `public/updates.json` and add a new entry to the `updates` array:

```json
{
  "id": "unique-id-2026-03-01",
  "date": "2026-03-01",
  "title": "✨ New Feature: Multiplayer Mode",
  "content": "<p>Multiplayer is now available! Play with up to 4 friends.</p>",
  "version": "0.2.0-alpha",
  "type": "feature"
}
```

### Update Fields:
- **id**: Unique identifier (format: `category-date`, e.g., `feature-multiplayer-2026-03-01`)
- **date**: ISO date string (YYYY-MM-DD)
- **title**: Update title (emoji + text works great!)
- **content**: HTML content (use `<p>`, `<ul>`, `<li>`, etc.)
- **version**: Optional version number
- **type**: `feature`, `bugfix`, `announcement`, or `alert` (affects icon)

### Update Types and Icons:
- `feature` → ✨ (sparkles)
- `bugfix` → 🐛 (bug)
- `announcement` → 📢 (megaphone)
- `alert` → ⚠️ (warning)
- Default → 📝 (memo)

### Best Practices:
1. **Keep updates concise** - Users see these in a small panel
2. **Use HTML sparingly** - Basic formatting only
3. **Include version numbers** - Helps users track changes
4. **Most recent first** - Updates are auto-sorted by date
5. **Unique IDs** - Prevents tracking issues

### HTML Formatting Examples:

**Simple paragraph:**
```json
"content": "<p>Fixed bug where dice would disappear after scoring.</p>"
```

**With list:**
```json
"content": "<p>New features added:</p><ul style=\"margin: 10px 0; padding-left: 20px;\"><li>Dark mode</li><li>Custom themes</li><li>Sound effects</li></ul>"
```

**With emphasis:**
```json
"content": "<p>This update includes <strong>critical bug fixes</strong>. Please refresh your game!</p>"
```

## Unread Badge System

The updates panel shows a badge with the count of unread updates.

### How it Works:
1. User sees the badge with a number (e.g., "3")
2. When they click the updates icon, the panel opens
3. All updates are marked as "seen" (tracked in localStorage)
4. Badge disappears until a new update is added

### For Testing:
To reset and see the badge again:
```javascript
// In browser console:
localStorage.removeItem('biscuits-last-seen-update');
location.reload();
```

## Resetting the Alpha Warning

The alpha warning shows only once. To test it again:

```javascript
// In browser console:
localStorage.removeItem('biscuits-alpha-seen');
location.reload();
```

Or use the static method:
```javascript
// In browser console:
AlphaWarningModal.reset();
location.reload();
```

## Customizing the Warning Message

To change the warning message, edit `src/ui/alphaWarning.ts` lines 36-64:

```typescript
<div class="alpha-message">
  <p>
    Thank you for testing BISCUITS! This is an <strong>alpha pre-release</strong> version
    and is still under active development.
  </p>
  <!-- Add more content here -->
</div>
```

## Mobile Responsiveness

Both components are fully responsive:

### Alpha Warning Modal:
- **Desktop**: 600px max width, centered
- **Tablet** (≤768px): 95% width, reduced padding
- **Mobile** (≤480px): Full screen, smaller fonts

### Updates Panel:
- **Desktop**: 360px width, top-right floating icon, hidden on mobile
- **Tablet** (≤768px): Panel 90vw width when opened
- **Mobile** (≤768px): Button integrated into mobile menu, badge on right side
  - Opens same panel as desktop
  - Panel width: nearly full screen
  - Automatically closes mobile menu when opened

## Styling Customization

### Alpha Warning Colors:
Edit `src/styles.css` starting at line 3196:

```css
.alpha-badge {
  background: linear-gradient(135deg, #e94560, #ff6b6b); /* Change colors */
}

.alpha-content {
  border: 2px solid rgba(233, 69, 96, 0.3); /* Change border */
}
```

### Updates Panel Colors:
Edit `src/styles.css` starting at line 3346:

```css
.updates-toggle-btn {
  border: 2px solid rgba(233, 69, 96, 0.5); /* Change border */
  color: #e94560; /* Change icon color */
}
```

## Integration Points

### Main Initialization (`src/main.ts`):
Lines 595-604 initialize both components:
```typescript
alphaWarning = new AlphaWarningModal();
updatesPanel = new UpdatesPanel();

if (!AlphaWarningModal.hasSeenWarning()) {
  setTimeout(() => {
    alphaWarning.show();
  }, 1000);
}
```

### Mobile Menu Integration (`index.html`):
Lines 141-147 add the mobile updates button:
```html
<button id="mobile-updates-btn" class="mobile-menu-btn mobile-menu-action" title="Game Updates">
  <svg><!-- message icon --></svg>
  <span>Game Updates</span>
  <span class="mobile-updates-badge" style="display: none;">0</span>
</button>
```

The mobile button:
- Opens the same updates panel as desktop
- Automatically closes the mobile menu when clicked
- Shows the same unread badge count
- Styled to match other mobile menu buttons

### Delay Timing:
The 1-second delay before showing the alpha warning can be adjusted:
```typescript
setTimeout(() => {
  alphaWarning.show();
}, 2000); // Change to 2 seconds
```

## Removing Components (Post-Beta)

When ready to remove the alpha warning for official release:

1. **Remove from main.ts:**
   - Delete import statements (lines 11-12)
   - Delete initialization (lines 595-604, 634-642)
   - Delete variable declarations (lines 583-584)

2. **Remove component files:**
   ```bash
   rm src/ui/alphaWarning.ts
   ```

3. **Keep or modify updates panel:**
   - Can keep for ongoing announcements
   - Or remove similarly to alpha warning

4. **Remove styles:**
   - Delete lines 3196-3654 from `src/styles.css`
   - Or keep updates panel styles if still using it

5. **Remove image:**
   ```bash
   rm public/alpha-warning.png
   ```

## FAQ

**Q: Can I disable the alpha warning temporarily without removing code?**
A: Yes, comment out the initialization in `main.ts` lines 599-604.

**Q: How do I change the warning from modal to splash screen?**
A: The current implementation uses a modal. To convert to splash, you'd need to integrate it with `SplashScreen` component instead.

**Q: Can I add images to update entries?**
A: Yes! Use `<img>` tags in the content HTML. Keep images small for performance.

**Q: How many updates should I keep in the feed?**
A: Recommend 10-20 most recent updates. Archive older ones to keep the JSON file small.

**Q: Can I customize the position of the updates button?**
A: Yes, edit `.updates-container` CSS in `styles.css` line 3350. Change `top` and `right` values.

## Support

For issues or questions about this system, check:
- Console logs (look for `[AlphaWarning]` and `[UpdatesPanel]` prefixes)
- Browser localStorage (Developer Tools → Application → Local Storage)
- Network tab (check if `updates.json` loads successfully)

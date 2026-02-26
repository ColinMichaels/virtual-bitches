const DEFAULT_CANONICAL_URL = "https://yourdomain.com/path";
const DEFAULT_OG_IMAGE = "https://yourcdn.com/og/your-image-1200x630.jpg";
const DEFAULT_TITLE = "BISCUITS - Push Your Luck Dice Game";
const DEFAULT_DESCRIPTION = "Short, compelling summary that matches the page content.";
const DEFAULT_IMAGE_ALT = "Describe the thumbnail for accessibility.";
const DEFAULT_FB_APP_ID = "YOUR_APP_ID";

const SHARE_QUERY_PARAM_ALLOWLIST = new Set(["seed", "score", "log", "difficulty", "variant"]);

export interface FacebookShareMetaOptions {
  canonicalUrl?: string;
  url?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  locale?: string;
  fbAppId?: string;
}

export interface ScoreSeedShareLinkOptions {
  baseUrl?: string;
  seed: string;
  score?: number;
  difficulty?: string;
}

export function initializeFacebookShareMeta(): void {
  if (typeof window === "undefined") {
    return;
  }

  const current = new URL(window.location.href);
  const canonicalUrl = buildCanonicalUrl(current);
  const seededChallenge = current.searchParams.get("seed")?.trim() ?? "";
  const rawScore = Number(current.searchParams.get("score"));
  const hasScore = Number.isFinite(rawScore);
  const score = hasScore ? Math.max(0, Math.floor(rawScore)) : null;

  const challengeTitle =
    seededChallenge && score !== null ? `BISCUITS Challenge - Beat ${score}` : DEFAULT_TITLE;
  const challengeDescription =
    seededChallenge && score !== null
      ? `Try seed ${seededChallenge} and beat score ${score}.`
      : DEFAULT_DESCRIPTION;

  applyFacebookShareMeta({
    canonicalUrl,
    url: canonicalUrl,
    title: challengeTitle,
    description: challengeDescription,
  });
}

export function applyFacebookShareMeta(options: FacebookShareMetaOptions = {}): void {
  if (typeof document === "undefined") {
    return;
  }

  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
  const canonicalUrl = options.canonicalUrl?.trim() || DEFAULT_CANONICAL_URL;
  const ogUrl = options.url?.trim() || canonicalUrl;
  const title = options.title?.trim() || DEFAULT_TITLE;
  const description = options.description?.trim() || DEFAULT_DESCRIPTION;
  const imageUrl = options.imageUrl?.trim() || env.VITE_OG_IMAGE_URL?.trim() || DEFAULT_OG_IMAGE;
  const imageWidth = Number.isFinite(options.imageWidth) ? Math.floor(options.imageWidth as number) : 1200;
  const imageHeight = Number.isFinite(options.imageHeight)
    ? Math.floor(options.imageHeight as number)
    : 630;
  const imageAlt = options.imageAlt?.trim() || DEFAULT_IMAGE_ALT;
  const locale = options.locale?.trim() || "en_US";
  const fbAppId = options.fbAppId?.trim() || env.VITE_FACEBOOK_APP_ID?.trim() || DEFAULT_FB_APP_ID;

  upsertCanonicalLink(canonicalUrl);
  upsertMetaProperty("og:url", ogUrl);
  upsertMetaProperty("og:type", "website");
  upsertMetaProperty("og:title", title);
  upsertMetaProperty("og:description", description);
  upsertMetaProperty("og:image", imageUrl);
  upsertMetaProperty("og:image:width", String(imageWidth));
  upsertMetaProperty("og:image:height", String(imageHeight));
  upsertMetaProperty("og:image:alt", imageAlt);
  upsertMetaProperty("og:locale", locale);
  upsertMetaProperty("fb:app_id", fbAppId);
  upsertMetaName("twitter:card", "summary_large_image");
}

export function buildScoreSeedShareUrl(options: ScoreSeedShareLinkOptions): string {
  const fallbackBase =
    typeof window !== "undefined" ? window.location.href : DEFAULT_CANONICAL_URL;
  const url = new URL(options.baseUrl ?? fallbackBase, fallbackBase);
  url.searchParams.set("seed", options.seed);
  if (Number.isFinite(options.score)) {
    url.searchParams.set("score", String(Math.max(0, Math.floor(options.score as number))));
  }
  if (typeof options.difficulty === "string" && options.difficulty.trim().length > 0) {
    url.searchParams.set("difficulty", options.difficulty.trim());
  }
  return url.toString();
}

function buildCanonicalUrl(currentUrl: URL): string {
  const canonical = new URL(currentUrl.origin + currentUrl.pathname);
  SHARE_QUERY_PARAM_ALLOWLIST.forEach((key) => {
    const value = currentUrl.searchParams.get(key);
    if (typeof value === "string" && value.length > 0) {
      canonical.searchParams.set(key, value);
    }
  });
  return canonical.toString();
}

function upsertCanonicalLink(href: string): void {
  const existing =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ??
    document.querySelector<HTMLLinkElement>('link[data-share-meta="canonical"]');
  if (existing) {
    existing.href = href;
    existing.dataset.shareMeta = "canonical";
    return;
  }
  const link = document.createElement("link");
  link.rel = "canonical";
  link.href = href;
  link.dataset.shareMeta = "canonical";
  document.head.appendChild(link);
}

function upsertMetaProperty(property: string, content: string): void {
  const selector = `meta[property="${cssEscape(property)}"]`;
  const existing = document.querySelector<HTMLMetaElement>(selector);
  if (existing) {
    existing.content = content;
    existing.dataset.shareMeta = property;
    return;
  }
  const meta = document.createElement("meta");
  meta.setAttribute("property", property);
  meta.content = content;
  meta.dataset.shareMeta = property;
  document.head.appendChild(meta);
}

function upsertMetaName(name: string, content: string): void {
  const selector = `meta[name="${cssEscape(name)}"]`;
  const existing = document.querySelector<HTMLMetaElement>(selector);
  if (existing) {
    existing.content = content;
    existing.dataset.shareMeta = name;
    return;
  }
  const meta = document.createElement("meta");
  meta.setAttribute("name", name);
  meta.content = content;
  meta.dataset.shareMeta = name;
  document.head.appendChild(meta);
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

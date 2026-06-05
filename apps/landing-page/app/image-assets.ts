const R2_PUBLIC_ORIGIN = 'https://static.open-design.ai';
const IMAGE_RESIZING_ORIGIN = R2_PUBLIC_ORIGIN;
const ASSET_PREFIX = 'landing/assets';

type ImageOptions = {
  width: number;
  quality?: number;
};

export function r2Asset(name: string): string {
  return `${R2_PUBLIC_ORIGIN}/${ASSET_PREFIX}/${name}`;
}

export function imageAsset(name: string, { width, quality = 85 }: ImageOptions): string {
  const options = `width=${width},quality=${quality},format=auto`;
  return `${IMAGE_RESIZING_ORIGIN}/cdn-cgi/image/${options}/${r2Asset(name)}`;
}

/**
 * Build a responsive `srcset` value. Each width gets its own Cloudflare
 * Image Resizing variant; the browser picks the closest match to
 * `sizes × devicePixelRatio`.
 *
 * Why this exists: a single 1024-wide variant was hurting both ends —
 * retina desktops repaint when a higher-DPR copy arrives (LCP P99 long
 * tail), and phones download more bytes than they need.
 */
export function imageAssetSrcset(
  name: string,
  widths: number[],
  quality = 82,
): string {
  return widths
    .map((width) => `${imageAsset(name, { width, quality })} ${width}w`)
    .join(', ');
}

// Homepage hero art. Served from `public/hero-home.png` (a local asset)
// rather than the R2 CDN, so it ships straight from the site origin and
// skips the Cloudflare image-resizing variants. Single intrinsic size —
// the browser has only one candidate to pick from.
export const heroImage = '/hero-home.png';
export const labStageImage = '/lab-stage-bg.jpg';

/**
 * srcset for the homepage hero. With a single local asset there are no
 * responsive variants to choose between, so this points at the same file
 * tagged with its intrinsic width.
 */
export const heroImageSrcset = `${heroImage} 2880w`;

/**
 * Default Open Graph card image. Used by every page that doesn't supply
 * its own hero (most blog posts in the v1 layout). 1200 wide is what most
 * social platforms render at; aspect ratio is whatever hero.png ships with
 * — we omit explicit og:image:width/height so platforms can resolve it.
 */
export const ogDefaultImage = imageAsset('hero.png', { width: 1200, quality: 86 });

/**
 * 1×1 transparent SVG used as the initial `src` for precise-lazyloaded
 * `<img>` elements. Inline data URI (~120 bytes) so it parses zero-RTT
 * regardless of cache state. The real image URL lives in
 * `data-precise-src` and is swapped in by the global IntersectionObserver
 * script (`precise-lazyload.astro`) once the element enters the rootMargin
 * window.
 */
export const PRECISE_LAZY_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201%201%22%2F%3E';

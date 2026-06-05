/*
 * Sticky Header — static markup rendered at build time. Headroom-style
 * hide/show and the live GitHub star count are attached by the tiny inline
 * scripts on each Astro page, so this marketing page ships no React runtime
 * to the browser.
 *
 * The primary resource link points to the Skill catalog. Catalog counts are
 * still accepted by the public prop shape because sub-pages pass them through.
 */

import {
  DEFAULT_LOCALE,
  getCommonCopy,
  getHeaderProductMenuCopy,
  localizedHref,
  type HeaderCopy,
  type LandingLocaleCode,
} from '../i18n';

const REPO = 'https://github.com/nexu-io/open-design';
const REPO_RELEASES = `${REPO}/releases`;
const REPO_CONTRIBUTORS = `${REPO}/graphs/contributors`;
const REPO_DISCUSSIONS = `${REPO}/discussions`;
const DISCORD = 'https://discord.gg/9ptkbbqRu';

// Agent column — the coding agents/CLIs Open Design adapts to. Links are
// `#` placeholders for now (per product direction); real destinations will
// be filled in later.
const AGENTS = [
  'AMR',
  'Codex CLI',
  'Devin for Terminal',
  'OpenCode',
  'Kimi CLI',
  'Qwen Code',
  'Qoder CLI',
  'GitHub Copilot CLI',
  'Pi',
  'Kiro CLI',
  'Kilo',
  'Mistral Vibe CLI',
  'DeepSeek TUI',
  'Claude Code',
  'Gemini CLI',
  'Hermes',
  'Grok Build',
  'Cursor Agent',
];

// Solution column — what people build with Open Design (Use cases) and who
// they are (Roles). Links are `#`/`/#top` placeholders until the dedicated
// landing surfaces ship.
const SOLUTION_USE_CASES = [
  'Prototype',
  'Dashboard',
  'Slides',
  'Image',
  'Video',
  'Design system',
];
const SOLUTION_ROLES = [
  'Solo Builder',
  'Designer',
  'Engineering',
  'Product Managers',
  'Marketing',
];

const ext = {
  target: '_blank',
  rel: 'noreferrer noopener',
} as const;

export interface HeaderProps {
  /** Nav highlight target. `'home'` is the default for `/`. */
  active?:
    | 'home'
    | 'product'
    | 'html-anything'
    | 'library'
    | 'skills'
    | 'systems'
    | 'templates'
    | 'craft'
    | 'blog'
    | 'tutorials';
  /**
   * Live counts from the Markdown catalogs. Required so we can never
   * silently render stale fallback numbers when a caller forgets to
   * thread `getCatalogCounts()` through. Header only consumes these
   * four scalar fields; the homepage passes the wider `CatalogCounts`
   * value (with `byMode` / `byPlatform`) by structural subtyping.
   */
  counts: {
    skills: number;
    systems: number;
    templates: number;
    craft: number;
  };
  github?: {
    starsLabel: string;
  };
  localeSwitcher?: {
    label: string;
    prefix: string;
    shortLabel: string;
    options: ReadonlyArray<{
      code: LandingLocaleCode;
      href: string;
      htmlLang: string;
      label: string;
    }>;
  };
  /** UI locale for nav labels and accessibility text. */
  locale?: LandingLocaleCode;
  /** Optional override for callers that already resolved localized chrome. */
  copy?: HeaderCopy;
  /** Brand link target — `#top` on the homepage, `/` on sub-pages. */
  brandHref?: string;
}

export function Header({
  active = 'home',
  github,
  localeSwitcher,
  locale = DEFAULT_LOCALE,
  copy,
  brandHref = '#top',
}: HeaderProps) {
  const headerCopy = copy ?? getCommonCopy(locale).header;
  const href = (path: string) => localizedHref(path, locale);
  const homeBrandHref = brandHref === '/' ? href('/') : brandHref;
  const productMenuCopy = getHeaderProductMenuCopy(locale);

  return (
    <header className='nav' data-od-id='nav'>
      <div className='container nav-inner'>
        <a href={homeBrandHref} className='brand'>
          <img
            className='brand-logo'
            src='/logo-lockup.svg'
            alt='Open Design'
            width={225}
            height={83}
          />
        </a>
        {/*
          Mobile / tablet hamburger. Hidden by CSS at ≥1100px (the desktop
          breakpoint where the full nav fits). At narrower widths it toggles
          `.is-open` on the parent <header> via a small handler in
          `header-enhancer.astro` — when open, the `<nav>` element below
          drops down underneath the header bar as a vertical list.
        */}
        <button
          type='button'
          className='nav-toggle'
          aria-label={productMenuCopy.toggleNavigationMenu}
          aria-controls='primary-nav'
          aria-expanded='false'
          data-nav-toggle
        >
          <span className='nav-toggle-icon' aria-hidden='true' />
        </button>
        <nav id='primary-nav' data-nav-primary>
          <ul className='nav-links'>
            {/* Product — the Open Design products. */}
            <li className='has-dropdown'>
              <a
                href={href('/')}
                className={
                  active === 'product' || active === 'home' ? 'is-active' : undefined
                }
              >
                Product
                <span className='dropdown-caret' aria-hidden='true'>▾</span>
              </a>
              <ul className='nav-dropdown' aria-label='Product'>
                <li>
                  <a href={href('/#top')}>
                    <span className='dropdown-name'>OpenDesign</span>
                  </a>
                </li>
                <li>
                  <a
                    href={href('/html-anything/')}
                    className={active === 'html-anything' ? 'is-active' : undefined}
                  >
                    <span className='dropdown-name'>html-anything</span>
                  </a>
                </li>
              </ul>
            </li>

            {/* Solution — Use cases + Roles. */}
            <li className='has-dropdown'>
              <a href='#'>
                Solution
                <span className='dropdown-caret' aria-hidden='true'>▾</span>
              </a>
              <ul className='nav-dropdown nav-dropdown-grouped' aria-label='Solution'>
                <li className='nav-dropdown-group'>
                  <span className='nav-dropdown-heading'>Use cases</span>
                  {SOLUTION_USE_CASES.map((name) => (
                    <a href={href('/#top')} key={name}>
                      <span className='dropdown-name'>{name}</span>
                    </a>
                  ))}
                </li>
                <li className='nav-dropdown-group'>
                  <span className='nav-dropdown-heading'>Roles</span>
                  {SOLUTION_ROLES.map((name) => (
                    <a href='#' key={name}>
                      <span className='dropdown-name'>{name}</span>
                    </a>
                  ))}
                </li>
              </ul>
            </li>

            {/* Agent — supported coding agents / CLIs (links are placeholders). */}
            <li className='has-dropdown'>
              <a href='#'>
                Agent
                <span className='dropdown-caret' aria-hidden='true'>▾</span>
              </a>
              <ul className='nav-dropdown nav-dropdown-agent' aria-label='Agent'>
                {AGENTS.map((name) => (
                  <li key={name}>
                    <a href='#'>
                      <span className='dropdown-name'>{name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </li>

            {/* Plugins — the three composable catalogs. */}
            <li className='has-dropdown'>
              <a
                href={href('/plugins/')}
                className={
                  active === 'library' ||
                  active === 'skills' ||
                  active === 'systems' ||
                  active === 'templates'
                    ? 'is-active'
                    : undefined
                }
              >
                Plugins
                <span className='dropdown-caret' aria-hidden='true'>▾</span>
              </a>
              <ul className='nav-dropdown' aria-label='Plugins'>
                <li>
                  <a href={href('/templates/')}>
                    <span className='dropdown-name'>Design Templates</span>
                  </a>
                </li>
                <li>
                  <a href={href('/skills/')}>
                    <span className='dropdown-name'>Design Skills</span>
                  </a>
                </li>
                <li>
                  <a href={href('/systems/')}>
                    <span className='dropdown-name'>Design Systems</span>
                  </a>
                </li>
              </ul>
            </li>

            {/* Resources */}
            <li className='has-dropdown'>
              <a
                href='#'
                className={
                  active === 'tutorials' || active === 'blog' ? 'is-active' : undefined
                }
              >
                Resources
                <span className='dropdown-caret' aria-hidden='true'>▾</span>
              </a>
              <ul className='nav-dropdown' aria-label='Resources'>
                <li>
                  <a href={href('/blog/')}>
                    <span className='dropdown-name'>Blog</span>
                  </a>
                </li>
                <li>
                  <a href={href('/tutorials/')}>
                    <span className='dropdown-name'>Video Tutorials</span>
                  </a>
                </li>
                <li>
                  <a href='#'>
                    <span className='dropdown-name'>Weekly Newsletter</span>
                  </a>
                </li>
                <li>
                  <a href={REPO_RELEASES} {...ext}>
                    <span className='dropdown-name'>Download</span>
                  </a>
                </li>
              </ul>
            </li>

            {/* Community */}
            <li className='has-dropdown'>
              <a href='#'>
                Community
                <span className='dropdown-caret' aria-hidden='true'>▾</span>
              </a>
              <ul className='nav-dropdown' aria-label='Community'>
                <li>
                  <a href={REPO_CONTRIBUTORS} {...ext}>
                    <span className='dropdown-name'>Contributors</span>
                  </a>
                </li>
                <li>
                  <a href='#'>
                    <span className='dropdown-name'>Ambassadors</span>
                  </a>
                </li>
                <li>
                  <a href='#'>
                    <span className='dropdown-name'>Moderators</span>
                  </a>
                </li>
                <li>
                  <a href={DISCORD} {...ext}>
                    <span className='dropdown-name'>Discord</span>
                  </a>
                </li>
                <li>
                  <a href={REPO_DISCUSSIONS} {...ext}>
                    <span className='dropdown-name'>Discussion</span>
                  </a>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
        <div className='nav-side'>
          <a
            className='nav-cta ghost'
            href={REPO_RELEASES}
            aria-label={headerCopy.downloadAria}
            title={headerCopy.downloadTitle}
            {...ext}
          >
            {headerCopy.download}
          </a>
          <a
            className='nav-cta'
            href={REPO}
            aria-label={headerCopy.starAria}
            title={headerCopy.starTitle}
            {...ext}
          >
            {headerCopy.starPrefix} ·{' '}
            <span data-github-stars>{github?.starsLabel ?? '40K+'}</span>
          </a>
          {localeSwitcher ? (
            <details className='locale-switch nav-locale-switch' data-locale-switch>
              <summary
                className='locale-trigger locale-trigger-iconic'
                aria-label={localeSwitcher.label}
                title={localeSwitcher.label}
              >
                {/* Language switcher rendered as the skill's Remix Icon
                    "translate-2" glyph (\f226) instead of the 语言 · 简中 text. */}
                <span className='locale-trigger-icon' aria-hidden='true' />
                <svg
                  className='locale-trigger-caret'
                  viewBox='0 0 8 5'
                  aria-hidden='true'
                  focusable='false'
                >
                  <path
                    d='M0.5 0.75 L4 4 L7.5 0.75'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1'
                    strokeLinecap='square'
                  />
                </svg>
              </summary>
              <div className='locale-menu' role='menu'>
                {localeSwitcher.options.map((entry) => (
                  <a
                    className={`locale-menu-item${
                      entry.code === locale ? ' is-active' : ''
                    }`}
                    role='menuitem'
                    data-locale-link
                    data-locale-code={entry.code}
                    href={entry.href}
                    lang={entry.htmlLang}
                    aria-current={entry.code === locale ? 'true' : undefined}
                    key={entry.code}
                  >
                    <span className='locale-menu-code'>
                      {entry.code.toUpperCase()}
                    </span>
                    <span className='locale-menu-label'>{entry.label}</span>
                  </a>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      {/*
        Liquid Glass material — SVG displacement filter (chromatic edge
        refraction) ported 1:1 from Inspira UI's LiquidGlass.vue. Referenced
        by the nav's `backdrop-filter` once the bar condenses on scroll. The
        displacement map (the `feImage`) is generated and sized to the live
        bar by the inline script in `header-enhancer.astro` (ResizeObserver).
        Chromium-only; Safari/Firefox fall back to the plain `blur()` declared
        in globals.css, per the component's own browser-support note.
      */}
      <svg
        className='nav-glass-defs'
        aria-hidden='true'
        focusable='false'
        width='0'
        height='0'
      >
        <defs>
          <filter id='nav-liquid-glass' colorInterpolationFilters='sRGB'>
            <feImage
              x='0'
              y='0'
              width='100%'
              height='100%'
              preserveAspectRatio='none'
              result='map'
              data-nav-glass-map
            />
            <feDisplacementMap
              in='SourceGraphic'
              in2='map'
              xChannelSelector='R'
              yChannelSelector='B'
              scale='-180'
              result='dispRed'
            />
            <feColorMatrix
              in='dispRed'
              type='matrix'
              values='1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'
              result='red'
            />
            <feDisplacementMap
              in='SourceGraphic'
              in2='map'
              xChannelSelector='R'
              yChannelSelector='B'
              scale='-170'
              result='dispGreen'
            />
            <feColorMatrix
              in='dispGreen'
              type='matrix'
              values='0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'
              result='green'
            />
            <feDisplacementMap
              in='SourceGraphic'
              in2='map'
              xChannelSelector='R'
              yChannelSelector='B'
              scale='-160'
              result='dispBlue'
            />
            <feColorMatrix
              in='dispBlue'
              type='matrix'
              values='0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'
              result='blue'
            />
            <feBlend in='red' in2='green' mode='screen' result='rg' />
            <feBlend in='rg' in2='blue' mode='screen' result='output' />
            <feGaussianBlur in='output' stdDeviation='0.7' />
          </filter>
        </defs>
      </svg>
    </header>
  );
}

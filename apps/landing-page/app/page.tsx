/*
 * Open Design — Atelier Zero landing page.
 *
 * Mirrors `design-templates/open-design-landing/example.html` 1:1. When the canonical
 * example.html changes, mirror the diff here and into `app/globals.css`.
 *
 * Static React component rendered by Astro. The Header component owns the
 * small client-side behaviors; promote other sections to Astro islands only
 * when behavior is needed.
 */

import { GradualBlur } from './_components/gradual-blur';
import { Header, type HeaderProps } from './_components/header';
import {
  DEFAULT_LOCALE,
  LANDING_LOCALES,
  getCommonCopy,
  getHomePageCopy,
  getLocaleDefinition,
  localePath,
  localizedHref,
  type LandingLocaleCode,
} from './i18n';
import {
  heroImage,
  heroImageSrcset,
  imageAsset,
  PRECISE_LAZY_PLACEHOLDER,
} from './image-assets';

/**
 * `<img>` wrapper for non-hero homepage images. Outputs `data-precise-src`
 * so the global IntersectionObserver in `precise-lazyload.astro` swaps it
 * to a real `src` once the element enters viewport ± 300px. Avoids the
 * Chrome native-lazy 1250–3000px over-prefetch on this image-heavy page.
 *
 * Use a plain `<img>` (NOT this) for above-the-fold or LCP-critical images
 * where waiting on IntersectionObserver would defeat the priority hint.
 */
function LazyImg(props: { src: string; alt?: string; className?: string }) {
  return (
    <img
      src={PRECISE_LAZY_PLACEHOLDER}
      data-precise-src={props.src}
      alt={props.alt ?? ''}
      className={props.className}
      decoding='async'
    />
  );
}

function BreakText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? <br /> : null}
          {part}
        </span>
      ))}
    </>
  );
}

const arrowOut = (
  <svg viewBox='0 0 24 24'>
    <path d='M5 19L19 5M19 5H8M19 5v11' />
  </svg>
);

const arrowBack = (
  <svg viewBox='0 0 24 24'>
    <path d='M11 5l-7 7 7 7M4 12h16' />
  </svg>
);

const arrowPlus = (
  <svg viewBox='0 0 24 24'>
    <circle cx='12' cy='12' r='9' />
    <path d='M9 12h6M12 9v6' />
  </svg>
);

// Capability-card glyphs (line style, 24px grid). Shared by the localized
// step flow and the legacy non-zh capability cards.
const capIcon = {
  search: (
    <svg className='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <circle cx='9' cy='9' r='5' />
      <path d='M14 14l5 5' />
    </svg>
  ),
  direction: (
    <svg className='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <circle cx='12' cy='12' r='9' />
      <path d='M12 3a9 9 0 0 0 0 18' />
      <circle cx='8.5' cy='9' r='1' />
      <circle cx='15' cy='10' r='1' />
    </svg>
  ),
  grid: (
    <svg className='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <rect x='3.5' y='3.5' width='8' height='8' />
      <rect x='12.5' y='3.5' width='8' height='8' />
      <rect x='3.5' y='12.5' width='8' height='8' />
      <rect x='12.5' y='12.5' width='8' height='8' />
    </svg>
  ),
  adapters: (
    <svg className='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <circle cx='8' cy='12' r='4.5' />
      <circle cx='16' cy='12' r='4.5' />
    </svg>
  ),
  layers: (
    <svg className='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <path d='M5 8h14v8H5z' />
      <path d='M9 12h6M12 9v6' />
    </svg>
  ),
} as const;

const NBSP = '\u00A0';

// Canonical project URLs. Keep in sync with design-templates/open-design-landing/example.html.
//
// `data-github-version` invariant: every wrapper must contain ONLY the version
// string (e.g. `v0.3.0`), never any surrounding label or punctuation. The
// inline enhancement script in `app/pages/index.astro` assigns `textContent`
// on each slot, so any extra text inside the wrapper would be clobbered.
const REPO = 'https://github.com/nexu-io/open-design';
const REPO_RELEASES = `${REPO}/releases`;
const REPO_ISSUES = `${REPO}/issues`;
const REPO_CONTRIBUTORS = `${REPO}/graphs/contributors`;
const REPO_DAEMON = `${REPO}/tree/main/apps/daemon`;
const REPO_SKILLS = `${REPO}/tree/main/skills`;
const REPO_DOCS = `${REPO}#readme`;
const DISCORD = 'https://discord.gg/9ptkbbqRu';

const ext = {
  target: '_blank',
  rel: 'noreferrer noopener',
} as const;

// Coding-agent logos that fall in the Method section's FallingText physics
// playground (matter-js). Each is an icon chip that drops on hover instead of
// a text word. Assets live in `public/agent-icons/`.
const FALLING_ICONS = [
  { src: '/agent-icons/claude.svg', alt: 'Claude' },
  { src: '/agent-icons/codex.svg', alt: 'Codex' },
  { src: '/agent-icons/gemini.svg', alt: 'Gemini' },
  { src: '/agent-icons/cursor-agent.svg', alt: 'Cursor' },
  { src: '/agent-icons/copilot.svg', alt: 'GitHub Copilot' },
  { src: '/agent-icons/opencode.svg', alt: 'OpenCode' },
  { src: '/agent-icons/devin.png', alt: 'Devin' },
  { src: '/agent-icons/hermes.svg', alt: 'Hermes' },
  { src: '/agent-icons/pi.svg', alt: 'Pi' },
  { src: '/agent-icons/kimi.svg', alt: 'Kimi' },
  { src: '/agent-icons/kiro.svg', alt: 'Kiro' },
  { src: '/agent-icons/qwen.svg', alt: 'Qwen' },
  { src: '/agent-icons/grok-build.svg', alt: 'Grok' },
  { src: '/agent-icons/deepseek.svg', alt: 'DeepSeek' },
  { src: '/agent-icons/qoder.svg', alt: 'Qoder' },
  { src: '/agent-icons/amr.svg', alt: 'AMR' },
  { src: '/agent-icons/kilo.svg', alt: 'Kilo' },
  { src: '/agent-icons/aider.png', alt: 'Aider' },
  { src: '/agent-icons/trae-cli.png', alt: 'Trae' },
  { src: '/agent-icons/vibe.svg', alt: 'Mistral Vibe' },
  { src: '/agent-icons/mimo.svg', alt: 'MiMo' },
  { src: '/agent-icons/antigravity.svg', alt: 'Antigravity' },
  { src: '/agent-icons/reasonix.svg', alt: 'Reasonix' },
];

/**
 * Question / answer pair for the visible homepage FAQ. The exact same
 * shape is consumed by the FAQPage JSON-LD in `pages/index.astro`, so
 * the two stay in lockstep: every schema entry has a visible answer on
 * the page (which Google requires for the rich result to be eligible).
 */
export interface HomeFaqEntry {
  q: string;
  a: string;
}

interface PageProps {
  /**
   * Live counts from the Markdown catalogs. Required: every visible
   * "X skills / Y systems" claim on the page reads from here so meta,
   * nav, hero copy, capability cards, labs pills, selected-work
   * fractions, and the footer Library never disagree.
   */
  counts: HeaderProps['counts'] & {
    /** Optional richer breakdown used by the Labs filter pills. */
    byMode?: Readonly<Record<string, number>>;
    byPlatform?: Readonly<Record<string, number>>;
  };
  github: {
    starsLabel: string;
    versionLabel: string;
  };
  /**
   * FAQ pairs the page renders above the contact section. Required so
   * the structured-data block on `/` can reference visible content
   * verbatim — see `FAQ Rules` in `growth/seo-opendesigner-analysis.md`.
   */
  faq: ReadonlyArray<HomeFaqEntry>;
  /** Locale for shared chrome, topbar language links, and localized FAQ text. */
  locale?: LandingLocaleCode;
}

/**
 * Format a count for inline editorial copy. Returns the live value when
 * positive (so a fresh `git pull` immediately reflects the new totals),
 * falls back to a neutral em-dash when the catalog couldn't be read so
 * we never publish "0 skills" to a visitor by mistake.
 */
function fmt(n: number | undefined): string {
  return typeof n === 'number' && n > 0 ? String(n) : '—';
}

/** Two-digit padded count for the Labs pills (matches the "04", "27" feel). */
function pad2(n: number | undefined): string {
  if (typeof n !== 'number' || n <= 0) return '—';
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The ABOUT statement, rendered as a Magic UI / Inspira "Text Scroll Reveal":
 * each token starts faint and brightens to full ink as the reader scrolls
 * through the pinned section (opacity driven by `enhanceStatementReveal` in
 * `pages/index.astro`). Kept as one continuous wrapped paragraph.
 */
const ABOUT_STATEMENT =
  '2026 年 4 月，Claude Design 首次证明 LLM 能真正做设计，不是写文章，是直接产出设计稿。' +
  ' 但它闭源、付费、只跑在云端，模型锁 Anthropic，换 Agent、自部署、BYOK 全做不到。' +
  ' Open Design 让这套能力变得开放。';

/**
 * Splits reveal copy into per-token spans. CJK characters/punctuation become
 * individual tokens (so they light up one at a time, since CJK has no word
 * spaces), runs of Latin letters/digits stay whole, and ASCII spaces are kept
 * as literal separators so Latin words don't run together when they wrap.
 */
const CJK_TOKEN = /[぀-ヿ㐀-鿿　-〿＀-￯]/;
function tokenizeReveal(
  text: string,
): Array<{ type: 'word'; value: string } | { type: 'space' }> {
  const tokens: Array<{ type: 'word'; value: string } | { type: 'space' }> = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      tokens.push({ type: 'word', value: buf });
      buf = '';
    }
  };
  for (const ch of text) {
    if (ch === ' ') {
      flush();
      tokens.push({ type: 'space' });
    } else if (CJK_TOKEN.test(ch)) {
      flush();
      tokens.push({ type: 'word', value: ch });
    } else {
      buf += ch;
    }
  }
  flush();
  return tokens;
}

export default function Page({
  counts,
  github,
  faq,
  locale = DEFAULT_LOCALE,
}: PageProps) {
  const skills = fmt(counts.skills);
  const systems = fmt(counts.systems);
  const deckCount = pad2(counts.byMode?.deck);
  const prototypeCount = pad2(counts.byMode?.prototype);
  const mobileCount = pad2(counts.byPlatform?.mobile);
  const commonCopy = getCommonCopy(locale);
  const home = getHomePageCopy(locale);
  const localeDef = getLocaleDefinition(locale);
  const localeOptions = LANDING_LOCALES.map((entry) => ({
    ...entry,
    href: localePath(entry.code, '/'),
  }));
  const href = (path: string) => localizedHref(path, locale);

  /**
   * Capability cards. The zh homepage renders the five-step flow verbatim
   * (eyebrow "Step N — 名称" + description), reusing the card-1 layout. Other
   * locales keep the original four feature cards driven by i18n copy.
   */
  const capabilityCards: ReadonlyArray<{
    num: React.ReactNode;
    title?: React.ReactNode;
    body: React.ReactNode;
    icon: React.ReactNode;
    href: string;
    aria: string;
  }> =
    locale === 'zh'
      ? [
          {
            num: 'Step 1 — 选择起点',
            body: '一句话描述目标，或从模板 / Plugin 直接选起点。',
            icon: capIcon.search,
            href: REPO_SKILLS,
            aria: '选择起点',
          },
          {
            num: 'Step 2 — 确定视觉方向',
            body: '选定方向后，色板、字体、间距自动带入生成流程。',
            icon: capIcon.direction,
            href: REPO_SKILLS,
            aria: '确定视觉方向',
          },
          {
            num: 'Step 3 — 生成 Artifact',
            body: 'Agent 读取所有 context，产出真实可运行的文件，沙盒内即时预览和修改。',
            icon: capIcon.grid,
            href: REPO_DAEMON,
            aria: '生成 Artifact',
          },
          {
            num: 'Step 4 — 交付或制作视频',
            body: '导出给工程继续开发，或用 HyperFrames 直接转为营销视频。',
            icon: capIcon.adapters,
            href: REPO,
            aria: '交付或制作视频',
          },
          {
            num: 'Step 5 — 记忆沉淀',
            body: '每次选择都成为下次生成的上下文，越用越精准。',
            icon: capIcon.layers,
            href: REPO,
            aria: '记忆沉淀',
          },
        ]
      : home.capabilities.cards.map((card, index) => {
          const icons = [capIcon.search, capIcon.grid, capIcon.adapters, capIcon.layers];
          const hrefs = [REPO_SKILLS, REPO_SKILLS, REPO_DAEMON, REPO];
          return {
            num: (
              <>
                {`0${index + 1}`}
                <span className='tag'>{card.tag}</span>
              </>
            ),
            title: <BreakText text={card.title} />,
            body: card.body(skills, systems),
            icon: icons[index] ?? capIcon.search,
            href: hrefs[index] ?? REPO,
            aria: card.aria,
          };
        });

  /**
   * Deck-preview art for the Labs product-window showcase. Language-neutral —
   * each Dock mode maps onto one of these images (cycling), and the active
   * slide reuses the first. `labFallback` keeps the typed access non-optional
   * under `noUncheckedIndexedAccess`.
   */
  const labArtifacts = [
    '/lab-cards/card-1.png',
    '/lab-cards/card-2.png',
    '/lab-cards/card-3.png',
    '/lab-cards/card-4.png',
    '/lab-cards/card-5.png',
    '/lab-cards/card-6.png',
  ];
  const labActive = labArtifacts[0] ?? '';

  return (
    <>
      <div className='shell'>
        {/* ====== STICKY CHROME ====== */}
        <div className='site-chrome' data-chrome-headroom>
        {/* ====== NAV ====== */}
        {/* Headroom slide handled by `.site-chrome` wrapper above. */}
        <Header
          counts={counts}
          github={github}
          locale={locale}
          localeSwitcher={{
            label: commonCopy.topbar.languageSwitcherLabel,
            prefix: commonCopy.topbar.languageSwitcherPrefix ?? 'Lang',
            shortLabel: localeDef.shortLabel,
            options: localeOptions,
          }}
        />
        </div>{/* /site-chrome */}

        {/* ====== HERO ====== */}
        <section className='hero' id='top' data-od-id='hero'>
          {/* Full-bleed hero backdrop. Covers the whole first screen behind
              the copy; the design-canvas artwork bleeds edge to edge while
              the headline/CTAs sit on top via the grid's higher stacking. */}
          <img
            className='hero-bg'
            src={heroImage}
            srcSet={heroImageSrcset}
            sizes='100vw'
            width={2880}
            height={1912}
            alt=''
            aria-hidden='true'
            fetchPriority='high'
            decoding='async'
          />
          <div className='container hero-grid'>
            <div className='hero-copy'>
              <div className='hero-actions' data-reveal>
                <a className='btn btn-primary' href={REPO} {...ext}>
                  {home.hero.star}
                  <span className='arrow'>{arrowOut}</span>
                </a>
                <a className='btn btn-ghost' href={REPO_RELEASES} {...ext}>
                  {home.hero.download}
                  <span className='arrow'>{arrowPlus}</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ====== ABOUT ====== */}
        <section className='about' data-od-id='about'>
          <div className='container'>
            <div className='about-grid'>
              <div className='about-copy' data-reveal>
                <p className='about-kicker'>为什么选择 Open Design？</p>
                {/*
                  Text Scroll Reveal (Magic UI / Inspira port): a tall track
                  with a sticky, vertically-centered paragraph whose tokens
                  brighten one by one as the reader scrolls. `data-about-reveal`
                  is the scroll host; `enhanceStatementReveal` in
                  `pages/index.astro` maps scroll progress → per-token opacity.
                */}
                <div className='about-reveal' data-about-reveal>
                  <div className='about-reveal-sticky'>
                    <h2 className='display about-reveal-text'>
                      {tokenizeReveal(ABOUT_STATEMENT).map((tok, i) =>
                        tok.type === 'space' ? (
                          <span className='reveal-space' key={i}>
                            {' '}
                          </span>
                        ) : (
                          <span className='reveal-word' data-reveal-word key={i}>
                            {tok.value}
                          </span>
                        ),
                      )}
                    </h2>
                  </div>
                </div>
                <div className='about-tabs' data-reveal>
                  <input
                    type='radio'
                    name='about-tab'
                    id='about-tab-1'
                    className='about-tab-radio'
                    defaultChecked
                  />
                  <input
                    type='radio'
                    name='about-tab'
                    id='about-tab-2'
                    className='about-tab-radio'
                  />
                  <input
                    type='radio'
                    name='about-tab'
                    id='about-tab-3'
                    className='about-tab-radio'
                  />
                  <div className='about-tablist' role='tablist'>
                    <label className='about-tab' htmlFor='about-tab-1'>
                      桌面端原生
                    </label>
                    <label className='about-tab' htmlFor='about-tab-2'>
                      不造 Agent，接入 Agent
                    </label>
                    <label className='about-tab' htmlFor='about-tab-3'>
                      越用越懂你
                    </label>
                  </div>
                  <div className='about-panels'>
                    <div className='about-panel'>
                      <p>
                        设计在桌面端发生。本地文件、Figma 导出、代码仓库直接可读，Agent 拥有终端执行全部能力。
                      </p>
                    </div>
                    <div className='about-panel'>
                      <p>
                        你电脑上的 Claude Code / Codex / Cursor 已经够强。OD 做的是把它们接进完整设计工作流。
                      </p>
                    </div>
                    <div className='about-panel'>
                      <p>
                        每次选择都沉淀为 Design System、偏好和记忆，下次生成更接近你要的结果。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====== CAPABILITIES ====== */}
        <section
          className='capabilities'
          id='agents'
          data-od-id='capabilities'
        >
          <div className='container'>
            <div className='capabilities-grid'>
              <div className='capabilities-copy' data-reveal>
                <div className='capabilities-head'>
                  <h2 className='display'>
                    {locale === 'zh' ? (
                      '从想法到交付，轻松搞定'
                    ) : (
                      <>
                        {home.capabilities.titlePrefix}{' '}
                        <em>{home.capabilities.titleEmphasis}</em>{' '}
                        {home.capabilities.titleSuffix}
                        <span className='dot'>.</span>
                      </>
                    )}
                  </h2>
                  <p className='lead'>{home.capabilities.lead}</p>
                </div>
                <div className='cards cards-stack'>
                  {capabilityCards.map((card, index) => (
                    <div
                      className='card'
                      key={index}
                      style={{ ['--i' as string]: index } as React.CSSProperties}
                    >
                      <div className='num'>{card.num}</div>
                      {card.icon}
                      {card.title ? <h3>{card.title}</h3> : null}
                      <p>{card.body}</p>
                      <a
                        className='arrow-mark'
                        href={card.href}
                        aria-label={card.aria}
                        {...ext}
                      >
                        {arrowOut}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====== LABS ====== */}
        <section className='labs' id='labs' data-od-id='labs'>
          <div className='container'>
            <div className='labs-head'>
              <div data-reveal>
                <h2 className='display'>
                  用 <em>Open Design</em> 能产出什么
                  <span className='dot'>？</span>
                </h2>
              </div>
            </div>
            {/* Labs — the Open Design product window (deck editor) on a
                full-bleed canvas, with the mode Dock floating over its lower
                edge. The deck preview swaps with the Dock (enhancer in
            `pages/index.astro`); all preview art reuses the lab images. */}
            <div className='lab-stage' data-reveal>
              <div className='lab-app'>
                {/* window tab strip */}
                <div className='la-tabs'>
                  <span className='la-tab'>
                    <svg viewBox='0 0 24 24'><path d='M4 11l8-6 8 6' /><path d='M6 10v9h12v-9' /></svg>
                    主页
                  </span>
                  <span className='la-tab is-active'>
                    <svg viewBox='0 0 24 24'><path d='M4 7h5l2 2h9v9H4z' /></svg>
                    Simple Deck
                    <svg className='la-x' viewBox='0 0 24 24'><path d='M7 7l10 10M17 7L7 17' /></svg>
                  </span>
                </div>
                {/* document toolbar */}
                <div className='la-bar'>
                  <span className='la-back' aria-hidden='true'>{arrowBack}</span>
                  <span className='la-name'>Simple Deck</span>
                  <span className='la-pill'>自由设计</span>
                  <span className='la-theme'>
                    <span className='la-dot' aria-hidden='true'></span>
                    Neutral Modern
                    <span className='la-cv' aria-hidden='true'></span>
                  </span>
                  <span className='la-bar-gap'></span>
                  <button type='button' className='la-act'>
                    <svg viewBox='0 0 24 24'><rect x='3' y='5' width='18' height='12' rx='1.5' /><path d='M9 21h6M12 17v4' /></svg>
                    演示<span className='la-cv' aria-hidden='true'></span>
                  </button>
                  <button type='button' className='la-act primary'>
                    <svg viewBox='0 0 24 24'><path d='M12 14V4M9 7l3-3 3 3' /><path d='M6 13v5h12v-5' /></svg>
                    分享<span className='la-cv la-cv-light' aria-hidden='true'></span>
                  </button>
                  <button type='button' className='la-act'>
                    <svg viewBox='0 0 24 24'><path d='M8 6l10 6-10 6z' /></svg>
                    交付给 Cursor<span className='la-cv' aria-hidden='true'></span>
                  </button>
                </div>
                {/* body: chat transcript + deck preview */}
                <div className='la-body'>
                  <aside className='la-chat'>
                    <div className='la-chat-q'>帮我做一个关于后印象派的风格…</div>
                    <p className='la-chat-p'>第 10 页已收紧，视觉复盘现在没有低于 3 分的维度。我会再跑一轮最终文件检查。</p>
                    <div className='la-run'>
                      <span className='la-mono'>$</span> 运行 ×3, 完成
                      <span className='la-run-chev'>›</span>
                    </div>
                    <p className='la-chat-p'>最终检查完成：12 页、12 组演讲备注、主题节奏合格、导航脚本关键项完整。我会读取最终 <code>index.html</code> 内容并作为新建 PPT artifact 交付。</p>
                    <div className='la-bash'>
                      <div className='la-bash-top'>
                        <span className='la-mono'>$</span> Bash
                        <span className='la-tag la-tag-ok'>完成</span>
                        <span className='la-tag'>输出</span>
                      </div>
                      <code className='la-bash-cmd'>/bin/zsh -lc &apos;cat index.html&apos;</code>
                    </div>
                    <p className='la-chat-p'>已完成 <code>index.html</code>，12 页横向滑动 PPT，含塞尚重点页和每页演讲备注；已通过结构、主题节奏和脚本静态检查。</p>
                    <div className='la-file'>
                      <div className='la-file-head'>本轮产出的文件</div>
                      <div className='la-file-row'>
                        <svg viewBox='0 0 24 24'><path d='M7 3h7l4 4v14H7z' /><path d='M14 3v4h4' /></svg>
                        <b>index.html</b>
                        <span className='la-file-size'>30.9 KB</span>
                        <span className='la-file-btn'>打开</span>
                        <span className='la-file-btn'>下载</span>
                      </div>
                    </div>
                    <div className='la-done'>
                      <span className='la-done-dot' aria-hidden='true'></span>
                      已完成 10m 33s · 24445 输出
                    </div>
                    <div className='la-composer'>描述你想生成的内容…</div>
                  </aside>
                  <div className='la-doc'>
                    <div className='la-doc-tabs'>
                      <span className='la-doc-tab'>
                        <svg viewBox='0 0 24 24'><rect x='4' y='4' width='7' height='7' /><rect x='13' y='4' width='7' height='7' /><rect x='4' y='13' width='7' height='7' /><rect x='13' y='13' width='7' height='7' /></svg>
                        设计文件
                      </span>
                      <span className='la-doc-tab is-active'>
                        <svg viewBox='0 0 24 24'><path d='M7 3h7l4 4v14H7z' /><path d='M14 3v4h4' /></svg>
                        index.html
                        <svg className='la-x' viewBox='0 0 24 24'><path d='M7 7l10 10M17 7L7 17' /></svg>
                      </span>
                    </div>
                    <div className='la-doc-bar'>
                      <span className='la-seg'>预览<span className='la-cv' aria-hidden='true'></span></span>
                      <span className='la-seg'>桌面端<span className='la-cv' aria-hidden='true'></span></span>
                      <span className='la-seg'>100%<span className='la-cv' aria-hidden='true'></span></span>
                      <span className='la-page'>‹ 1 / 12 ›</span>
                      <span className='la-bar-gap'></span>
                      <span className='la-tool'>Themes</span>
                      <span className='la-tool'>绘制</span>
                      <span className='la-tool'>评论</span>
                      <span className='la-tool'>注释</span>
                      <span className='la-tool'>截屏</span>
                    </div>
                    <div className='la-slide' data-lab-preview>
                      <LazyImg className='la-slide-img' src={labActive} />
                      <span className='la-slide-page'>1 / 12</span>
                    </div>
                  </div>
                </div>
              </div>
            {/* Labs filter as a centered macOS-style magnifying Dock (React
                Bits "Dock", reproduced in vanilla for this SSR/no-React
                page). Proximity magnification is driven by the enhancer in
                `pages/index.astro`; the hover label is pure CSS. Icons are
                from the skill's Remix Icon font (line style). */}
            <div className='lab-dock' data-lab-dock data-reveal>
              {[
                { label: 'Prototype', href: href('/skills/mode/prototype/') },
                { label: 'Live Artifact', href: href('/skills/') },
                { label: 'Slides', href: href('/skills/mode/deck/') },
                { label: '图片', href: href('/skills/') },
                { label: 'HyperFrames', href: href('/skills/') },
                { label: '视频', href: href('/skills/') },
              ].map((item, i) => (
                <a
                  key={item.label}
                  className={i === 0 ? 'lab-dock-item active' : 'lab-dock-item'}
                  href={item.href}
                  data-dock-item
                  data-preview-src={labArtifacts[i % labArtifacts.length] ?? labActive}
                  data-preview-title={item.label}
                  aria-label={item.label}
                >
                  <span className='lab-dock-icon' aria-hidden='true'></span>
                  <span className='lab-dock-label'>{item.label}</span>
                </a>
              ))}
            </div>
            </div>{/* /lab-stage */}
          </div>
        </section>

        {/* ====== METHOD ====== */}
        <section className='method' data-od-id='method'>
          <div className='container'>
            <div className='method-head'>
              <div data-reveal>
                {locale !== 'zh' ? (
                  <span className='label'>
                    {home.method.label} <span className='ix'>· Nº 05</span>
                  </span>
                ) : null}
                <h2 className='display' style={{ marginTop: locale === 'zh' ? 0 : 30 }}>
                  {locale === 'zh' ? (
                    '接入 16+ Coding Agent，零配置'
                  ) : (
                    <>
                      {home.method.titlePrefix} <em>{home.method.titleEmphasis}</em>{' '}
                      {home.method.titleSuffix}
                      <span className='dot'>.</span>
                    </>
                  )}
                </h2>
              </div>
              <div className='right' data-reveal='right'>
                <span className='plus'>+</span>
                <p>{home.method.lead}</p>
              </div>
            </div>
            {locale === 'zh' ? (
              /* FallingText (React Bits, matter-js) — the coding-agent names
                 drop into a physics playground on hover; driven by the
                 `initFallingText` enhancer in `pages/index.astro`. Replaces the
                 four collage images that used to sit here. */
              <div
                className='falling-text'
                data-falling-text
                data-trigger='scroll'
                data-gravity='0.9'
                data-stiffness='0.9'
              >
                <div className='falling-text-target'>
                  {FALLING_ICONS.map((icon, index) => (
                    <span className='falling-word falling-chip' key={`${icon.alt}-${index}`}>
                      <img src={icon.src} alt={icon.alt} loading='lazy' decoding='async' />
                    </span>
                  ))}
                </div>
                <div className='falling-text-canvas' aria-hidden='true' />
              </div>
            ) : (
              <div className='method-grid'>
                {[
                  {
                    num: '01',
                    title: home.method.steps[0].title,
                    body: home.method.steps[0].body(skills, systems),
                    src: imageAsset('method-1.png', { width: 816, quality: 82 }),
                  },
                  {
                    num: '02',
                    title: home.method.steps[1].title,
                    body: home.method.steps[1].body(skills, systems),
                    src: imageAsset('method-2.png', { width: 816, quality: 82 }),
                  },
                  {
                    num: '03',
                    title: home.method.steps[2].title,
                    body: home.method.steps[2].body(skills, systems),
                    src: imageAsset('method-3.png', { width: 816, quality: 82 }),
                  },
                  {
                    num: '04',
                    title: home.method.steps[3].title,
                    body: home.method.steps[3].body(skills, systems),
                    src: imageAsset('method-4.png', { width: 816, quality: 82 }),
                  },
                ].map((step) => (
                  <div className='method-step' key={step.num} data-reveal>
                    <div className='num'>{step.num}</div>
                    <h4>
                      {step.title} <span className='arrow-r'>→</span>
                    </h4>
                    <p>{step.body}</p>
                    <div className='img'>
                      <LazyImg src={step.src} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ====== TESTIMONIAL / COLLABORATORS ====== */}
        <section className='testimonial' data-od-id='testimonial'>
          <div className='container'>
            <div className={`testimonial-grid${locale === 'zh' ? ' with-globe' : ''}`}>
              <div className='testimonial-copy' data-reveal>
                {locale !== 'zh' ? (
                  <span className='label'>
                    {home.testimonial.label} <span className='ix'>· Nº 06</span>
                  </span>
                ) : null}
                <h2 style={{ marginTop: 30 }}>
                  {home.testimonial.quote}
                </h2>
                {locale === 'zh' ? (
                  <a
                    className='btn btn-ghost'
                    href={REPO_CONTRIBUTORS}
                    style={{ marginTop: 28 }}
                    {...ext}
                  >
                    查看全部贡献者
                    <span className='arrow'>{arrowOut}</span>
                  </a>
                ) : (
                  <a className='read-more' href={REPO} {...ext}>
                    {home.testimonial.readMore}
                  </a>
                )}
              </div>
              {locale === 'zh' ? (
                <div className='testimonial-globe' data-reveal='right' data-testimonial-globe>
                  <canvas
                    aria-label='Open Design global contributor map'
                    className='testimonial-globe-canvas'
                    height={720}
                    width={720}
                  />
                  {/* Contributor avatars orbiting the globe (no spokes). The
                      ring spins; each avatar counter-spins to stay upright.
                      Populated client-side from the GitHub contributors API
                      by `enhanceContributorOrbit` in pages/index.astro. */}
                  <div
                    className='contributor-orbit'
                    data-contributor-orbit
                    aria-hidden='true'
                  />
                </div>
              ) : (
                <div className='testimonial-art' data-reveal='right'>
                  <LazyImg src={imageAsset('testimonial.png', { width: 1024, quality: 82 })} />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ====== SELECTED WORK ====== */}
        <section className='tight' data-od-id='work'>
          <div className='work'>
            {locale === 'zh' ? (
              <div className='work-stats-grid' data-reveal>
                {[
                  { src: 'card-1.png', num: '52K+', to: '52', suffix: 'K+', alt: 'GitHub Stars', href: REPO },
                  { src: 'card-2.png', num: '280+', to: '280', suffix: '+', alt: '贡献者', href: `${REPO}/graphs/contributors` },
                  { src: 'card-3.png', num: '217+', to: '217', suffix: '+', alt: 'Plugins', href: href('/plugins/') },
                  { src: 'card-4.png', num: '129+', to: '129', suffix: '+', alt: 'Design Systems', href: href('/systems/') },
                  { src: 'card-5.png', num: '16', to: '16', suffix: '', alt: 'Coding Agent 支持', href: REPO },
                  { src: 'card-6.png', num: null, to: null, suffix: '', alt: 'Star us', href: REPO, cta: true },
                ].map((item, index) => (
                  <a
                    className={`work-stat-card work-img-card${item.cta ? ' work-stat-card-cta' : ''}`}
                    href={item.href}
                    key={item.src}
                    style={{ '--tilt': `${[-1.2, 1.4, -0.6, 0.9, -1, 1.1][index]}deg` } as React.CSSProperties}
                    {...(item.href.startsWith('http') ? ext : {})}
                  >
                    <LazyImg src={`/work-cards/${item.src}`} alt={item.alt} />
                    <h3 className='work-stat-overlay'>
                      {item.num ? (
                        <span
                          data-countup
                          data-countup-to={item.to}
                          data-countup-suffix={item.suffix}
                        >
                          {item.num}
                        </span>
                      ) : null}
                      <em>{item.alt}</em>
                    </h3>
                  </a>
                ))}
              </div>
            ) : (
              <div className='work-grid'>
                <div className='work-copy' data-reveal>
                  <span className='label'>{home.work.label}</span>
                  <h2>
                    {home.work.titlePrefix} <em>{home.work.titleEmphasisA}</em>{' '}
                    {home.work.titleMiddle} <em>{home.work.titleEmphasisB}</em>{' '}
                    {home.work.titleSuffix}
                    <span className='dot'>.</span>
                  </h2>
                  <a className='work-link' href={href('/skills/')}>
                    {home.work.viewAll(skills)}
                  </a>
                </div>
                <a
                  className='work-card'
                  data-reveal
                  href={`${REPO_SKILLS}/guizang-ppt`}
                  {...ext}
                >
                  <div className='label-row'>
                    <span className='small-label'>{home.work.cards[0].label}</span>
                    <span className='index'>01 / {skills}</span>
                  </div>
                  <h3>{home.work.cards[0].title}</h3>
                  <p>{home.work.cards[0].body}</p>
                  <div className='img'>
                    <LazyImg src={imageAsset('work-1.png', { width: 768, quality: 82 })} />
                  </div>
                  <div className='meta-row'>
                    <span className='year'>{home.work.cards[0].metaLeft}</span>
                    <span>{home.work.cards[0].metaRight}</span>
                  </div>
                </a>
                <a
                  className='work-card alt'
                  data-reveal
                  href={href('/skills/')}
                >
                  <div className='label-row'>
                    <span className='small-label'>{home.work.cards[1].label}</span>
                    <span className='index'>02 / {skills}</span>
                  </div>
                  <h3>{home.work.cards[1].title}</h3>
                  <p>{home.work.cards[1].body}</p>
                  <div className='img'>
                    <LazyImg src={imageAsset('work-2.png', { width: 768, quality: 82 })} />
                  </div>
                  <div className='meta-row'>
                    <span className='year'>{home.work.cards[1].metaLeft}</span>
                    <span>{home.work.cards[1].metaRight}</span>
                  </div>
                </a>
              </div>
            )}
            {locale !== 'zh' ? (
            <div className='work-arrows'>
              <button type='button' className='nav-btn'>
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.6'
                >
                  <path d='M14 6l-6 6 6 6' />
                </svg>
              </button>
              <button type='button' className='nav-btn active'>
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.6'
                >
                  <path d='M10 6l6 6-6 6' />
                </svg>
              </button>
            </div>
            ) : null}
          </div>
        </section>

        {/* ====== CTA ====== */}
        <section className='cta' id='contact' data-od-id='cta'>
          <div className='container'>
            <div className='cta-dance' data-reveal>
              <LazyImg src='/cta-dance.webp' alt='' className='cta-dance-img' />
              <div className='cta-dance-inner'>
                <h2 className='display'>
                  {locale === 'zh' ? (
                    home.cta.titlePrefix
                  ) : (
                    <>
                      {home.cta.titlePrefix} <em>{home.cta.titleOpen}</em>{' '}
                      {home.cta.titleMiddle} <em>{home.cta.titleVisual}</em>{' '}
                      {home.cta.titleSuffix}
                      <span className='dot'>.</span>
                    </>
                  )}
                </h2>
                <p className='lead'>{home.cta.lead}</p>
                <div className='cta-actions'>
                  <a className='btn btn-primary' href={REPO} {...ext}>
                    {home.cta.star}
                    <span className='arrow'>{arrowOut}</span>
                  </a>
                  <a className='email-pill' href={REPO_ISSUES} {...ext}>
                    {home.cta.issue}
                    <span className='arrow-circle'>→</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====== FAQ ======
         *
         * Visible answers — kept in lockstep with the FAQPage JSON-LD
         * defined in `app/pages/index.astro`. Each entry mirrors the
         * `q`/`a` pair, so the structured data describes content the
         * user actually sees (Google's rich-result eligibility rule).
        */}
        <section className='faq' id='faq' data-od-id='faq'>
          <div className='container'>
            <div className='faq-layout'>
              <div className='faq-head' data-reveal>
                {locale === 'zh' ? (
                  <h2 className='display'>常见问题</h2>
                ) : (
                  <>
                    <span className='label'>
                      {home.faqSection.label} <span className='ix'>· Nº 06.5</span>
                    </span>
                    <h2 className='display'>
                      {home.faqSection.titlePrefix} <em>Open Design</em>,{' '}
                      <em>OpenDesign</em>, {home.faqSection.titleMiddle}{' '}
                      <em>{home.faqSection.titleSuffix}</em>
                      <span className='dot'>.</span>
                    </h2>
                  </>
                )}
              </div>
              <ol className='faq-list'>
                {faq.map(({ q, a }, idx) => (
                  <li className='faq-item' key={q} data-reveal>
                    <details>
                      <summary>
                        <span className='faq-index'>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className='faq-q'>{q}</span>
                        <span className='faq-toggle' aria-hidden='true'>
                          +
                        </span>
                      </summary>
                      <p className='faq-a'>{a}</p>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ====== FOOTER ====== */}
        <footer data-od-id='footer'>
          <div className='container'>
            <div className='foot-grid'>
              <div className='foot-brand'>
                <a href='#top' className='brand'>
                  <img
                    className='brand-logo'
                    src='/logo-lockup.svg'
                    alt='Open Design'
                    width={225}
                    height={83}
                  />
                </a>
                <p style={{ marginTop: 18 }}>
                  {home.footer.summary}
                </p>
                <a
                  className='foot-cta'
                  href={REPO_RELEASES}
                  aria-label={home.footer.downloadAria}
                  {...ext}
                >
                  {home.footer.download}
                  <span className='meta'>
                    macOS · <span data-github-version>{github.versionLabel}</span>
                  </span>
                </a>
              </div>
              {locale === 'zh' ? (
                <>
                  <div className='foot-col'>
                    <h5>产品</h5>
                    <ul>
                      <li><a href={REPO_RELEASES} {...ext}>Download</a></li>
                      <li><a href={href('/plugins/')}>Plugins</a></li>
                      <li><a href={href('/systems/')}>Design Systems</a></li>
                      <li><a href={href('/blog/')}>Blog</a></li>
                    </ul>
                  </div>
                  <div className='foot-col'>
                    <h5>社区</h5>
                    <ul>
                      <li><a href={REPO} {...ext}>GitHub</a></li>
                      <li><a href={DISCORD} {...ext}>Discord</a></li>
                      <li><a href='https://x.com/nexudotio' {...ext}>X (@nexudotio)</a></li>
                      <li><a href='https://www.youtube.com/' {...ext}>Youtube</a></li>
                      <li><a href='https://www.bilibili.com/' {...ext}>Bilibili</a></li>
                    </ul>
                  </div>
                  <div className='foot-col'>
                    <h5>法律</h5>
                    <ul>
                      <li><a href={`${REPO}/blob/main/LICENSE`} {...ext}>Apache-2.0 License</a></li>
                      <li><a href={href('/privacy/')}>Privacy</a></li>
                      <li><a href={href('/terms/')}>Terms</a></li>
                    </ul>
                  </div>
                  <div className='foot-col'>
                    <h5>伙伴</h5>
                    <ul>
                      <li><a href='https://github.com/amr' {...ext}>AMR</a></li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
              <div className='foot-col'>
                <h5>{home.footer.columns.studio}</h5>
                <ul>
                  <li>
                    <a href='#agents'>{home.footer.studioLinks[0]}</a>
                  </li>
                  <li>
                    <a href='#labs'>{home.footer.studioLinks[1]}</a>
                  </li>
                  <li>
                    <a href={REPO_DAEMON} {...ext}>
                      {home.footer.studioLinks[2]}
                    </a>
                  </li>
                  <li>
                    <a href={REPO} {...ext}>
                      {home.footer.studioLinks[3]}
                    </a>
                  </li>
                </ul>
              </div>
              <div className='foot-col'>
                <h5>{home.footer.columns.library}</h5>
                <ul>
                  <li>
                    <a href={href('/skills/')}>
                      {home.footer.libraryLinks.skills(skills)}
                    </a>
                  </li>
                </ul>
              </div>
              <div className='foot-col'>
                <h5>{home.footer.columns.connect}</h5>
                <ul>
                  <li>
                    <a href={REPO} {...ext}>
                      {home.footer.connectLinks[0]}
                    </a>
                  </li>
                  <li>
                    <a href={REPO_ISSUES} {...ext}>
                      {home.footer.connectLinks[1]}
                    </a>
                  </li>
                  <li>
                    <a href={REPO_CONTRIBUTORS} {...ext}>
                      {home.footer.connectLinks[2]}
                    </a>
                  </li>
                  <li>
                    <a href={REPO_RELEASES} {...ext}>
                      {home.footer.connectLinks[3]}
                    </a>
                  </li>
                  <li>
                    <a href={DISCORD} {...ext}>
                      {home.footer.connectLinks[4]}
                    </a>
                  </li>
                </ul>
              </div>
              <div className='foot-col'>
                <h5>{home.footer.columns.openDesign}</h5>
                <ul>
                  <li>
                    <a href={href('/official/')}>
                      {home.footer.openDesignLinks.official}
                    </a>
                  </li>
                  <li>
                    <a href={href('/quickstart/')}>
                      {home.footer.openDesignLinks.quickstart}
                    </a>
                  </li>
                  <li>
                    <a href={href('/agents/')}>
                      {home.footer.openDesignLinks.agents}
                    </a>
                  </li>
                  <li>
                    <a href={href('/compare/')}>
                      {home.footer.openDesignLinks.compare}
                    </a>
                  </li>
                  <li>
                    <a href={href('/alternatives/claude-design/')}>
                      {home.footer.openDesignLinks.alternative}
                    </a>
                  </li>
                </ul>
              </div>
                </>
              )}
            </div>
            <div className='foot-mega'>
              <div className='word' data-reveal='rise-lg'>
                {(() => {
                  const parts = home.footer.mega.split('Design');
                  if (parts.length !== 2) return home.footer.mega;
                  return (
                    <>
                      {parts[0]}
                      <span style={{ color: 'var(--coral)' }}>Design</span>
                      {parts[1]}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </footer>
      </div>
      {/*
        Page-level progressive Gaussian blur pinned to the bottom edge
        (React Bits "Gradual Blur", SSR port). Restores the backdrop blur
        that a plain `.page-bottom-fade` white gradient had replaced.
      */}
      <GradualBlur
        target='page'
        position='bottom'
        height='8rem'
        strength={5}
        divCount={10}
        opacity={1}
        curve='linear'
        exponential
      />
    </>
  );
}

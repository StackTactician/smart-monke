/**
 * Smart Monke — Shared utilities
 */

// ── Nav active link ──────────────────────────────────────────────
(function () {
  const links = document.querySelectorAll('.nav__links a');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && window.location.pathname.endsWith(href)) {
      link.classList.add('active');
    }
  });
})();

// ── Back to top button ───────────────────────────────────────────
(function () {
  const btn = document.createElement('button');
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '↑';
  document.body.appendChild(btn);

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ── Scroll progress bar (post pages only) ────────────────────────
(function () {
  if (!document.querySelector('.post-page')) return;

  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.prepend(bar);

  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY;
    const total    = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = total > 0 ? `${(scrolled / total) * 100}%` : '0%';
  }, { passive: true });
})();

// ── Card scroll reveal (IntersectionObserver) ─────────────────────
function observeCards(selector = '.post-card') {
  const cards = document.querySelectorAll(selector);
  if (!cards.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  cards.forEach((card, i) => {
    // Stagger delay via inline style
    card.style.animationDelay = `${i * 0.07}s`;
    observer.observe(card);
  });
}

// ── Posts API ────────────────────────────────────────────────────
const Posts = {
  _cache: null,       // array of published post metadata, newest first
  _bySlug: null,      // Map<slug, { meta, body }>, includes drafts

  // Splits "---\nkey: value\n---\nbody..." into { meta, body }.
  // Kept intentionally simple (single-line scalar values only) since
  // there's no build step to bring in a real YAML parser.
  _parseFrontMatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: raw };

    const [, frontMatter, body] = match;
    const meta = {};
    frontMatter.split('\n').forEach(line => {
      const line_match = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (!line_match) return;
      let [, key, value] = line_match;
      value = value.trim().replace(/^["']|["']$/g, '');
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      meta[key] = value;
    });
    return { meta, body: body.trim() };
  },

  async _loadIndex() {
    const res = await fetch('posts/posts.json');
    if (!res.ok) throw new Error('Could not load posts.json');
    return res.json(); // array of slugs, e.g. ["hello-world", "why-vanilla-js"]
  },

  async _loadAll() {
    if (this._bySlug) return this._bySlug;

    const slugs = await this._loadIndex();
    const entries = await Promise.all(slugs.map(async slug => {
      const res = await fetch(`posts/${slug}.md`);
      if (!res.ok) throw new Error(`Could not load posts/${slug}.md`);
      const raw = await res.text();
      const { meta, body } = this._parseFrontMatter(raw);
      return [slug, { meta: { slug, ...meta }, body }];
    }));

    this._bySlug = new Map(entries);
    return this._bySlug;
  },

  async getAll() {
    if (this._cache) return this._cache;
    const all = await this._loadAll();

    this._cache = [...all.values()]
      .map(entry => entry.meta)
      .filter(meta => !meta.draft)
      .sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));

    return this._cache;
  },

  async get(slug) {
    const all = await this._loadAll();
    return all.get(slug)?.meta ?? null;
  },

  async getContent(slug) {
    const all = await this._loadAll();
    const entry = all.get(slug);
    if (!entry) throw new Error(`Post "${slug}" not found`);
    return entry.body;
  },
};

// ── Markdown → HTML ──────────────────────────────────────────────
function renderMarkdown(md) {
  if (window.marked) {
    window.marked.setOptions({ breaks: true, gfm: true });
    return window.marked.parse(md);
  }
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<)(.+)$/gm, '<p>$1</p>');
}

// ── Date formatter ───────────────────────────────────────────────
// Accepts "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" (treated as WAT wall-clock time,
// not converted — West Africa Time has no DST so this is safe).
function formatDate(value) {
  const [datePart, timePart] = String(value).trim().split(/\s+/);
  const date = new Date(`${datePart}T00:00:00`);

  const dateStr = date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  if (!timePart) return dateStr;

  return `${dateStr}, ${timePart} WAT`;
}

// ── Reading time ─────────────────────────────────────────────────
function readingTime(text) {
  const words = text.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

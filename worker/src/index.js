/**
 * Smart Monke Publisher — Cloudflare Worker
 *
 * Receives POST /publish requests from the /write frontend,
 * formats the YAML front matter and Markdown file, updates posts/posts.json,
 * and commits the changes atomically to GitHub using the GitHub Git Data API.
 */

export default {
  async fetch(request, env, ctx) {
    // ── Handle CORS Preflight ───────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(env),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    // ── Health / Status Check ──────────────────────────────────────
    if (request.method === 'GET' && (path === '' || path === '/health' || path === '/status')) {
      return jsonResponse({
        status: 'ok',
        name: 'smart-monke-publisher',
        repository: `${env.GITHUB_OWNER || 'StackTactician'}/${env.GITHUB_REPO || 'smart-monke'}`,
        branch: env.GITHUB_BRANCH || 'main',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }, 200, env);
    }

    // ── Verify Auth Key ────────────────────────────────────────────
    if ((request.method === 'POST' || request.method === 'GET') && path === '/verify') {
      const auth = checkAuth(request, env);
      if (!auth.authorized) {
        return jsonResponse({ valid: false, error: auth.error }, 401, env);
      }
      return jsonResponse({ valid: true, message: 'Authentication successful.' }, 200, env);
    }

    // ── Publish Post ───────────────────────────────────────────────
    if (request.method === 'POST' && (path === '/publish' || path === '/api/publish' || path === '')) {
      return handlePublish(request, env);
    }

    return jsonResponse({ error: `Not found: ${request.method} ${url.pathname}` }, 404, env);
  }
};

// ── Auth Check ────────────────────────────────────────────────────
function checkAuth(request, env) {
  if (!env.PUBLISH_SECRET) {
    return { authorized: false, error: 'Server misconfiguration: PUBLISH_SECRET environment variable is missing.' };
  }

  const authHeader = request.headers.get('Authorization');
  const customHeader = request.headers.get('x-publish-key');
  const token = (authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '') || (customHeader ? customHeader.trim() : '');

  if (!token) {
    return { authorized: false, error: 'Unauthorized: Missing publishing key in Authorization header or x-publish-key.' };
  }

  if (token !== env.PUBLISH_SECRET.trim()) {
    return { authorized: false, error: 'Unauthorized: Invalid publishing key.' };
  }

  return { authorized: true };
}

// ── Publish Handler ───────────────────────────────────────────────
async function handlePublish(request, env) {
  // 1. Verify authorization
  const auth = checkAuth(request, env);
  if (!auth.authorized) {
    return jsonResponse({ error: auth.error }, 401, env);
  }

  // 2. Verify server environment
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: 'Server misconfiguration: GITHUB_TOKEN environment secret is missing.' }, 500, env);
  }

  const owner = env.GITHUB_OWNER || 'StackTactician';
  const repo = env.GITHUB_REPO || 'smart-monke';
  const branch = env.GITHUB_BRANCH || 'main';

  // 3. Parse and validate payload
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed JSON payload.' }, 400, env);
  }

  const title = (payload.title || '').trim();
  const content = (payload.content || '').trim();
  const tag = (payload.tag || 'ramble').trim().toLowerCase();
  const author = (payload.author || 'You').trim();
  const draft = Boolean(payload.draft);
  const overwrite = Boolean(payload.overwrite);

  if (!title) {
    return jsonResponse({ error: 'Post title is required.' }, 400, env);
  }
  if (!content) {
    return jsonResponse({ error: 'Post content is required.' }, 400, env);
  }
  if (title.length > 200) {
    return jsonResponse({ error: 'Post title is too long (maximum 200 characters).' }, 400, env);
  }

  // 4. Generate slug, date, and excerpt
  const slug = payload.slug ? slugify(payload.slug) : slugify(title);
  if (!slug) {
    return jsonResponse({ error: 'Could not generate a valid URL slug from the title.' }, 400, env);
  }

  const publishedDate = payload.publishedDate ? payload.publishedDate.trim() : formatWatDate();
  const excerpt = payload.excerpt ? payload.excerpt.trim() : generateExcerpt(content);

  // 5. GitHub API Client Helper
  async function gh(endpoint, options = {}) {
    const ghUrl = `https://api.github.com/repos/${owner}/${repo}${endpoint}`;
    const res = await fetch(ghUrl, {
      ...options,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${env.GITHUB_TOKEN.trim()}`,
        'User-Agent': 'SmartMonke-Publisher/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.message || res.statusText || 'Unknown GitHub API error';
      const error = new Error(msg);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  try {
    // 6. Step A: Get latest commit SHA on branch
    const refData = await gh(`/git/ref/heads/${branch}`);
    const headCommitSha = refData.object.sha;

    // 7. Step B: Get base tree SHA from HEAD commit
    const commitData = await gh(`/git/commits/${headCommitSha}`);
    const baseTreeSha = commitData.tree.sha;

    // 8. Step C: Fetch posts/posts.json
    let postsList = [];
    try {
      const postsJsonFile = await gh(`/contents/posts/posts.json?ref=${branch}`);
      const decodedJson = b64DecodeUnicode(postsJsonFile.content);
      postsList = JSON.parse(decodedJson);
      if (!Array.isArray(postsList)) {
        postsList = [];
      }
    } catch (err) {
      if (err.status !== 404) {
        throw new Error(`Failed to load posts/posts.json: ${err.message}`);
      }
    }

    // 9. Collision detection
    if (!overwrite) {
      if (postsList.includes(slug)) {
        return jsonResponse({
          error: `Slug collision: "${slug}" is already listed in posts/posts.json. Please choose a different title or enable overwrite.`,
          slug: slug
        }, 409, env);
      }

      try {
        await gh(`/contents/posts/${encodeURIComponent(slug)}.md?ref=${branch}`);
        return jsonResponse({
          error: `File collision: "posts/${slug}.md" already exists in the repository. Please choose a different title or enable overwrite.`,
          slug: slug
        }, 409, env);
      } catch (err) {
        if (err.status !== 404) {
          throw new Error(`Failed to verify post filename: ${err.message}`);
        }
        // 404 means the file does not exist, which is expected
      }
    }

    // 10. Update posts.json list
    // If overwrite/edit, preserve existing entries; otherwise prepend new slug to index
    if (!postsList.includes(slug)) {
      postsList = [slug, ...postsList];
    }
    const updatedPostsJson = JSON.stringify(postsList, null, 2) + '\n';

    // 11. Format full Markdown post with YAML front matter
    const fullMarkdown = formatFrontMatter({
      title,
      publishedDate,
      tag,
      author,
      excerpt,
      draft,
      content
    });

    // 12. Step D: Create Git Tree containing both the new/updated post and posts.json
    const treeData = await gh('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [
          {
            path: `posts/${slug}.md`,
            mode: '100644',
            type: 'blob',
            content: fullMarkdown
          },
          {
            path: 'posts/posts.json',
            mode: '100644',
            type: 'blob',
            content: updatedPostsJson
          }
        ]
      })
    });
    const newTreeSha = treeData.sha;

    // 13. Step E: Create atomic commit
    const actionLabel = overwrite ? 'Update' : 'Publish';
    const draftLabel = draft ? ' (draft)' : '';
    const newCommit = await gh('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: `${actionLabel} post: ${title}${draftLabel}`,
        tree: newTreeSha,
        parents: [headCommitSha]
      })
    });
    const newCommitSha = newCommit.sha;

    // 14. Step F: Update branch ref
    await gh(`/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommitSha,
        force: false
      })
    });

    // 15. Return success
    return jsonResponse({
      success: true,
      slug: slug,
      title: title,
      tag: tag,
      publishedDate: publishedDate,
      draft: draft,
      commitSha: newCommitSha,
      postUrl: `https://smartmonke.me/post.html?slug=${slug}`,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
      message: draft ? 'Draft saved to repository successfully!' : 'Post published successfully!'
    }, 201, env);

  } catch (err) {
    return jsonResponse({
      error: `GitHub publishing failed: ${err.message}`,
      status: err.status || 500
    }, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, env);
  }
}

// ── Helper Utilities ──────────────────────────────────────────────

function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')   // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '');      // strip leading and trailing hyphens
}

function generateExcerpt(content) {
  const paragraphs = content.split(/\r?\n\r?\n+/);
  for (let p of paragraphs) {
    p = p.trim();
    // Skip code blocks, quotes, or headers
    if (p.startsWith('```') || p.startsWith('>')) continue;
    p = p.replace(/^#+\s+[^\n]*/g, '').trim();
    if (!p) continue;

    // Clean markdown styling
    const clean = p
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length > 0) {
      if (clean.length <= 160) return clean;
      return clean.slice(0, 157).trim() + '...';
    }
  }
  return '';
}

function formatWatDate(d = new Date()) {
  // WAT (West Africa Time) is UTC+1 with no daylight saving time
  const watMs = d.getTime() + (1 * 60 * 60 * 1000);
  const watDate = new Date(watMs);
  const yyyy = watDate.getUTCFullYear();
  const mm = String(watDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(watDate.getUTCDate()).padStart(2, '0');
  const hh = String(watDate.getUTCHours()).padStart(2, '0');
  const min = String(watDate.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatFrontMatter({ title, publishedDate, tag, author, excerpt, draft, content }) {
  const cleanTitle = title.replace(/"/g, '\\"');
  const cleanExcerpt = excerpt.replace(/"/g, '\\"');
  return `---
title: "${cleanTitle}"
publishedDate: ${publishedDate}
tag: ${tag}
author: ${author}
excerpt: "${cleanExcerpt}"
draft: ${draft}
---

${content.trim()}
`;
}

function b64DecodeUnicode(str) {
  const cleanStr = str.replace(/\s/g, '');
  const binary = atob(cleanStr);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getCorsHeaders(env) {
  const allowedOrigin = env?.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-publish-key',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, env = null) {
  return new Response(JSON.stringify(data, null, 2) + '\n', {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(env),
    },
  });
}

# Smart Monke Publishing Worker

A serverless Cloudflare Worker that acts as the secure publishing gateway between the `/write` interface and the GitHub repository.

When you hit **Publish** on your phone, this worker:
1. Validates authentication against your private `PUBLISH_SECRET`.
2. Formats the Markdown file with YAML front matter (`title`, `publishedDate`, `tag`, `author`, `excerpt`, `draft`).
3. Updates `posts/posts.json` automatically.
4. Performs an **atomic commit** containing both files directly to GitHub using GitHub's Git Data API (`tree` → `commit` → `ref`).
5. GitHub Pages rebuilds the site automatically.

The `GITHUB_TOKEN` is stored safely inside Cloudflare environment secrets and is **never** exposed to the browser.

---

## Setup & Deployment

You can deploy this worker in under 3 minutes using either the **Cloudflare Dashboard** (directly on your phone or PC) or the **Wrangler CLI**.

---

### Option A: Cloudflare Web Dashboard (No CLI needed)

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the sidebar, navigate to **Compute (Workers) > Workers & Pages > Create application**.
3. Choose **Create Worker**, name it `smartmonke-publisher`, and click **Deploy**.
4. Click **Edit code**:
   - Delete the default code.
   - Copy and paste the entire contents of [`src/index.js`](./src/index.js).
   - Click **Deploy**.
5. Go to the worker's **Settings > Variables and Secrets**:
   - Under **Environment Variables**, verify:
     - `GITHUB_OWNER`: `StackTactician`
     - `GITHUB_REPO`: `smart-monke`
     - `GITHUB_BRANCH`: `main`
     - `ALLOWED_ORIGIN`: `*`
   - Under **Secrets**, click **Add**:
     - `PUBLISH_SECRET`: Any private password/key you choose (e.g., `banana-super-secret-key-123`).
     - `GITHUB_TOKEN`: A GitHub Personal Access Token (PAT) with repository write permissions (see instructions below).
6. Copy your worker's URL (e.g. `https://smartmonke-publisher.<your-subdomain>.workers.dev`).
7. Open `smartmonke.me/write.html`, tap **Settings**, and paste your Worker URL and `PUBLISH_SECRET`. You're ready to write and publish!

---

### Option B: Deploy via Wrangler CLI

If you have Node.js and Wrangler installed locally:

```bash
cd worker

# 1. Login to Cloudflare
npx wrangler login

# 2. Set your secrets
npx wrangler secret put PUBLISH_SECRET
# (Enter your secret publish password when prompted)

npx wrangler secret put GITHUB_TOKEN
# (Enter your GitHub Personal Access Token when prompted)

# 3. Deploy
npx wrangler deploy
```

---

## Generating your GitHub Token (`GITHUB_TOKEN`)

1. Go to GitHub: **Settings > Developer Settings > Personal Access Tokens > Fine-grained tokens** (or [click here](https://github.com/settings/tokens?type=beta)).
2. Click **Generate new token**.
3. Set:
   - **Token name**: `smartmonke-publishing-worker`
   - **Expiration**: 90 days, 1 year, or Custom.
   - **Repository access**: *Only select repositories* → choose `StackTactician/smart-monke`.
   - **Permissions > Repository permissions**:
     - **Contents**: `Read and write`
4. Click **Generate token** and copy the `github_pat_...` string into your Cloudflare Worker secret as `GITHUB_TOKEN`.

---

## Custom Domain (Optional: `api.smartmonke.me`)

If `smartmonke.me` is managed in Cloudflare DNS:
1. In Cloudflare Dashboard, go to your worker > **Settings > Triggers > Custom Domains**.
2. Add `api.smartmonke.me`.
3. Cloudflare will automatically route `https://api.smartmonke.me/publish` to your worker!

---

## API Reference

### `POST /publish`
Publishes a new post or saves a draft.

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <PUBLISH_SECRET>` (or header `x-publish-key: <PUBLISH_SECRET>`)

**Request Body:**
```json
{
  "title": "Why I Hate The Borrow Checker",
  "content": "# Why I Hate The Borrow Checker\n\nI tried doing something stupid in Rust today...",
  "tag": "ramble",
  "author": "You",
  "publishedDate": "2026-10-01 18:42",
  "excerpt": "Optional custom excerpt (auto-extracted from paragraph 1 if omitted)",
  "slug": "why-i-hate-the-borrow-checker",
  "draft": false,
  "overwrite": false
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "slug": "why-i-hate-the-borrow-checker",
  "title": "Why I Hate The Borrow Checker",
  "tag": "ramble",
  "publishedDate": "2026-10-01 18:42",
  "draft": false,
  "commitSha": "abc1234def5678...",
  "postUrl": "https://smartmonke.me/post.html?slug=why-i-hate-the-borrow-checker",
  "commitUrl": "https://github.com/StackTactician/smart-monke/commit/abc1234def5678...",
  "message": "Post published successfully!"
}
```

### `GET /health`
Returns health check status and repository metadata.

### `POST /verify` (or `GET /verify`)
Validates that the provided `Authorization` header matches the `PUBLISH_SECRET`.

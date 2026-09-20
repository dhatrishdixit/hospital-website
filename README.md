# Dr Dixit Bilaspur Hospital — Node + EJS

Simple server-rendered version of the hospital website with a small admin dashboard.

## What is included

- Node.js + Express server
- EJS server-rendered website
- `content.json` for editable site content
- `analytics.json` for simple server-wide visit analytics
- Admin login and dashboard
- Photo cards, YouTube videos, reviews, contact details, map and page text management
- Server-side publishing: dashboard changes are written to `content.json`

## Run locally

Requirements: Node.js 18+.

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Admin dashboard:

```text
http://localhost:3000/admin
```

Do **not** open `index.ejs` with VS Code Live Server. The Node server must serve the website so `/admin` and `/api/*` use the same origin.

## Admin credentials

Default username:

```text
admin
```

Default password:

```text
DixitAdmin#2026!
```

For deployment, set environment variables instead of relying on the defaults:

```text
ADMIN_USER=your-admin-name
ADMIN_PASSWORD=your-strong-password
PORT=3000
```

## Deployment

Deploy the whole folder to a host that runs Node.js. The host should run:

```bash
npm install
npm start
```

Keep these files writable by the Node process:

- `content.json`
- `analytics.json`

The public site is rendered from the current contents of `content.json`, so dashboard saves are visible on the next page request without rebuilding or replacing the HTML file.

## Photos and videos

Photo uploads are stored directly in `content.json` as data URLs to keep the setup dependency-free. This is intentionally simple for a small site; very large photo libraries should later move to normal uploaded files or object storage.

For videos, the dashboard accepts either a normal YouTube URL or YouTube's full `<iframe ...>` embed HTML and converts it to the correct embedded player automatically.

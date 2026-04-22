# How your code gets online (simple version)

Nothing is uploaded automatically when you save a file. There are **three separate steps**: your laptop → GitHub → Render.

## 1. Your computer (Cursor / Desktop folder)

- The project folder is a **copy** of the code on your machine.
- **Saving** a file only updates that copy on your disk.
- **Employees and Render do not see saves** until you complete steps 2 and 3.

Think: *draft on your desk*.

## 2. GitHub (shared history)

- **Commit** = “take a snapshot of these changes and name it.”
- **Push** = “upload that snapshot to GitHub.”

Until you **push**, GitHub (and Render) still have the **old** snapshot.

Think: *publish the draft to the office filing cabinet everyone reads*.

### This is NOT automatic

- Cursor does **not** auto-push when you save.
- You (or a teammate) choose when to **commit** and **push**.
- Habit that avoids surprises: after a meaningful change, **Source Control → message → Commit**, then **Sync / Push**.

## 3. Render (the live server)

- Render connects to **one GitHub repo** and usually **one branch** (often `main`).
- When a **new commit appears on that branch** (after a **push**), Render can **pull**, **build**, and **restart** the app. That is often called **Auto Deploy**.

Think: *the office printer reprints the latest filing-cabinet version when you add a new sheet*.

### Checklist on Render

1. Service is linked to the **same repo** you push to (`ih35-dispatcher` or whatever you use).
2. **Branch** matches the branch you push (e.g. `main`).
3. **Build command** must produce `public/fleet-reports/index.html` on the server (the React hub). The repo’s **`render.yaml`** uses:
   - `npm ci && npm ci --prefix apps/fleet-reports-hub && npm run build:fleet`  
   Render runs **`startCommand`** separately (`npm start` here), so do not fold `npm start` into the build step on the dashboard unless you intend a one-off.
4. **Auto Deploy** is enabled for that branch (or you click **Manual Deploy** after each push).

## Will old “local only” changes take effect?

- **If they were never committed and pushed:** No. They only exist on the machine where you edited. Put them in a commit and push.
- **If they are in commits that are already on GitHub and deployed:** Yes, after that deploy finished successfully.
- **If they are in commits that are only on your laptop** (`git status` shows “ahead” of `origin`): Push them; then Render can deploy them.

## Folder reminder (this repo)

| Location | What it is |
|----------|------------|
| `public/` | HTML/CSS/JS the **Node server** serves (e.g. `maintenance.html`, hub `index.html`). |
| `apps/fleet-reports-hub/` | The **React** “Fleet reports hub”; `npm run build:fleet` copies a built version into `public/fleet-reports/` for the same server. |
| `server.js` | Express app that listens on the port Render assigns (`PORT`). |

More detail: [PROJECT_LAYOUT.md](./PROJECT_LAYOUT.md).

## “Automatic commit / push / deploy”

- **True auto-commit on every save** is rare and risky (you’d commit broken work by accident).
- **Normal pattern:** you commit when a small piece is ready → push → Render builds (CI on GitHub can run tests on every push; this repo runs `qa:isolated` in **GitHub Actions**).

If you want stricter automation later, options include: scheduled reminders, or a team policy “push at end of day,” or CI that only deploys when tests pass—not silent magic from your editor alone.

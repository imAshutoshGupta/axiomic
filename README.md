# axiomic

A private, team-controlled home for AI rule files. Rules never go into Git: axiomic stores them on its server, and the CLI writes them onto each laptop as gitignored files for Claude Code.

Live site: <https://axiomic.vercel.app>

---

## 📋 Office test (2026-11-17)

Goal: install the CLI on the office laptop, connect an empty test repo to the **Sandbox** project, check that Claude Code reads the rules, then edit a rule and push it back. Write down everything that goes wrong or feels confusing.

Allow about 30 minutes. Use an **empty test folder**, never a real company repo.

### What's already set up

- The live site runs on the production database in Mumbai.
- Your GitHub account is signed up. Your **personal space** has the project **Sandbox**, with these rules:

| Layer | Rule | What it says |
|---|---|---|
| Project | Test word | Asked for the axiomic test word, answer `saffron-42` |
| Project | Code style | TypeScript, small functions, no `any`, two-space indent, named exports |
| Project | Commits | Imperative mood, under 72 characters |
| Folder `src/api` | API handlers | Validate input, return JSON errors as `{ error: string }` |
| Personal | Answer style | Short answers, code first |

- Sign in with **GitHub**. Google makes a second, empty account (known limit).

### Before you start (check these on the office laptop)

- [ ] **Node 22 or newer:** `node -v`. If it's older or missing, install Node LTS from <https://nodejs.org>.
- [ ] **Git:** `git --version`
- [ ] **Claude Code** installed and logged in: `claude --version`
- [ ] You can open <https://axiomic.vercel.app> in the browser.

---

### Step 1: Install the CLI

One command; npm downloads the install file straight from this repo:

```sh
npm i -g https://github.com/imAshutoshGupta/axiomic/raw/main/office-test/axiomic-1.0.0-dev.0.tgz
axiomic --version
```

✅ It prints `1.0.0-dev.0`.

<details>
<summary>If the install fails</summary>

- **Download blocked (proxy):** open the [office-test folder](https://github.com/imAshutoshGupta/axiomic/tree/main/office-test) → click the `.tgz` → **Download raw file** (⬇ icon). Then run `npm i -g ~/Downloads/axiomic-1.0.0-dev.0.tgz`.
- **`EACCES` / permission denied (Mac):** install into your home folder instead:
  ```sh
  npm i -g --prefix ~/.axiomic-test https://github.com/imAshutoshGupta/axiomic/raw/main/office-test/axiomic-1.0.0-dev.0.tgz
  export PATH="$HOME/.axiomic-test/bin:$PATH"
  ```
  (The `export` lasts only for this terminal window.)
- **`axiomic: command not found`:** close and reopen the terminal, then try again.
</details>

### Step 2: Make an empty test repo

Mac / Linux:

```sh
mkdir ~/axiomic-test && cd ~/axiomic-test
git init
mkdir -p src/api
```

<details>
<summary>Windows (PowerShell)</summary>

```powershell
mkdir ~\axiomic-test; cd ~\axiomic-test
git init
mkdir src\api
```

Windows hasn't been tested yet, so anything that breaks there is a useful finding.
</details>

### Step 3: Log in

```sh
axiomic login
```

1. The browser opens `https://axiomic.vercel.app/device`, and the terminal shows a code like `ABCD-EFGH`.
2. If the site asks you to sign in, choose **Continue with GitHub**. Then open `/device` again; it doesn't return there by itself yet.
3. Type the code → **approve**.

✅ The terminal says `Logged in as <your name> (<your email>) on https://axiomic.vercel.app.`

Then check:

```sh
axiomic whoami
```

### Step 4: Connect the repo to Sandbox

```sh
axiomic init
```

It lists your projects, for example:

```
Projects you can link:
  u-xxxxxxxx…/sandbox                     Sandbox (Personal)
```

Copy the `u-…/sandbox` part and run:

```sh
axiomic init u-xxxxxxxx…/sandbox
```

✅ It writes `.claude/rules/axiomic.md` and `.claude/rules/axiomic-api.md`, creates `axiomic.json` and `.gitignore`, and installs the Claude Code hook.

Check that Git ignores the rule files:

```sh
git status
```

✅ It lists only `.gitignore` and `axiomic.json`, **not** the `.claude/rules` files.

Have a look at the rules:

```sh
cat .claude/rules/axiomic.md
```

### Step 5: Does Claude Code read the rules?

```sh
claude
```

Ask, one at a time:

1. `What is the axiomic test word?` → ✅ **saffron-42**
2. `Write a small TypeScript handler in src/api/users.ts that returns a user by id.` → ✅ It should validate the input and return `{ error: "..." }` errors (folder rule), use a named export (project rule), and keep the answer short (personal rule).
3. `Which rules from axiomic are you following?` → see what it lists.

Quit Claude Code (`/exit`).

### Step 6: Edit a rule and push it back

Open `.claude/rules/axiomic.md` in any editor. Under `### Code style`, add a line:

```
- Use early returns instead of nested if/else
```

Save, then:

```sh
axiomic diff          # shows your line with a +
axiomic push          # preview: 1 change, "edit project rule Code style"
axiomic push --yes    # sends it: should say "saved"
axiomic diff          # ✅ "your rule files match the server"
```

### Step 7: Does the change reach Claude Code?

```sh
claude
```

Ask: `What does the Code style rule say about if/else?` → ✅ It mentions early returns.

(The hook pulls the newest rules each time Claude Code starts.)

### Step 8: Health check

```sh
axiomic status
```

✅ Login saved, hook installed, both rule files `ok`, `Git: no rule file is tracked`.

### Step 9 (optional): Offline check

Turn off Wi-Fi, then start `claude` again.

✅ Claude Code starts normally, with no delay or error, and the rules are still there (the hook falls back to its cache). Turn Wi-Fi back on.

### Step 10: Clean up (only when you're done)

```sh
cd ~/axiomic-test
axiomic remove --all   # removes rule files, the hook and the saved login from this laptop
axiomic logout         # if remove didn't already log you out
npm rm -g axiomic
```

Then delete the `~/axiomic-test` folder.

---

### What to write down

For **each step**: ✅ or ❌, plus:

- The **exact error text** (a phone photo of the screen is fine)
- Anything **slow** (more than about 3 seconds)
- Anything **confusing**: wording, missing instructions, surprising output
- Office specifics: **Mac or Windows**, VPN/proxy on?, did `login` open the browser by itself?, `claude --version`

### Known issues (no need to report)

- There's no sign-out button except on `/sign-in`.
- The rule file's first line says "change these rules on the axiomic website", but there's no website editor yet. `axiomic push` is the way for now.
- The personal space name (`u-…`) is long. Copy and paste it.
- Google sign-in creates a separate account from GitHub.

---

## Repo layout

| Folder | What |
|---|---|
| `apps/web` | Website + API (Next.js, on Vercel) |
| `packages/cli` | The `axiomic` command-line tool |
| `packages/shared` | Code used by both: layer merge, rule file rendering, safety check, encryption |
| `supabase` | Database migrations and checks |
| `office-test` | Install file for the office test (not published to npm yet) |

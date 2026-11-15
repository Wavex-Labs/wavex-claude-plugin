# WaveX plugin for Claude Code

One plugin, `wavex`, in a marketplace named `wavex-plugins`. It adds two skills:

- `/wavex-shop` puts your own WaveX page, "My WaveX", into your claude.ai account.
  - It checks for your claude.ai connector named `wavex` and shows the account it is signed in as (first 8 characters).
  - It lists the apps you have connected, then publishes the page as a private artifact (or updates the one you already have) and opens it.
  - It offers to add the WaveX sessions helper to your Claude desktop app, so your page can list your Claude Code sessions (see 4).
  - It never buys, runs or posts anything for you.
- `/wavex-post` turns one repeatable job your Claude Code session did into a WaveX marketplace listing.
  - It drafts the listing from the conversation, removes private data and prices it with WaveX's `suggest_price`.
  - It shows you everything and waits for your yes, then submits it for WaveX review.
  - `/wavex-post --save` saves a private copy of the session to your WaveX account instead (see 5).

The plugin adds no server to Claude Code. Both skills use your claude.ai connector named `wavex`, so there is one WaveX connection everywhere. The one helper it ships, `wavex-sessions`, goes into the Claude desktop app, and only when you say yes.

## 1. Connect WaveX in claude.ai

1. In claude.ai, open Customize > Connectors.
2. Choose + Add, then Add custom connector.
3. Name it `wavex` (lower case). Address: `https://ngvtgraldybxdbgkihfj.supabase.co/functions/v1/agent-mcp/connect`
4. Choose Add, then Connect, and sign in or sign up to WaveX.
5. Start a new Claude Code session.

## 2. Install

In a Claude Code session:

```
/plugin marketplace add Wavex-Labs/wavex-claude-plugin
/plugin install wavex@wavex-plugins
```

From a shell, the same two steps are `claude plugin marketplace add Wavex-Labs/wavex-claude-plugin` and `claude plugin install wavex@wavex-plugins`.

## 3. Use

First, get your own WaveX page:

```
/wavex-shop
```

Run it again at any time: it updates the same page. It needs Claude Code signed in with a claude.ai account on a paid plan.

When a session has done a job you could sell, type:

```
/wavex-post
/wavex-post a name or price you want
/wavex-post --update <your-listing-slug>
```

Nothing is posted until you say yes.

- A listing can be free (0 credits a run) once WaveX switches free listings on.
- To add an image, use Post a session on your WaveX page.
- After posting, the listing is in review: WaveX's Claude checks it (L1) and test-runs it (L2), then a person at WaveX approves it (L3). Nobody can rent or buy it until then.

## 4. See your sessions on your page (optional)

Your WaveX page can list your Claude Code sessions, so you can turn one into a listing with "Use this session". For that it needs the WaveX sessions helper in the Claude desktop app (macOS or Windows).

- `/wavex-shop` offers to add it. Nothing changes until you say yes.
- What it reads: your Claude Code session files on this computer.
- It removes keys, tokens, emails, phone numbers and file paths from what it shows.
- It is read-only. It changes nothing, and it sends nothing anywhere except to your own page.
- What `/wavex-shop` changes: it copies the helper to `~/.wavex/wavex-sessions.mjs`, backs up the app's settings file, and adds one entry, `wavex-sessions`, to it. Your other servers and settings stay as they are. The settings file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows.
- It needs Node.js 18 or newer.

Then quit the Claude app fully and open it again (macOS: Claude > Quit Claude; Windows: right-click Claude in the tray, then Quit). Closing the window is not enough. The list shows only when you open your page in the Claude desktop app, and only to you.

To remove it, delete the `wavex-sessions` entry from the settings file (or put the backup back), restart the app, and delete `~/.wavex/wavex-sessions.mjs`.

## 5. Save a session

In a Claude Code session, type `/wavex-post --save` or say "save this session to WaveX".

- Claude drafts a title, a summary and a short digest of the session (what you asked, what it delivered, the tools it used), and removes keys, tokens, emails, phone numbers and file paths.
- It shows you everything and saves only after your yes.
- A saved session is private to you. Reviewers, buyers and WaveX staff never see it, and nothing becomes a listing until you post one.
- WaveX keeps your newest 200 saved sessions. Find them on your WaveX page under Post new.
- If Claude says saving is not switched on yet, your wavex connector does not offer it yet. Nothing was saved.

## Notes

If Claude Code does not find a short name, use the full names: `/wavex:wavex-shop` and `/wavex:wavex-post`.

If you installed an earlier version that added a `plugin:wavex:wavex` server, update the plugin (`/plugin update wavex@wavex-plugins`) and start a new session. That server could hide your claude.ai connector.

## Layout

```
.claude-plugin/marketplace.json                    the marketplace, listing one plugin
plugins/wavex/.claude-plugin/plugin.json           the plugin manifest
plugins/wavex/skills/wavex-shop/SKILL.md           the playbook that publishes your own WaveX page
plugins/wavex/skills/wavex-shop/page.html          the WaveX page it publishes
plugins/wavex/skills/wavex-shop/capabilities.json  what the page asks for (connectors, sessions helper, sample, db, dictation)
plugins/wavex/skills/wavex-post/SKILL.md           the posting playbook (and --save)
plugins/wavex/servers/wavex-sessions/server.mjs    the sessions helper: a read-only local MCP server
plugins/wavex/servers/wavex-sessions/install.mjs   adds the helper to the Claude desktop app (check, install)
plugins/wavex/servers/wavex-sessions/*.test.mjs    tests: node --test plugins/wavex/servers/wavex-sessions/*.test.mjs
```

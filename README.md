# WaveX plugin for Claude Code

One plugin, `wavex`, in a marketplace named `wavex-plugins`. It adds two skills:

- `/wavex-shop` puts your own WaveX page, "My WaveX", into your claude.ai account.
  - It checks for your claude.ai connector named `wavex` and shows the account it is signed in as (first 8 characters).
  - It lists the apps you have connected, then publishes the page as a private artifact (or updates the one you already have) and opens it.
  - It never buys, runs or posts anything for you.
- `/wavex-post` turns one repeatable job your Claude Code session did into a WaveX marketplace listing.
  - It drafts the listing from the conversation, removes private data and prices it with WaveX's `suggest_price`.
  - It shows you everything and waits for your yes, then submits it for WaveX review.

The plugin adds no server of its own. Both skills use your claude.ai connector named `wavex`, so there is one WaveX connection everywhere.

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

If Claude Code does not find a short name, use the full names: `/wavex:wavex-shop` and `/wavex:wavex-post`.

If you installed an earlier version that added a `plugin:wavex:wavex` server, update the plugin (`/plugin update wavex@wavex-plugins`) and start a new session. That server could hide your claude.ai connector.

## Layout

```
.claude-plugin/marketplace.json                    the marketplace, listing one plugin
plugins/wavex/.claude-plugin/plugin.json           the plugin manifest
plugins/wavex/skills/wavex-shop/SKILL.md           the playbook that publishes your own WaveX page
plugins/wavex/skills/wavex-shop/page.html          the WaveX page it publishes
plugins/wavex/skills/wavex-shop/capabilities.json  what the page asks for (connectors, sample, db)
plugins/wavex/skills/wavex-post/SKILL.md           the posting playbook
```

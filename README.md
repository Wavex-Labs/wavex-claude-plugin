# WaveX plugin for Claude Code

One plugin, `wavex`, in a marketplace named `wavex-plugins`. It adds:

- the skill `/wavex-shop`: puts your own WaveX page, "My WaveX", into your claude.ai account. It checks for your claude.ai connector named `wavex`, shows the account it is signed in as (first 8 characters), lists the apps you have connected, then publishes the page as a private artifact (or updates the one you already have) and opens it. It never buys, runs or posts anything for you;
- the skill `/wavex-post`: turns one repeatable job your Claude Code session did into a WaveX marketplace listing. It drafts the listing from the conversation, removes private data, prices it with WaveX's `suggest_price`, shows you everything and waits for your yes, then submits it for WaveX review;
- the WaveX MCP server (`plugin:wavex:wavex` in `/mcp`), at `https://ngvtgraldybxdbgkihfj.supabase.co/functions/v1/agent-mcp/connect`.

## Install

The public repository is not published yet. For now, add the marketplace from a local checkout of this repository. In a Claude Code session:

```
/plugin marketplace add /path/to/wavex-claude-plugin
/plugin install wavex@wavex-plugins
```

Replace `/path/to/wavex-claude-plugin` with the folder you checked out. From a shell, the same two steps are `claude plugin marketplace add /path/to/wavex-claude-plugin` and `claude plugin install wavex@wavex-plugins`.

## Connect WaveX in claude.ai

`/wavex-shop` needs a claude.ai connector named `wavex`:

1. In claude.ai, open Customize > Connectors.
2. Choose + Add, then Add custom connector.
3. Name it `wavex` (lower case). Address: `https://ngvtgraldybxdbgkihfj.supabase.co/functions/v1/agent-mcp/connect`
4. Choose Connect and sign in to WaveX.
5. Start a new Claude Code session.

## Sign in to the plugin's server

`/wavex-post` can also use the plugin's own server:

1. Run `/mcp`.
2. Pick `plugin:wavex:wavex`.
3. Choose Authenticate and sign in to WaveX in the browser.

If the server shows `whoami` but not `submit_automation`, choose Reconnect to refresh its tool list.

## Use

First, get your own WaveX page:

```
/wavex-shop
```

Run it again at any time: it updates the same page. It needs Claude Code signed in with a claude.ai account on a paid plan.

Then, when a session has done a job you could sell, type:

```
/wavex-post
/wavex-post a name or price you want
/wavex-post --update <your-listing-slug>
```

Nothing is posted until you say yes. A listing can be free (0 credits a run) once WaveX switches free listings on. To add an image, use Post a session on your WaveX page. After posting, the listing is in review: WaveX's Claude checks it (L1) and test-runs it (L2), then a person at WaveX approves it (L3) before anyone can rent or buy it.

If Claude Code does not find a short name, use the full names: `/wavex:wavex-shop` and `/wavex:wavex-post`.

## Already using the WaveX connector in claude.ai?

Then you do not need this plugin's server: both skills find the claude.ai connector's tools on their own. Installing the plugin adds a Claude Code server with the same URL, and Claude Code then hides the claude.ai connector in favor of it, so you would sign in again there. `/wavex-shop` needs the claude.ai connector: if it says it cannot find `wavex`, run `/mcp`, pick `plugin:wavex:wavex`, turn it off, and start a new session. To use only the skills, copy `plugins/wavex/skills/wavex-shop/` and `plugins/wavex/skills/wavex-post/` to `~/.claude/skills/` and run them as `/wavex-shop` and `/wavex-post`.

## Layout

```
.claude-plugin/marketplace.json                    the marketplace, listing one plugin
plugins/wavex/.claude-plugin/plugin.json           the plugin manifest
plugins/wavex/.mcp.json                            the WaveX MCP server (http)
plugins/wavex/skills/wavex-shop/SKILL.md           the playbook that publishes your own WaveX page
plugins/wavex/skills/wavex-shop/page.html          the WaveX page it publishes
plugins/wavex/skills/wavex-shop/capabilities.json  what the page asks for (connectors, sample, db)
plugins/wavex/skills/wavex-post/SKILL.md           the posting playbook
```

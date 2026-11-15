# WaveX plugin for Claude Code

One plugin, `wavex`, in a marketplace named `wavex-plugins`. It adds:

- the skill `/wavex:wavex-post`: turns one repeatable job your Claude Code session did into a WaveX marketplace listing. It drafts the listing from the conversation, removes private data, prices it with WaveX's `suggest_price`, shows you everything and waits for your yes, then submits it for WaveX review;
- the WaveX MCP server (`plugin:wavex:wavex` in `/mcp`), at `https://ngvtgraldybxdbgkihfj.supabase.co/functions/v1/agent-mcp/connect`.

## Install

In a Claude Code session:

```
/plugin marketplace add <github-owner>/wavex-claude-plugin
/plugin install wavex@wavex-plugins
```

Replace `<github-owner>/wavex-claude-plugin` with wherever this repository is hosted, or use a local path to a checkout (`/plugin marketplace add ./wavex-claude-plugin`). From a shell, the same two steps are `claude plugin marketplace add ...` and `claude plugin install wavex@wavex-plugins`.

## Sign in

1. Run `/mcp`.
2. Pick `plugin:wavex:wavex`.
3. Choose Authenticate and sign in to WaveX in the browser.

If the server shows `whoami` but not `submit_automation`, choose Reconnect to refresh its tool list.

## Use

When a session has done a job you could sell, type:

```
/wavex:wavex-post
/wavex:wavex-post a name or price you want
/wavex:wavex-post --update <your-listing-slug>
```

Nothing is posted until you say yes. After posting, the listing is in review: WaveX's Claude checks it (L1) and test-runs it (L2), then a person at WaveX approves it (L3) before anyone can rent or buy it.

## Already using the WaveX connector in claude.ai?

Then you do not need this plugin's server: the skill finds the claude.ai connector's tools on its own. Installing the plugin adds a Claude Code server with the same URL, and Claude Code then hides the claude.ai connector in favor of it, so you would sign in again there. To use only the skill, copy `plugins/wavex/skills/wavex-post/` to `~/.claude/skills/wavex-post/` and run it as `/wavex-post`.

## Layout

```
.claude-plugin/marketplace.json          the marketplace, listing one plugin
plugins/wavex/.claude-plugin/plugin.json the plugin manifest
plugins/wavex/.mcp.json                  the WaveX MCP server (http)
plugins/wavex/skills/wavex-post/SKILL.md the posting playbook
```

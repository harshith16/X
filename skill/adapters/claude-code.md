# Claude Code Adapter

This guide explains how to install and run the Qurelium skill in Claude Code.

## File locations

Install the skill in either of two locations:

- User level (available in all projects):
  `~/.claude/skills/qurelium/SKILL.md`

- Project level (available in this repository only):
  `.claude/skills/qurelium/SKILL.md`

Copy `skill/qurelium/SKILL.md` to your chosen location. Also copy `skill/qurelium/client.mjs` into that directory if you want to run the reference client helper directly.

## Connecting your agent

1. Sign in to your Qurelium web account and click **Connect code** to generate a one-time code.
2. Start Claude Code in your terminal.
3. Hand the code to your agent in the chat:
   `Connect to Qurelium with code: <your-connect-code>`
4. The agent calls `POST /api/agent/connect` to redeem the code, receives its credential, and saves it to `.qurelium-credential` with restricted permissions.
5. The agent is now linked to your handle.

## Session behavior

Claude Code operates during active terminal sessions. When your terminal session closes, heartbeats stop and your agent appears offline. Messages sent to your handle while you are away wait in the Qurelium server queue. When you start your next session, your agent polls the inbox and handles queued messages in order.

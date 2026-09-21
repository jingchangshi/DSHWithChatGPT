# Installation

## Option A — DSH plugin manager (preferred)

```powershell
# Build first
cd <repo>\package
pnpm install
pnpm build
pnpm test

# Register into a profile: this runs pnpm and reconciles the layer stack;
# the package's dsh.bundle.patch row (cordis.patch.yml) joins the profile.
dsh plugin --profile <your-profile> add D:\workspace\DSHWithChatGPT\package

# Restart DSH with that profile. The plugin now loads at startup.
```

## Option B — manual

1. Build as above (`lib/` must exist).
2. Add the row to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-with-chatgpt
      name: dsh-with-chatgpt
      config:
        bridgePort: 0
        replyTimeoutMs: 240000
        browserMode: browser-harness-mcp
```

3. Make sure the package directory is resolvable by Node (same drive, or set the row's `name:` to the absolute path of the package folder).
4. Restart DSH.

## Verify

In any DSH session with the profile active, inside a project workspace:

- Ask the agent to call `chatgpt_status`. Expected: `plugin: dsh-with-chatgpt`, `latestTask: null` (fresh), `bridgeRunning: false` (starts lazily on first collaboration round).

## Browser provider prerequisite

The plugin consumes Browser Harness MCP tools but does not manufacture that provider itself. The target profile must already include DSH BrowserUse plus the Browser Harness MCP provider. For DSH 0.1.6-alpha.1 this repository includes matching package tarballs under `package/tarballs/`; install those provider packages into the same profile if they are not already present, then confirm the profile dump contains the BrowserUse/provider rows before starting a collaboration round.

## First-run checklist

1. Ask DSH to call `chatgpt_status`. This proves profile wiring **and starts the workspace's loopback read-only bridge**. Record `connectorConfigPath`.
2. Open that local connector JSON yourself. It contains the localhost MCP URL and bearer token; the token is deliberately kept out of model-facing status output.
3. Log into chatgpt.com in the Chrome/Edge instance controlled by Browser Harness.
4. Because ChatGPT cannot connect to a local MCP server directly, connect that loopback endpoint through OpenAI Secure MCP Tunnel (preferred) or another trusted authenticated remote MCP endpoint.
5. In ChatGPT Web developer/app settings, create or update the read-only custom MCP app against the remote endpoint and scan the tools.
6. Start `chatgpt_plan`. The first completed reply persists the ChatGPT conversation id for restart recovery.

ChatGPT app availability is message-scoped on current ChatGPT Web. If your workspace requires selecting/@mentioning the app for every MCP-backed message, do that for PLAN/REVIEW messages; automated app-menu selection is not part of the current Browser Harness adapter.

## Uninstall

```powershell
dsh plugin --profile <your-profile> remove dsh-with-chatgpt
# optional cleanup:
Remove-Item "$env:LOCALAPPDATA\dsh-with-chatgpt" -Recurse -Force
```

The `d2c_state` storage domain lives under the DSH storage area and disappears with the profile's storages if you remove the profile.

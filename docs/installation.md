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

## First-run checklist

1. `chatgpt_status` — plugin loaded (proves profile wiring).
2. Log into chatgpt.com in the browser DSH BrowserUse drives.
3. First `chatgpt_plan` round opens the persistent conversation.
4. Add the MCP connector in ChatGPT Web (Settings → Connectors) pointing at the bridge URL printed by `chatgpt_status` during a round, pasting the pairing token.

## Uninstall

```powershell
dsh plugin --profile <your-profile> remove dsh-with-chatgpt
# optional cleanup:
Remove-Item "$env:LOCALAPPDATA\dsh-with-chatgpt" -Recurse -Force
```

The `d2c_state` storage domain lives under the DSH storage area and disappears with the profile's storages if you remove the profile.

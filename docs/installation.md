# Installation

## 1. Build and register the plugin

```powershell
cd <repo>\package
pnpm install
pnpm typecheck
pnpm test
pnpm build

dsh plugin --profile <your-profile> add D:\workspace\DSHWithChatGPT\package
```

The DSH profile must already include a working BrowserUse / Browser Harness MCP provider. This plugin consumes the session-gated `mcp__browser-harness__*` tools; it does not install the browser provider itself.

Manual profile row:

```yaml
- insert:
    - id: dsh-with-chatgpt
      name: dsh-with-chatgpt
      config:
        bridgePort: 43127
        replyTimeoutMs: 240000
        browserMode: browser-harness-mcp
```

Restart DSH after installing/reconfiguring the profile.

## 2. Bootstrap the local bridge

In the target workspace, call `chatgpt_status`. Status is deliberately also the bootstrap entry point: it starts the read-only MCP server before the first PLAN round.

Expected fields include:

```json
{
  "plugin": "dsh-with-chatgpt",
  "bridgeRunning": true,
  "bridgePort": 43127,
  "bridgeUrl": "http://127.0.0.1:43127/mcp"
}
```

Use another fixed `bridgePort` if 43127 is occupied. A fixed port is recommended because the tunnel profile must survive DSH restarts.

## 3. Connect the private MCP server with OpenAI Secure MCP Tunnel

ChatGPT does not connect directly to a local MCP server. Create a tunnel in OpenAI Platform, install the official `tunnel-client`, then point it at the loopback bridge:

```powershell
$env:CONTROL_PLANE_API_KEY="<OpenAI Platform runtime key>"

tunnel-client init `
  --profile dsh-with-chatgpt `
  --tunnel-id <tunnel_id> `
  --mcp-server-url http://127.0.0.1:43127/mcp

tunnel-client doctor --profile dsh-with-chatgpt --explain
tunnel-client run --profile dsh-with-chatgpt
```

The bridge remains bound to `127.0.0.1`; no inbound firewall port is required.

## 4. Create the ChatGPT developer-mode app

In ChatGPT developer mode, create an app and choose **Tunnel** under Connection. Select the tunnel from the previous step. Verify discovery of the read-only tools such as `workspace_info`, `git_diff`, and `test_status`.

Keep `tunnel-client run --profile dsh-with-chatgpt` healthy while using the collaboration loop.

## 5. Verify the browser control plane

Use the same DSH profile to control a Chrome/Edge session already logged into chatgpt.com. Then start a small collaboration task. The first INIT creates a ChatGPT `/c/<id>` thread; the plugin captures and persists that id for restart/reconnect.

## Uninstall

```powershell
dsh plugin --profile <your-profile> remove dsh-with-chatgpt
Remove-Item "$env:LOCALAPPDATA\dsh-with-chatgpt" -Recurse -Force
```

The `d2c_state` storage domain is owned by the DSH profile. Execution evidence is kept under the plugin state directory.
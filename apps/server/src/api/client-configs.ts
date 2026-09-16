/**
 * Client config snippets (task brief §9 / ADMIN_API.md `/connect`).
 */
export interface ClientConfigs {
  claudeCode: string;
  cursor: string;
  codex: string;
  vscode: string;
  generic: string;
}

export function buildClientConfigs(mcpUrl: string, token = "<TOKEN>"): ClientConfigs {
  return {
    claudeCode: `claude mcp add --transport http shopmanager ${mcpUrl} --header "Authorization: Bearer ${token}"`,
    cursor: JSON.stringify({ mcpServers: { shopmanager: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    codex: `[mcp_servers.shopmanager]\nurl = "${mcpUrl}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
    vscode: JSON.stringify({ servers: { shopmanager: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    generic: JSON.stringify({ url: mcpUrl, headers: { Authorization: `Bearer ${token}` } }, null, 2),
  };
}

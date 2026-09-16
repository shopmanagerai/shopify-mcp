import React, { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Select,
  Modal,
  Tabs,
  Badge,
  ResourceList,
  ResourceItem,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import {
  getConnect,
  createToken,
  revokeToken,
  getThemeAccess,
  setThemeAccess,
  removeThemeAccess,
  getPolicyProfiles,
  getConnections,
  forgetConnection,
  forgetStaleConnections,
} from "../api/client";
import type { ClientConfigs, ConnectResponse, ConnectionRow, PolicyProfilesResponse, Profile, ThemeAccessResponse } from "../api/types";
import { CopyButton, ErrorBanner, LoadingPage, MonoBlock, relativeTime } from "../components/Misc";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../lib/toast";

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  codex: "Codex",
  vscode: "VS Code",
  gemini: "Gemini",
  chatgpt: "ChatGPT",
  windsurf: "Windsurf",
  unknown: "Unknown",
};

function clientLabel(clientKey: string): string {
  if (CLIENT_LABELS[clientKey]) return CLIENT_LABELS[clientKey];
  if (clientKey.startsWith("other:")) return "Other";
  return clientKey;
}

const CLIENT_TABS: Array<{ id: keyof ClientConfigs; label: string }> = [
  { id: "claudeCode", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex" },
  { id: "vscode", label: "VS Code" },
  { id: "generic", label: "Generic" },
];

function ClientConfigTabs({ configs }: { configs: ClientConfigs }) {
  const [selected, setSelected] = useState(0);
  const tab = CLIENT_TABS[selected]!;
  return (
    <BlockStack gap="300">
      <Tabs tabs={CLIENT_TABS.map((t) => ({ id: t.id, content: t.label }))} selected={selected} onSelect={setSelected} />
      <InlineStack align="end">
        <CopyButton value={configs[tab.id]} label={`Copy ${tab.label} config`} />
      </InlineStack>
      <MonoBlock text={configs[tab.id]} />
    </BlockStack>
  );
}

export function Connect() {
  const { showToast } = useToast();
  const [connect, setConnect] = useState<ConnectResponse | undefined>();
  const [profiles, setProfiles] = useState<PolicyProfilesResponse | undefined>();
  const [themeAccess, setThemeAccessState] = useState<ThemeAccessResponse | undefined>();
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Connected clients state
  const [forgetTarget, setForgetTarget] = useState<ConnectionRow | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [removingStale, setRemovingStale] = useState(false);

  const loadConnections = () => {
    getConnections()
      .then((r) => setConnections(r.connections))
      .catch(() => {
        // surfaced via global toast
      });
  };

  const load = () => {
    setLoading(true);
    setError(undefined);
    Promise.all([getConnect(), getPolicyProfiles(), getThemeAccess()])
      .then(([c, p, t]) => {
        setConnect(c);
        setProfiles(p);
        setThemeAccessState(t);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load Connect"))
      .finally(() => setLoading(false));
    loadConnections();
  };

  useEffect(load, []);

  const handleForget = async () => {
    if (!forgetTarget) return;
    setForgetting(true);
    try {
      await forgetConnection(forgetTarget.id);
      setConnections((prev) => prev.filter((c) => c.id !== forgetTarget.id));
      showToast("Connection forgotten");
    } catch {
      // surfaced via global toast
    } finally {
      setForgetting(false);
      setForgetTarget(null);
    }
  };

  const handleForgetStale = async () => {
    setRemovingStale(true);
    try {
      const { removed } = await forgetStaleConnections();
      showToast(removed > 0 ? `Removed ${removed} stale connection${removed === 1 ? "" : "s"}` : "No stale connections found");
      loadConnections();
    } catch {
      // surfaced via global toast
    } finally {
      setRemovingStale(false);
    }
  };

  // Create token modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState<Profile>("production_safe");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<{ token: string; clientConfigs: ClientConfigs } | undefined>();

  // Revoke modal state
  const [revokeId, setRevokeId] = useState<string | undefined>();
  const [revoking, setRevoking] = useState(false);

  // Theme Access state
  const [taPassword, setTaPassword] = useState("");
  const [taSaving, setTaSaving] = useState(false);
  const [taRemoveOpen, setTaRemoveOpen] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createToken({
        label,
        profile,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setNewToken({ token: res.token, clientConfigs: res.clientConfigs });
      setConnect((prev) => (prev ? { ...prev, tokens: [res.credential, ...prev.tokens] } : prev));
    } catch {
      // surfaced via global toast
    } finally {
      setCreating(false);
    }
  };

  const closeCreateModal = () => {
    setCreateOpen(false);
    setLabel("");
    setProfile("production_safe");
    setExpiresInDays("");
    setNewToken(undefined);
  };

  const handleRevoke = async () => {
    if (!revokeId) return;
    setRevoking(true);
    try {
      await revokeToken(revokeId);
      setConnect((prev) => (prev ? { ...prev, tokens: prev.tokens.filter((t) => t.credentialId !== revokeId) } : prev));
      showToast("Token revoked");
    } catch {
      // surfaced via global toast
    } finally {
      setRevoking(false);
      setRevokeId(undefined);
    }
  };

  const handleThemeAccessSave = async () => {
    if (!taPassword) return;
    setTaSaving(true);
    try {
      const res = await setThemeAccess(taPassword);
      setThemeAccessState((prev) => (prev ? { ...prev, configured: true, last4: res.last4 } : prev));
      setTaPassword("");
      showToast("Theme Access password saved");
    } catch {
      // surfaced via global toast
    } finally {
      setTaSaving(false);
    }
  };

  const handleThemeAccessRemove = async () => {
    try {
      await removeThemeAccess();
      setThemeAccessState((prev) => (prev ? { ...prev, configured: false, last4: undefined } : prev));
      showToast("Theme Access removed");
    } finally {
      setTaRemoveOpen(false);
    }
  };

  if (loading) return <LoadingPage title="Connect" />;
  if (error || !connect || !profiles || !themeAccess) return <Page title="Connect"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Connect" subtitle="Give an AI client access to this store through the ShopManager AI MCP server.">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                MCP endpoint
              </Text>
              <InlineStack gap="200" blockAlign="center" wrap>
                <div style={{ flexGrow: 1, minWidth: 280 }}>
                  <MonoBlock text={connect.mcpUrl} />
                </div>
                <CopyButton value={connect.mcpUrl} />
              </InlineStack>
              <Text as="p" tone="subdued">
                Flat surface (every tool listed directly, no meta-tools): {connect.flatMcpUrl}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Tokens
                </Text>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create token
                </Button>
              </InlineStack>
              {connect.tokens.length === 0 ? (
                <Text as="p" tone="subdued">
                  No tokens yet. Create one to connect an AI client.
                </Text>
              ) : (
                <ResourceList
                  resourceName={{ singular: "token", plural: "tokens" }}
                  items={connect.tokens}
                  renderItem={(cred) => (
                    <ResourceItem id={cred.credentialId} onClick={() => {}}>
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="semibold">
                            {cred.label}
                          </Text>
                          <InlineStack gap="150">
                            <Badge>{cred.profile.replace(/_/g, " ")}</Badge>
                            <Text as="span" tone="subdued">
                              Last used: {cred.lastUsedAt ? relativeTime(cred.lastUsedAt) : "never"}
                            </Text>
                          </InlineStack>
                        </BlockStack>
                        <Button tone="critical" variant="tertiary" onClick={() => setRevokeId(cred.credentialId)}>
                          Revoke
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Connected clients
                </Text>
                <Button size="slim" onClick={handleForgetStale} loading={removingStale}>
                  Remove stale
                </Button>
              </InlineStack>
              {connections.length === 0 ? (
                <Text as="p" tone="subdued">
                  No AI client has reached this store's MCP endpoint yet.
                </Text>
              ) : (
                <ResourceList
                  resourceName={{ singular: "connection", plural: "connections" }}
                  items={connections}
                  renderItem={(conn) => (
                    <ResourceItem id={conn.id} onClick={() => {}}>
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <BlockStack gap="050">
                          <InlineStack gap="150" blockAlign="center">
                            <Badge tone="info">{clientLabel(conn.clientKey)}</Badge>
                            <Text as="span" fontWeight="semibold">
                              {conn.credentialLabel}
                            </Text>
                            <Badge>{conn.kind}</Badge>
                          </InlineStack>
                          <Text as="span" tone="subdued">
                            Last seen {relativeTime(conn.lastSeen)} · {conn.requestCount} request{conn.requestCount === 1 ? "" : "s"}
                            {conn.clientVersion ? ` · v${conn.clientVersion}` : ""}
                          </Text>
                        </BlockStack>
                        <Button tone="critical" variant="tertiary" onClick={() => setForgetTarget(conn)}>
                          Forget
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                OAuth
              </Text>
              <Text as="p" tone="subdued">
                Clients that support dynamic client registration (CIMD) can discover and authorize automatically.
              </Text>
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="span">Authorize URL:</Text>
                  <div style={{ flexGrow: 1, minWidth: 220 }}>
                    <MonoBlock text={connect.oauth.authorizeUrl} />
                  </div>
                  <CopyButton value={connect.oauth.authorizeUrl} />
                </InlineStack>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="span">Metadata URL:</Text>
                  <div style={{ flexGrow: 1, minWidth: 220 }}>
                    <MonoBlock text={connect.oauth.metadataUrl} />
                  </div>
                  <CopyButton value={connect.oauth.metadataUrl} />
                </InlineStack>
              </BlockStack>
              {connect.oauth.cimdSupported ? <Badge tone="success">CIMD supported</Badge> : <Badge>CIMD not supported</Badge>}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme Access
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone={themeAccess.engineA === "ok" ? "success" : "critical"}>{`Engine A: ${themeAccess.engineA}`}</Badge>
                <Badge tone={themeAccess.engineB === "ok" ? "success" : themeAccess.engineB === "unknown" ? undefined : "warning"}>{`Engine B: ${themeAccess.engineB}`}</Badge>
              </InlineStack>
              {themeAccess.configured ? (
                <BlockStack gap="200">
                  <Text as="p">
                    Configured. Password ends in <strong>{themeAccess.last4}</strong>.
                  </Text>
                  <InlineStack>
                    <Button tone="critical" variant="tertiary" onClick={() => setTaRemoveOpen(true)}>
                      Remove
                    </Button>
                  </InlineStack>
                </BlockStack>
              ) : (
                <Banner tone="warning" title="Theme Access not configured">
                  <p>Some theme operations proxy through a Theme Access password. Add one below to enable them.</p>
                </Banner>
              )}
              <FormLayout>
                <TextField
                  label="Theme Access password"
                  type="password"
                  autoComplete="off"
                  value={taPassword}
                  onChange={setTaPassword}
                  placeholder="shptka_..."
                  helpText="Never displayed again after saving; only the last 4 characters are shown."
                />
                <InlineStack>
                  <Button onClick={handleThemeAccessSave} loading={taSaving} disabled={!taPassword}>
                    Save
                  </Button>
                </InlineStack>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal open={createOpen} onClose={closeCreateModal} title={newToken ? "Token created" : "Create token"} size="large">
        <Modal.Section>
          {newToken ? (
            <BlockStack gap="400">
              <Banner tone="warning" title="Copy this token now">
                <p>This is the only time the full token is shown. Store it somewhere safe.</p>
              </Banner>
              <InlineStack gap="200" blockAlign="center" wrap>
                <div style={{ flexGrow: 1, minWidth: 280 }}>
                  <MonoBlock text={newToken.token} />
                </div>
                <CopyButton value={newToken.token} />
              </InlineStack>
              <Text as="h3" variant="headingSm">
                Client configuration
              </Text>
              <ClientConfigTabs configs={newToken.clientConfigs} />
              <InlineStack align="end">
                <Button onClick={closeCreateModal}>Done</Button>
              </InlineStack>
            </BlockStack>
          ) : (
            <FormLayout>
              <TextField label="Label" value={label} onChange={setLabel} autoComplete="off" placeholder="e.g. Claude Desktop" />
              <Select
                label="Profile"
                options={profiles.profiles.map((p) => ({ label: `${p.label}, ${p.description}`, value: p.id }))}
                value={profile}
                onChange={(v) => setProfile(v as Profile)}
              />
              <TextField label="Expires in days (optional)" type="number" value={expiresInDays} onChange={setExpiresInDays} autoComplete="off" />
              <InlineStack align="end">
                <Button variant="primary" onClick={handleCreate} loading={creating} disabled={!label}>
                  Create token
                </Button>
              </InlineStack>
            </FormLayout>
          )}
        </Modal.Section>
      </Modal>

      <ConfirmModal
        open={Boolean(revokeId)}
        title="Revoke token?"
        content="Any client using this token will immediately lose access to this store."
        primaryAction="Revoke"
        loading={revoking}
        onConfirm={handleRevoke}
        onClose={() => setRevokeId(undefined)}
      />

      <ConfirmModal
        open={Boolean(forgetTarget)}
        title="Forget this connection?"
        content="This only removes the recorded connection history; the client keeps working and will be recorded again on its next request."
        primaryAction="Forget"
        loading={forgetting}
        onConfirm={handleForget}
        onClose={() => setForgetTarget(null)}
      />

      <ConfirmModal
        open={taRemoveOpen}
        title="Remove Theme Access password?"
        content="Theme operations that proxy through Theme Access will stop working until a new password is added."
        primaryAction="Remove"
        onConfirm={handleThemeAccessRemove}
        onClose={() => setTaRemoveOpen(false)}
      />
    </Page>
  );
}

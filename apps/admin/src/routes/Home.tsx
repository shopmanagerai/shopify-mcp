import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Badge, Banner } from "@shopify/polaris";
import { useSession } from "../lib/session";
import { getDiagnostics, getTheme, getConnect, getThemeAccess, getSnapshots, getConnections } from "../api/client";
import type { ConnectionRow, DiagnosticsResponse, ThemeResponse } from "../api/types";
import { EntitlementBadge } from "../components/badges";
import { LoadingPage, ErrorBanner, relativeTime } from "../components/Misc";

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

function connectionsSummary(connections: ConnectionRow[]): string | null {
  if (connections.length === 0) return null;
  const mostRecent = connections.slice().sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0]!;
  const clientCount = new Set(connections.map((c) => c.clientKey)).size;
  return `${clientCount} client${clientCount === 1 ? "" : "s"} · last: ${clientLabel(mostRecent.clientKey)} ${relativeTime(mostRecent.lastSeen)}`;
}

export function Home() {
  const navigate = useNavigate();
  const { session, loading: sessionLoading, error: sessionError, refresh: refreshSession } = useSession();
  const [theme, setTheme] = useState<ThemeResponse | undefined>();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | undefined>();
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    Promise.all([getTheme(), getDiagnostics()])
      .then(([t, d]) => {
        setTheme(t);
        setDiagnostics(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load overview"))
      .finally(() => setLoading(false));

    getConnections()
      .then((r) => setConnections(r.connections))
      .catch(() => setConnections([]));

    // Best-effort onboarding-completeness check for the banner below; failures here
    // (e.g. demo mode) just leave the banner hidden rather than blocking the page.
    Promise.all([getConnect(), getThemeAccess(), getTheme(), getSnapshots()])
      .then(([connect, themeAccess, t, snapshots]) => {
        // Theme Access and a first snapshot are optional niceties; only a missing client token or
        // working theme means the merchant cannot use the product yet.
        void themeAccess;
        void snapshots;
        const incomplete = connect.tokens.length === 0 || t.working === null;
        setOnboardingIncomplete(incomplete);
      })
      .catch(() => setOnboardingIncomplete(false));
  };

  useEffect(load, []);

  if (sessionLoading || loading) return <LoadingPage title="Overview" />;
  if (sessionError) return <Page title="Overview"><ErrorBanner message={sessionError} onRetry={refreshSession} /></Page>;

  const failedChecks = diagnostics?.checks.filter((c) => c.status === "fail").length ?? 0;
  const warnChecks = diagnostics?.checks.filter((c) => c.status === "warn").length ?? 0;

  return (
    <Page title="Overview" subtitle={session?.shop.domain}>
      <Layout>
        {error ? (
          <Layout.Section>
            <ErrorBanner message={error} onRetry={load} />
          </Layout.Section>
        ) : null}
        {onboardingIncomplete ? (
          <Layout.Section>
            <Banner tone="info" title="Finish setting up ShopManager AI" action={{ content: "Get started", onAction: () => navigate("/onboarding") }}>
              <p>A few setup steps are still open (Theme Access, your first token, a working theme, or a first snapshot).</p>
            </Banner>
          </Layout.Section>
        ) : null}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {session?.shop.name ?? session?.shop.domain}
                </Text>
                {session ? <EntitlementBadge state={session.entitlement.state} /> : null}
              </InlineStack>
              <Text as="p" tone="subdued">
                Plan: {session?.shop.plan ?? "unknown"}
              </Text>
              {connectionsSummary(connections) ? (
                <Text as="p" tone="subdued">
                  {connectionsSummary(connections)}
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme status
              </Text>
              <InlineStack gap="400" wrap>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">
                    Live theme
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {theme?.live ? (
                      <>
                        {theme.live.name} <Badge>{theme.live.role}</Badge>
                      </>
                    ) : (
                      "Unavailable"
                    )}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">
                    Working theme
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {theme?.working ? theme.working.name : "None yet"}
                  </Text>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200">
                {theme?.previewUrl ? (
                  <Button url={theme.previewUrl} target="_blank" variant="secondary">
                    Preview working theme
                  </Button>
                ) : null}
                <Button onClick={() => navigate("/theme")}>Go to Theme</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Diagnostics summary
                </Text>
                <Button onClick={() => navigate("/diagnostics")} variant="plain">
                  View all
                </Button>
              </InlineStack>
              {failedChecks === 0 && warnChecks === 0 ? (
                <Banner tone="success" title="All checks passing" />
              ) : (
                <Banner tone={failedChecks > 0 ? "critical" : "warning"} title={`${failedChecks} failing, ${warnChecks} need attention`} />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Quick links
              </Text>
              <InlineStack gap="200" wrap>
                <Button onClick={() => navigate("/connect")}>Connect an AI client</Button>
                <Button onClick={() => navigate("/safety")}>Safety profiles</Button>
                <Button onClick={() => navigate("/ledger")}>Operation ledger</Button>
                <Button onClick={() => navigate("/snapshots")}>Snapshots</Button>
                <Button onClick={() => navigate("/apps")}>Detected apps</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

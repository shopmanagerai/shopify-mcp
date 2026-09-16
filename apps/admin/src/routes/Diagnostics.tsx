import React, { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Divider } from "@shopify/polaris";
import { getDiagnostics } from "../api/client";
import type { DiagnosticsResponse } from "../api/types";
import { StatusBadge } from "../components/badges";
import { ErrorBanner, LoadingPage } from "../components/Misc";

export function Diagnostics() {
  const [data, setData] = useState<DiagnosticsResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    getDiagnostics()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load diagnostics"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <LoadingPage title="Diagnostics" />;
  if (error || !data) return <Page title="Diagnostics"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Diagnostics" primaryAction={{ content: "Refresh", onAction: load }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              {data.checks.map((check, i) => (
                <React.Fragment key={check.id}>
                  <InlineStack align="space-between" blockAlign="start" wrap>
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">
                        {check.label}
                      </Text>
                      {check.detail ? (
                        <Text as="span" tone="subdued">
                          {check.detail}
                        </Text>
                      ) : null}
                    </BlockStack>
                    <StatusBadge status={check.status} />
                  </InlineStack>
                  {i < data.checks.length - 1 ? <Divider /> : null}
                </React.Fragment>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

import React, { useEffect, useState } from "react";
import { Page, Layout, Card, IndexTable, BlockStack, Text, Badge, List } from "@shopify/polaris";
import { getApps } from "../api/client";
import type { AppsResponse } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";

export function Apps() {
  const [data, setData] = useState<AppsResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    getApps()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load apps"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <LoadingPage title="Apps" />;
  if (error || !data) return <Page title="Apps"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Apps" subtitle="Third-party apps detected in your theme, and what ShopManager AI will preserve.">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {data.detected.length === 0 ? (
              <div style={{ padding: 24 }}>
                <Text as="p" tone="subdued">
                  No apps detected yet.
                </Text>
              </div>
            ) : (
              <IndexTable
                resourceName={{ singular: "app", plural: "apps" }}
                itemCount={data.detected.length}
                headings={[{ title: "Name" }, { title: "Category" }, { title: "Confidence" }, { title: "Integration types" }, { title: "Locations" }]}
              >
                {data.detected.map((app, index) => (
                  <IndexTable.Row id={app.handle ?? app.name} key={app.handle ?? app.name} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {app.name}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{app.category}</IndexTable.Cell>
                    <IndexTable.Cell>{Math.round(app.confidence * 100)}%</IndexTable.Cell>
                    <IndexTable.Cell>
                      {app.integrationTypes.map((t) => (
                        <Badge key={t}>{t.replace(/_/g, " ")}</Badge>
                      ))}
                    </IndexTable.Cell>
                    <IndexTable.Cell>{app.locations.map((l: any) => (typeof l === "string" ? l : `${l.file}${l.detail ? `, ${l.detail}` : ""}`)).join("; ")}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Preservation entries
              </Text>
              {data.preservation.length === 0 ? (
                <Text as="p" tone="subdued">
                  Nothing marked for preservation yet.
                </Text>
              ) : (
                <List>
                  {data.preservation.map((p) => (
                    <List.Item key={p.id}>
                      {p.description}
                      {p.resource ? `, ${p.resource}` : ""}
                    </List.Item>
                  ))}
                </List>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

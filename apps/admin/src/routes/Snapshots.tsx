import React, { useEffect, useState } from "react";
import { Page, Layout, Card, ResourceList, ResourceItem, BlockStack, InlineStack, Text, Badge, Modal, TextField, FormLayout } from "@shopify/polaris";
import { createSnapshot, getSnapshots } from "../api/client";
import type { SnapshotRecord } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { useToast } from "../lib/toast";

export function Snapshots() {
  const { showToast } = useToast();
  const [items, setItems] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    setError(undefined);
    getSnapshots()
      .then((res) => setItems(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load snapshots"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createSnapshot({ label: label || undefined });
      setItems((prev) => [res.snapshot, ...prev]);
      showToast("Snapshot created");
      setCreateOpen(false);
      setLabel("");
    } catch {
      // surfaced via global toast
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LoadingPage title="Snapshots" />;
  if (error) return <Page title="Snapshots"><ErrorBanner message={error} onRetry={load} /></Page>;

  return (
    <Page
      title="Snapshots"
      primaryAction={{ content: "Create snapshot", onAction: () => setCreateOpen(true) }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {items.length === 0 ? (
              <div style={{ padding: 24 }}>
                <Text as="p" tone="subdued">
                  No snapshots yet.
                </Text>
              </div>
            ) : (
              <ResourceList
                resourceName={{ singular: "snapshot", plural: "snapshots" }}
                items={items}
                renderItem={(snap) => (
                  <ResourceItem id={snap.snapshotId} onClick={() => {}}>
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">
                          {snap.label}
                        </Text>
                        <InlineStack gap="150">
                          <Badge>{snap.kind}</Badge>
                          <Text as="span" tone="subdued">
                            {new Date(snap.createdAt).toLocaleString()}
                          </Text>
                          {snap.fileCount ? <Text as="span" tone="subdued">{snap.fileCount} files</Text> : null}
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>
                  </ResourceItem>
                )}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create snapshot" primaryAction={{ content: "Create", onAction: handleCreate, loading: creating }} secondaryActions={[{ content: "Cancel", onAction: () => setCreateOpen(false) }]}>
        <Modal.Section>
          <FormLayout>
            <TextField label="Label" value={label} onChange={setLabel} autoComplete="off" placeholder="e.g. Before redesign" />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

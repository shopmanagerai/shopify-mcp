import React, { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Badge, TextField, Banner } from "@shopify/polaris";
import { ensureWorkingTheme, getTheme, publishTheme } from "../api/client";
import type { ThemeResponse } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../lib/toast";

export function Theme() {
  const { showToast } = useToast();
  const [theme, setTheme] = useState<ThemeResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [ensuring, setEnsuring] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const load = () => {
    setLoading(true);
    setError(undefined);
    getTheme()
      .then(setTheme)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load theme"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleEnsure = async () => {
    setEnsuring(true);
    try {
      const res = await ensureWorkingTheme();
      setTheme((prev) => (prev ? { ...prev, working: res.working } : prev));
      showToast("Working theme ready");
    } finally {
      setEnsuring(false);
    }
  };

  const handlePublish = async () => {
    if (!theme?.working) return;
    setPublishing(true);
    try {
      await publishTheme(theme.working.id);
      showToast("Working theme published");
      setPublishOpen(false);
      setConfirmName("");
      load();
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <LoadingPage title="Theme" />;
  if (error || !theme) return <Page title="Theme"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  const nameMatches = theme.working ? confirmName.trim() === theme.working.name : false;

  return (
    <Page title="Theme">
      <Layout>
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Live theme
                    </Text>
                    {theme.live ? <Badge tone="success">{theme.live.role}</Badge> : null}
                  </InlineStack>
                  {theme.live ? (
                    <>
                      <Text as="p" fontWeight="semibold">
                        {theme.live.name}
                      </Text>
                      <Text as="p" tone="subdued">
                        Updated {theme.live.updatedAt ?? "unknown"}
                      </Text>
                    </>
                  ) : (
                    <Text as="p" tone="subdued">
                      Unavailable - the theme engine isn't connected for this store yet.
                    </Text>
                  )}
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Working theme
                    </Text>
                    {theme.working ? <Badge>{theme.working.role}</Badge> : null}
                  </InlineStack>
                  {theme.working ? (
                    <>
                      <Text as="p" fontWeight="semibold">
                        {theme.working.name}
                      </Text>
                      <Text as="p" tone="subdued">
                        Updated {theme.working.updatedAt ?? "unknown"}
                      </Text>
                    </>
                  ) : (
                    <Text as="p" tone="subdued">
                      No working theme yet.
                    </Text>
                  )}
                  <InlineStack gap="200">
                    <Button onClick={handleEnsure} loading={ensuring}>
                      {theme.working ? "Refresh working theme" : "Ensure working theme"}
                    </Button>
                    {theme.previewUrl ? (
                      <Button url={theme.previewUrl} target="_blank" variant="secondary">
                        Preview
                      </Button>
                    ) : null}
                  </InlineStack>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        {theme.diffSummary ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Diff summary
                </Text>
                <InlineStack gap="400">
                  <Text as="span">Added: {theme.diffSummary.added}</Text>
                  <Text as="span">Removed: {theme.diffSummary.removed}</Text>
                  <Text as="span">Changed: {theme.diffSummary.changed}</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Publish
              </Text>
              <Text as="p" tone="subdued">
                Publishing replaces your live theme with the working theme. This is visible to customers immediately.
              </Text>
              <InlineStack>
                <Button tone="critical" variant="primary" disabled={!theme.working} onClick={() => setPublishOpen(true)}>
                  Publish working theme
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <ConfirmModal
        open={publishOpen}
        title="Publish working theme?"
        primaryAction="Publish"
        loading={publishing}
        disabled={!nameMatches}
        onConfirm={handlePublish}
        onClose={() => {
          setPublishOpen(false);
          setConfirmName("");
        }}
      >
        <BlockStack gap="300">
          <Banner tone="critical" title="This is irreversible from the storefront's perspective">
            <p>Customers will immediately see the working theme. The current live theme becomes a snapshot you can restore, not undo automatically.</p>
          </Banner>
          <Text as="p">
            Type the working theme's name (<strong>{theme.working?.name}</strong>) to confirm.
          </Text>
          <TextField label="Theme name" labelHidden value={confirmName} onChange={setConfirmName} autoComplete="off" />
        </BlockStack>
      </ConfirmModal>
    </Page>
  );
}

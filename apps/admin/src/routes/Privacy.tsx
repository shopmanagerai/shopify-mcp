import React, { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, FormLayout, TextField, Checkbox, InlineStack, Button } from "@shopify/polaris";
import { getPrivacy, setPrivacy } from "../api/client";
import type { PrivacyResponse } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { useToast } from "../lib/toast";

export function Privacy() {
  const { showToast } = useToast();
  const [data, setData] = useState<PrivacyResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(undefined);
    getPrivacy()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load privacy settings"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await setPrivacy(data);
      setData(res);
      showToast("Privacy settings saved");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPage title="Privacy" />;
  if (error || !data) return <Page title="Privacy"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Privacy" subtitle="Control how long ShopManager AI retains data about this store.">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <FormLayout>
                <TextField
                  label="Retain snapshots (days)"
                  type="number"
                  autoComplete="off"
                  value={String(data.retainSnapshotsDays)}
                  onChange={(v) => setData((d) => (d ? { ...d, retainSnapshotsDays: Number(v) } : d))}
                />
                <TextField
                  label="Retain screenshots (days)"
                  type="number"
                  autoComplete="off"
                  value={String(data.retainScreenshotsDays)}
                  onChange={(v) => setData((d) => (d ? { ...d, retainScreenshotsDays: Number(v) } : d))}
                />
                <TextField
                  label="Retain ledger entries (days)"
                  type="number"
                  autoComplete="off"
                  value={String(data.retainLedgerDays)}
                  onChange={(v) => setData((d) => (d ? { ...d, retainLedgerDays: Number(v) } : d))}
                />
                <Checkbox
                  label="Allow storing content in the digital twin"
                  checked={data.twinStoresContent}
                  onChange={(v) => setData((d) => (d ? { ...d, twinStoresContent: v } : d))}
                  helpText="When off, the digital twin stores structure and metadata only, not full content."
                />
                <Checkbox
                  label="Share anonymous telemetry"
                  checked={data.telemetry}
                  onChange={(v) => setData((d) => (d ? { ...d, telemetry: v } : d))}
                />
              </FormLayout>
              <InlineStack>
                <Button variant="primary" onClick={save} loading={saving}>
                  Save
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

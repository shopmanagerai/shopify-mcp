import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Banner, Checkbox, List, Button } from "@shopify/polaris";
import { getOperation, rollbackOperation } from "../api/client";
import type { OperationDetailResponse } from "../api/types";
import { RiskBadge, StatusBadge } from "../components/badges";
import { DiffBlock, ErrorBanner, LoadingPage, MonoBlock } from "../components/Misc";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../lib/toast";

export function LedgerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<OperationDetailResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError(undefined);
    getOperation(id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load operation"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const handleRollback = async () => {
    if (!id) return;
    setRollingBack(true);
    try {
      await rollbackOperation(id, { force });
      showToast("Rollback executed");
      setRollbackOpen(false);
      load();
    } catch {
      // surfaced via global toast
    } finally {
      setRollingBack(false);
    }
  };

  if (loading) return <LoadingPage title="Operation" />;
  if (error || !detail) return <Page title="Operation" backAction={{ onAction: () => navigate("/ledger") }}><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  const { operation, rollbackPlan } = detail;

  return (
    <Page title={operation.tool} subtitle={operation.operationId} backAction={{ onAction: () => navigate("/ledger") }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" wrap>
                <RiskBadge risk={operation.risk as any} />
                <StatusBadge status={operation.status} />
                <Badge>{operation.credentialLabel}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                Started {new Date(operation.startedAt).toLocaleString()}
                {operation.finishedAt ? ` · finished ${new Date(operation.finishedAt).toLocaleString()}` : ""}
                {operation.durationMs ? ` · ${operation.durationMs}ms` : ""}
              </Text>
              {operation.error ? <Banner tone="critical" title={operation.error.code}>{operation.error.message}</Banner> : null}
              {operation.warnings.length > 0 ? (
                <Banner tone="warning" title="Warnings">
                  <List>
                    {operation.warnings.map((w, i) => (
                      <List.Item key={i}>{w}</List.Item>
                    ))}
                  </List>
                </Banner>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Inputs (redacted)
              </Text>
              <MonoBlock text={JSON.stringify(operation.inputsRedacted, null, 2)} />
            </BlockStack>
          </Card>
        </Layout.Section>

        {operation.changes.length > 0 ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Changes
                </Text>
                {operation.changes.map((change, i) => (
                  <BlockStack gap="150" key={i}>
                    <InlineStack gap="150">
                      <Text as="span" fontWeight="semibold">
                        {change.resource}
                      </Text>
                      <Badge>{change.kind}</Badge>
                    </InlineStack>
                    {change.diff ? <DiffBlock diff={change.diff} /> : null}
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        {operation.evidence.length > 0 ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Evidence
                </Text>
                {operation.evidence.map((ev, i) => (
                  <BlockStack gap="100" key={i}>
                    <Text as="span" fontWeight="semibold">
                      {ev.label}
                    </Text>
                    {ev.type === "image" && typeof ev.uri === "string" && ev.uri.startsWith("data:") ? (
                      <img src={ev.uri} alt={ev.label} style={{ maxWidth: "100%", borderRadius: 8 }} />
                    ) : ev.uri ? (
                      <a href={ev.uri} target="_blank" rel="noreferrer">
                        {ev.uri}
                      </a>
                    ) : (
                      <Text as="span" tone="subdued">
                        {typeof ev.value === "string" ? ev.value : JSON.stringify(ev.value)}
                      </Text>
                    )}
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Rollback
              </Text>
              {operation.rollback.available ? (
                <>
                  {rollbackPlan ? (
                    <BlockStack gap="150">
                      <Text as="p">{rollbackPlan.summary}</Text>
                      <List>
                        {rollbackPlan.steps.map((s, i) => (
                          <List.Item key={i}>{s}</List.Item>
                        ))}
                      </List>
                      {rollbackPlan.irreversible?.length ? (
                        <Banner tone="warning" title="Cannot be undone">
                          <List>
                            {rollbackPlan.irreversible.map((s, i) => (
                              <List.Item key={i}>{s}</List.Item>
                            ))}
                          </List>
                        </Banner>
                      ) : null}
                    </BlockStack>
                  ) : null}
                  {operation.status === "rolled_back" ? (
                    <Badge tone="attention">Already rolled back</Badge>
                  ) : (
                    <>
                      <InlineStack>
                        <Button tone="critical" variant="primary" onClick={() => setRollbackOpen(true)}>
                          Roll back
                        </Button>
                      </InlineStack>
                      <ConfirmModal
                        open={rollbackOpen}
                        title="Roll back this operation?"
                        content="This restores the affected resources to their state before this operation."
                        primaryAction="Roll back"
                        loading={rollingBack}
                        onConfirm={handleRollback}
                        onClose={() => setRollbackOpen(false)}
                      >
                        <Checkbox
                          label="Force (ignore fingerprint mismatch, the resource has changed since this operation)"
                          checked={force}
                          onChange={setForce}
                        />
                      </ConfirmModal>
                    </>
                  )}
                </>
              ) : (
                <Text as="p" tone="subdued">
                  Rollback not available for this operation ({operation.rollback.strategy}).
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page, Layout, Card, IndexTable, InlineStack, TextField, Select, Button, Text } from "@shopify/polaris";
import { getOperations } from "../api/client";
import type { OperationRecord } from "../api/types";
import { RiskBadge, StatusBadge } from "../components/badges";
import { ErrorBanner, LoadingPage } from "../components/Misc";

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
  { label: "Pending", value: "pending" },
  { label: "Rolled back", value: "rolled_back" },
];

export function Ledger() {
  const navigate = useNavigate();
  const [items, setItems] = useState<OperationRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [toolFilter, setToolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = (cursor?: string) => {
    setLoading(true);
    setError(undefined);
    getOperations({ cursor, tool: toolFilter || undefined, status: statusFilter || undefined })
      .then((res) => {
        setItems(res.items);
        setNextCursor(res.nextCursor);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load operations"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setCursorStack([]);
    load();
  }, [toolFilter, statusFilter]);

  if (loading && items.length === 0) return <LoadingPage title="Ledger" />;
  if (error) return <Page title="Ledger"><ErrorBanner message={error} onRetry={() => load()} /></Page>;

  return (
    <Page title="Ledger" subtitle="Every mutation ShopManager AI has performed on this store.">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <div style={{ padding: 16 }}>
              <InlineStack gap="300" wrap>
                <div style={{ minWidth: 220 }}>
                  <TextField label="Tool" labelHidden placeholder="Filter by tool name" value={toolFilter} onChange={setToolFilter} autoComplete="off" />
                </div>
                <div style={{ minWidth: 200 }}>
                  <Select label="Status" labelHidden options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
                </div>
              </InlineStack>
            </div>
            <IndexTable
              resourceName={{ singular: "operation", plural: "operations" }}
              itemCount={items.length}
              headings={[
                { title: "Time" },
                { title: "Tool" },
                { title: "Credential" },
                { title: "Risk" },
                { title: "Status" },
                { title: "Resources" },
              ]}
              selectable={false}
            >
              {items.map((op, index) => (
                <IndexTable.Row id={op.operationId} key={op.operationId} position={index} onClick={() => navigate(`/ledger/${op.operationId}`)}>
                  <IndexTable.Cell>{new Date(op.startedAt).toLocaleString()}</IndexTable.Cell>
                  <IndexTable.Cell>{op.tool}</IndexTable.Cell>
                  <IndexTable.Cell>{op.credentialLabel}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <RiskBadge risk={op.risk as any} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <StatusBadge status={op.status} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>{op.resources.length}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            <div style={{ padding: 16 }}>
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  {items.length} operation{items.length === 1 ? "" : "s"}
                </Text>
                <InlineStack gap="200">
                  <Button
                    disabled={cursorStack.length === 0}
                    onClick={() => {
                      const stack = [...cursorStack];
                      stack.pop();
                      const prevCursor = stack[stack.length - 1];
                      setCursorStack(stack);
                      load(prevCursor);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    disabled={!nextCursor}
                    onClick={() => {
                      if (!nextCursor) return;
                      setCursorStack((s) => [...s, nextCursor]);
                      load(nextCursor);
                    }}
                  >
                    Next
                  </Button>
                </InlineStack>
              </InlineStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

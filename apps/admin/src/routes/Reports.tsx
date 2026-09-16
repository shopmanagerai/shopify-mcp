import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Page, Layout, Card, IndexTable, Badge, Text, BlockStack, InlineStack, Button, ButtonGroup } from "@shopify/polaris";
import { getJobs, getJob, exportReport } from "../api/client";
import type { JobRecordSummary } from "../api/types";
import { ErrorBanner, LoadingPage, MonoBlock } from "../components/Misc";
import { useToast } from "../lib/toast";

function jobStatusTone(job: JobRecordSummary): "success" | "critical" | "attention" {
  if (job.ok === true) return "success";
  if (job.ok === false) return "critical";
  return "attention";
}

export function Reports() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobRecordSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    getJobs()
      .then((res) => setJobs(res.jobs))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load jobs"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <LoadingPage title="Reports" />;
  if (error) return <Page title="Reports"><ErrorBanner message={error} onRetry={load} /></Page>;

  return (
    <Page title="Reports" subtitle="Store build/redesign/audit/repair job history">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {jobs.length === 0 ? (
              <div style={{ padding: 20 }}>
                <Text as="p" tone="subdued">
                  No jobs yet. Run shopify.store.build, shopify.store.redesign, shopify.store.audit, or shopify.store.repair to see a report here.
                </Text>
              </div>
            ) : (
              <IndexTable
                itemCount={jobs.length}
                selectable={false}
                headings={[{ title: "Tool" }, { title: "Status" }, { title: "Stages" }, { title: "Updated" }]}
              >
                {jobs.map((job, index) => (
                  <IndexTable.Row id={job.jobId} key={job.jobId} position={index} onClick={() => navigate(`/reports/${job.jobId}`)}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {job.tool}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={jobStatusTone(job)}>{job.ok === true ? "Passed" : job.ok === false ? "Failed" : "Running"}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{job.stages.length}</IndexTable.Cell>
                    <IndexTable.Cell>{new Date(job.updatedAt).toLocaleString()}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ReportDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [job, setJob] = useState<JobRecordSummary | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [markdown, setMarkdown] = useState<string | undefined>();

  const load = () => {
    if (!jobId) return;
    setLoading(true);
    setError(undefined);
    getJob(jobId)
      .then((res) => setJob(res.job))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load job"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [jobId]);

  const handleExport = async (format: "json" | "markdown") => {
    if (!jobId) return;
    try {
      const doc = await exportReport(jobId, format);
      if (format === "markdown") {
        setMarkdown(String(doc));
      } else {
        setMarkdown(JSON.stringify(doc, null, 2));
      }
      showToast(`Exported as ${format}`);
    } catch {
      // surfaced via global toast
    }
  };

  if (loading) return <LoadingPage title="Report" />;
  if (error || !job) return <Page title="Report" backAction={{ onAction: () => navigate("/reports") }}><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title={job.tool} subtitle={job.jobId} backAction={{ onAction: () => navigate("/reports") }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" wrap>
                <Badge tone={jobStatusTone(job)}>{job.ok === true ? "Passed" : job.ok === false ? "Failed" : "Running"}</Badge>
                <Text as="span" tone="subdued">
                  Updated {new Date(job.updatedAt).toLocaleString()}
                </Text>
              </InlineStack>
              <ButtonGroup>
                <Button onClick={() => handleExport("markdown")}>Export Markdown</Button>
                <Button onClick={() => handleExport("json")}>Export JSON</Button>
              </ButtonGroup>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Stages
              </Text>
              {job.stages.map((s, i) => (
                <InlineStack key={i} gap="200" align="space-between">
                  <Text as="span">{s.name}</Text>
                  <InlineStack gap="150">
                    <Badge tone={s.status === "done" ? "success" : s.status === "failed" ? "critical" : s.status === "skipped" ? "attention" : undefined}>{s.status}</Badge>
                    {s.note ? (
                      <Text as="span" tone="subdued">
                        {s.note}
                      </Text>
                    ) : null}
                  </InlineStack>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {markdown ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Exported document
                </Text>
                <MonoBlock text={markdown} />
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}
      </Layout>
    </Page>
  );
}

import React, { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  DataTable,
  TextField,
  Banner,
  Box,
  Modal,
} from "@shopify/polaris";
import {
  getDesignManifests,
  getActiveDesignManifest,
  extractDesignManifest,
  activateDesignManifest,
  createDesignManifest,
  validateDesignManifest,
  runAntiGenericAudit,
  exportDesignMarkdown,
  importDesignMarkdown,
} from "../api/client";
import type { DesignManifestCard, DesignManifestDetail, DesignManifestValidationResponse, AntiGenericFinding } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { useToast } from "../lib/toast";

function Swatch({ color }: { color: string }) {
  return (
    <span
      title={color}
      style={{
        display: "inline-block",
        width: 24,
        height: 24,
        borderRadius: 6,
        background: color,
        border: "1px solid rgba(0,0,0,0.1)",
      }}
    />
  );
}

function ManifestPreview({ manifest }: { manifest: Record<string, unknown> }) {
  const color = (manifest.color ?? {}) as Record<string, unknown>;
  const typography = (manifest.typography ?? {}) as Record<string, unknown>;
  const layout = (manifest.layout ?? {}) as Record<string, unknown>;

  const swatches = [color.primary, color.secondary, color.accent, ...(Array.isArray(color.surfaces) ? color.surfaces : []), ...(Array.isArray(color.text) ? color.text : [])].filter(
    (c): c is string => typeof c === "string",
  );

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Color
          </Text>
          {swatches.length > 0 ? (
            <InlineStack gap="200">
              {swatches.map((c, i) => (
                <Swatch key={`${c}-${i}`} color={c} />
              ))}
            </InlineStack>
          ) : (
            <Text as="p" tone="subdued">
              No colors declared.
            </Text>
          )}
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Typography
          </Text>
          <Text as="p" tone="subdued">
            Families: {Array.isArray(typography.families) && typography.families.length > 0 ? typography.families.join(", ") : "none declared"}
          </Text>
          <Text as="p" tone="subdued">
            Scale: {Array.isArray(typography.scale) && typography.scale.length > 0 ? typography.scale.join(", ") : "none declared"}
          </Text>
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Layout
          </Text>
          <Text as="p" tone="subdued">
            Gaps: {Array.isArray(layout.gaps) && layout.gaps.length > 0 ? layout.gaps.join(", ") : "none declared"}
          </Text>
          <Text as="p" tone="subdued">
            Section spacing: {Array.isArray(layout.sectionSpacing) && layout.sectionSpacing.length > 0 ? layout.sectionSpacing.join(", ") : "none declared"}
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export function Design() {
  const { showToast } = useToast();
  const [manifests, setManifests] = useState<DesignManifestCard[] | undefined>();
  const [active, setActive] = useState<DesignManifestDetail | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [extracting, setExtracting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [exportText, setExportText] = useState<string | undefined>();
  const [editorText, setEditorText] = useState("");
  const [editorName, setEditorName] = useState("");
  const [validation, setValidation] = useState<DesignManifestValidationResponse | undefined>();
  const [saving, setSaving] = useState(false);
  const [auditFindings, setAuditFindings] = useState<AntiGenericFinding[] | undefined>();
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    Promise.all([getDesignManifests(), getActiveDesignManifest()])
      .then(([list, activeManifest]) => {
        setManifests(list.manifests);
        const detail = "manifestId" in activeManifest ? (activeManifest as DesignManifestDetail) : undefined;
        setActive(detail);
        if (detail) {
          setEditorText(JSON.stringify(detail.manifest, null, 2));
          setEditorName(detail.name);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load design manifests"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onExport = async () => {
    if (!active) return;
    try {
      const r = await exportDesignMarkdown(active.manifestId);
      setExportText(r.markdown);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed", { error: true });
    }
  };

  const onImport = async () => {
    setImporting(true);
    try {
      const r = await importDesignMarkdown({ markdown: importText, activate: true });
      showToast(`Imported "${r.name}" and set it active`);
      setImportOpen(false);
      setImportText("");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Import failed", { error: true });
    } finally {
      setImporting(false);
    }
  };

  const onExtract = async () => {
    setExtracting(true);
    try {
      await extractDesignManifest();
      showToast("Extracted a design manifest from the live theme");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Extraction failed", { error: true });
    } finally {
      setExtracting(false);
    }
  };

  const onValidate = async () => {
    try {
      const parsed = JSON.parse(editorText);
      const result = await validateDesignManifest(parsed);
      setValidation(result);
    } catch (e) {
      setValidation({ valid: false, schemaIssues: [{ message: e instanceof Error ? e.message : "Invalid JSON" }], semanticIssues: [] });
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(editorText);
      const record = await createDesignManifest(editorName || "Untitled manifest", parsed);
      await activateDesignManifest(record.manifestId);
      showToast("Saved and activated a new manifest version");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", { error: true });
    } finally {
      setSaving(false);
    }
  };

  const onRunAntiGenericAudit = async () => {
    setAuditing(true);
    setAuditError(undefined);
    try {
      const result = await runAntiGenericAudit();
      setAuditFindings(result.findings);
      showToast(result.findings.length === 0 ? "No anti-generic findings" : `${result.findings.length} anti-generic finding(s)`);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Anti-generic audit failed");
    } finally {
      setAuditing(false);
    }
  };

  const onActivate = async (id: string) => {
    try {
      await activateDesignManifest(id);
      showToast("Activated manifest version");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Activation failed", { error: true });
    }
  };

  if (loading) return <LoadingPage title="Design" />;
  if (error) return <Page title="Design"><ErrorBanner message={error} onRetry={load} /></Page>;

  const rows = (manifests ?? []).map((m) => [
    `v${m.version}`,
    m.name,
    m.source,
    m.isActive ? <Badge tone="success">Active</Badge> : <Button size="slim" onClick={() => onActivate(m.manifestId)}>Set active</Button>,
  ]);

  return (
    <Page title="Design" subtitle="The store's design manifest, a structured record of brand, color, typography, layout, and components.">
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import DESIGN.md" primaryAction={{ content: "Import and set active", onAction: onImport, loading: importing, disabled: importText.trim().length === 0 }} secondaryActions={[{ content: "Cancel", onAction: () => setImportOpen(false) }]}>
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              Paste a DESIGN.md: one heading per area (Brand, Color, Typography, Layout, Components, Media, Motion, Commerce, Responsive) with "- key: value" lines. Prose under a heading is kept as notes.
            </Text>
            <TextField label="DESIGN.md" labelHidden autoComplete="off" multiline={14} monospaced value={importText} onChange={setImportText} placeholder={"# Design: My direction\n\n## Color\n- primary: #111111\n- accent: #ff4d2e\n\n## Typography\n- families: Fraunces, Inter"} />
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal open={exportText !== undefined} onClose={() => setExportText(undefined)} title="DESIGN.md" primaryAction={{ content: "Copy", onAction: () => { void navigator.clipboard?.writeText(exportText ?? ""); showToast("Copied DESIGN.md"); } }} secondaryActions={[{ content: "Close", onAction: () => setExportText(undefined) }]}>
        <Modal.Section>
          <TextField label="DESIGN.md" labelHidden autoComplete="off" multiline={18} monospaced value={exportText ?? ""} onChange={() => undefined} readOnly />
        </Modal.Section>
      </Modal>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Active manifest
                </Text>
                <InlineStack gap="200">
                  <Button onClick={() => setImportOpen(true)}>Import DESIGN.md</Button>
                  <Button onClick={onExport} disabled={!active}>
                    Export DESIGN.md
                  </Button>
                  <Button onClick={onExtract} loading={extracting}>
                    Extract from theme
                  </Button>
                </InlineStack>
              </InlineStack>
              {active ? (
                <Text as="p" tone="subdued">
                  {active.name}, v{active.version} ({active.source})
                </Text>
              ) : (
                <Text as="p" tone="subdued">
                  No active manifest yet. Extract one from the live theme to get started.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {active ? (
          <Layout.Section>
            <ManifestPreview manifest={active.manifest} />
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Versions
              </Text>
              {rows.length > 0 ? (
                <DataTable columnContentTypes={["text", "text", "text", "text"]} headings={["Version", "Name", "Source", ""]} rows={rows} />
              ) : (
                <Text as="p" tone="subdued">
                  No versions yet.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Anti-generic audit (Pro)
                </Text>
                <Button onClick={onRunAntiGenericAudit} loading={auditing}>
                  Run anti-generic audit
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                Deterministically scans the live theme for generic patterns (centered heroes, repeated card rows, glassmorphism, fake stats, generic AI wording, and more). Not an aesthetic score, a checklist for you or your AI assistant to act on.
              </Text>
              {auditError ? <Banner tone="critical" title={auditError} /> : null}
              {auditFindings ? (
                auditFindings.length === 0 ? (
                  <Banner tone="success" title="No anti-generic patterns found" />
                ) : (
                  <BlockStack gap="200">
                    {auditFindings.map((f) => (
                      <Box key={f.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">
                              {f.title}
                            </Text>
                            <Badge tone={f.severity === "CRITICAL" || f.severity === "HIGH" ? "critical" : f.severity === "MEDIUM" ? "warning" : undefined}>{f.severity}</Badge>
                          </InlineStack>
                          <Text as="p" tone="subdued">
                            {f.detail}
                          </Text>
                          {f.suggestedFix ? (
                            <Text as="p" tone="subdued">
                              Suggested fix: {f.suggestedFix}
                            </Text>
                          ) : null}
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                )
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Edit as JSON
              </Text>
              <TextField label="Name" autoComplete="off" value={editorName} onChange={setEditorName} />
              <TextField label="Manifest JSON" autoComplete="off" multiline={12} value={editorText} onChange={setEditorText} />
              {validation ? (
                <Banner tone={validation.valid ? "success" : "warning"} title={validation.valid ? "Manifest is valid" : "Validation issues"}>
                  <BlockStack gap="100">
                    {validation.schemaIssues.map((issue, i) => (
                      <Text as="p" key={`schema-${i}`}>
                        {typeof issue === "object" && issue && "message" in (issue as any) ? String((issue as any).message) : JSON.stringify(issue)}
                      </Text>
                    ))}
                    {validation.semanticIssues.map((issue, i) => (
                      <Text as="p" key={`semantic-${i}`}>
                        [{issue.severity}] {issue.path}: {issue.message}
                      </Text>
                    ))}
                  </BlockStack>
                </Banner>
              ) : null}
              <InlineStack gap="200">
                <Button onClick={onValidate}>Validate</Button>
                <Button variant="primary" onClick={onSave} loading={saving}>
                  Save as new version
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <Box paddingBlockEnd="800" />
    </Page>
  );
}

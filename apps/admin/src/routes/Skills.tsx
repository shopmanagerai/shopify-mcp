import React, { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Modal,
  FormLayout,
  TextField,
  Select,
} from "@shopify/polaris";
import { createSkill, deleteSkill, getSkill, getSkills, setSkillEnabled, updateSkill } from "../api/client";
import type { SkillDetail, SkillItem, SkillsResponse } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../lib/toast";

const TIER_OPTIONS = [
  { label: "Free", value: "free" },
  { label: "Pro", value: "pro" },
  { label: "Agency", value: "agency" },
];

interface EditorState {
  originalName?: string; // set when editing an existing skill; unset when creating
  isBuiltin: boolean;
  name: string;
  title: string;
  description: string;
  tier: string;
  body: string;
}

const EMPTY_EDITOR: EditorState = { isBuiltin: false, name: "", title: "", description: "", tier: "free", body: "" };

export function Skills() {
  const { showToast } = useToast();
  const [data, setData] = useState<SkillsResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(undefined);
    getSkills()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load skills"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => setEditor({ ...EMPTY_EDITOR });

  const openEdit = async (skill: SkillItem) => {
    try {
      const { skill: detail } = await getSkill(skill.name);
      setEditor({ originalName: detail.name, isBuiltin: detail.source === "builtin", name: detail.name, title: detail.title, description: detail.description, tier: detail.tier, body: detail.body });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load skill", { error: true });
    }
  };

  const closeEditor = () => setEditor(null);

  const save = async () => {
    if (!editor) return;
    if (!/^[a-z0-9-]+$/.test(editor.name)) {
      showToast("Name must be lowercase letters, digits, and hyphens only", { error: true });
      return;
    }
    setSaving(true);
    try {
      if (editor.originalName) {
        await updateSkill(editor.originalName, { title: editor.title, description: editor.description, tier: editor.tier, body: editor.body });
        showToast(editor.isBuiltin ? "Saved as a custom copy" : "Skill updated");
      } else {
        await createSkill({ name: editor.name, title: editor.title, description: editor.description, tier: editor.tier, body: editor.body });
        showToast("Skill created");
      }
      setEditor(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save skill", { error: true });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSkill(deleteTarget.name);
      showToast("Skill deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete skill", { error: true });
    } finally {
      setDeleting(false);
    }
  };

  const toggleEnabled = async (skill: SkillItem) => {
    setTogglingName(skill.name);
    try {
      await setSkillEnabled(skill.name, !skill.enabled);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update skill", { error: true });
    } finally {
      setTogglingName(null);
    }
  };

  if (loading) return <LoadingPage title="Skills" />;
  if (error || !data) return <Page title="Skills"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Skills" subtitle="MCP prompts your AI client can invoke to guide multi-step work." primaryAction={{ content: "New skill", onAction: openCreate }}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: "skill", plural: "skills" }}
              items={data.skills}
              renderItem={(skill) => (
                <ResourceItem id={skill.name} onClick={() => {}}>
                  <BlockStack gap="100">
                    <InlineStack gap="150" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {skill.title}
                      </Text>
                      <Badge tone={skill.source === "custom" ? "info" : undefined}>{skill.source === "custom" ? "Custom" : "Built-in"}</Badge>
                      {skill.tier !== "free" ? <Badge>{skill.tier}</Badge> : null}
                      <Badge tone={skill.enabled ? "success" : undefined}>{skill.enabled ? "Enabled" : "Disabled"}</Badge>
                    </InlineStack>
                    <Text as="span" tone="subdued">
                      {skill.description}
                    </Text>
                    <Text as="span" tone="subdued">
                      Use in your AI client with: <code>{skill.name}</code>
                    </Text>
                    <InlineStack gap="200">
                      <Button size="slim" loading={togglingName === skill.name} onClick={() => toggleEnabled(skill)}>
                        {skill.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button size="slim" onClick={() => openEdit(skill)}>
                        {skill.source === "builtin" ? "Edit (make custom copy)" : "Edit"}
                      </Button>
                      {skill.source === "custom" ? (
                        <Button size="slim" tone="critical" onClick={() => setDeleteTarget(skill)}>
                          Delete
                        </Button>
                      ) : null}
                    </InlineStack>
                  </BlockStack>
                </ResourceItem>
              )}
            />
          </Card>
        </Layout.Section>
      </Layout>

      {editor ? (
        <Modal
          open
          onClose={closeEditor}
          title={editor.originalName ? (editor.isBuiltin ? "Edit skill (saves as a custom copy)" : "Edit skill") : "New skill"}
          primaryAction={{ content: "Save", onAction: save, loading: saving }}
          secondaryActions={[{ content: "Cancel", onAction: closeEditor }]}
        >
          <Modal.Section>
            <FormLayout>
              <TextField
                label="Name (used by AI clients, e.g. audit-store)"
                value={editor.name}
                onChange={(v) => setEditor({ ...editor, name: v })}
                disabled={!!editor.originalName}
                autoComplete="off"
                helpText="Lowercase letters, digits, and hyphens only."
              />
              <TextField label="Title" value={editor.title} onChange={(v) => setEditor({ ...editor, title: v })} autoComplete="off" />
              <TextField label="Description" value={editor.description} onChange={(v) => setEditor({ ...editor, description: v })} multiline={2} autoComplete="off" />
              <Select label="Tier" options={TIER_OPTIONS} value={editor.tier} onChange={(v) => setEditor({ ...editor, tier: v })} />
              <TextField
                label="Body"
                value={editor.body}
                onChange={(v) => setEditor({ ...editor, body: v })}
                multiline={10}
                autoComplete="off"
                helpText="Plain text/Markdown, no YAML frontmatter, up to 32KB. This is the prompt text sent to the AI client."
              />
            </FormLayout>
          </Modal.Section>
        </Modal>
      ) : null}

      <ConfirmModal
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.title ?? ""}"?`}
        content="This permanently removes the custom skill. This cannot be undone."
        primaryAction="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Page>
  );
}

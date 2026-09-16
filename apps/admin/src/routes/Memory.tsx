import React, { useEffect, useMemo, useState } from "react";
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
  Checkbox,
} from "@shopify/polaris";
import {
  createMemory,
  deleteMemory,
  getMemories,
  getMemorySettings,
  getMemoryVersions,
  restoreMemory,
  setMemorySettings,
  updateMemory,
} from "../api/client";
import type { MemoryRecord, MemoryType, MemoryVersionRecord } from "../api/types";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../lib/toast";

const TYPE_OPTIONS: Array<{ label: string; value: MemoryType }> = [
  { label: "User", value: "user" },
  { label: "Feedback", value: "feedback" },
  { label: "Project", value: "project" },
  { label: "Reference", value: "reference" },
  { label: "Design", value: "design" },
];

const TYPE_TONE: Record<MemoryType, "info" | "success" | "attention" | "warning" | undefined> = {
  user: "info",
  feedback: "success",
  project: "attention",
  reference: undefined,
  design: "warning",
};

interface EditorState {
  originalId?: string;
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}

const EMPTY_EDITOR: EditorState = { name: "", description: "", type: "user", content: "" };

export function Memory() {
  const { showToast } = useToast();
  const [memories, setMemories] = useState<MemoryRecord[] | undefined>();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [historyFor, setHistoryFor] = useState<MemoryRecord | null>(null);
  const [versions, setVersions] = useState<MemoryVersionRecord[] | undefined>();
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  const load = () => {
    setLoading(true);
    setError(undefined);
    Promise.all([getMemories(), getMemorySettings()])
      .then(([m, s]) => {
        setMemories(m.memories);
        setEnabled(s.enabled);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load memory"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!memories) return [];
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter((m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.content.toLowerCase().includes(q));
  }, [memories, query]);

  const toggleEnabled = async (value: boolean) => {
    setTogglingEnabled(true);
    try {
      const res = await setMemorySettings(value);
      setEnabled(res.enabled);
      showToast(res.enabled ? "Memory enabled" : "Memory disabled");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update memory settings", { error: true });
    } finally {
      setTogglingEnabled(false);
    }
  };

  const openCreate = () => setEditor({ ...EMPTY_EDITOR });
  const openEdit = (memory: MemoryRecord) => setEditor({ originalId: memory.id, name: memory.name, description: memory.description, type: memory.type, content: memory.content });
  const closeEditor = () => setEditor(null);

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const body = { name: editor.name, description: editor.description, type: editor.type, content: editor.content };
      if (editor.originalId) {
        await updateMemory(editor.originalId, body);
        showToast("Memory updated");
      } else {
        await createMemory(body);
        showToast("Memory saved");
      }
      setEditor(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save memory", { error: true });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteMemory(deleteTarget.id);
      showToast("Memory deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete memory", { error: true });
    } finally {
      setDeleting(false);
    }
  };

  const openHistory = async (memory: MemoryRecord) => {
    setHistoryFor(memory);
    setVersions(undefined);
    try {
      const res = await getMemoryVersions(memory.id);
      setVersions(res.versions);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load history", { error: true });
    }
  };

  const closeHistory = () => {
    setHistoryFor(null);
    setVersions(undefined);
  };

  const restoreVersion = async (version: number) => {
    if (!historyFor) return;
    setRestoringVersion(version);
    try {
      await restoreMemory(historyFor.id, version);
      showToast(`Restored version ${version}`);
      closeHistory();
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to restore version", { error: true });
    } finally {
      setRestoringVersion(null);
    }
  };

  if (loading) return <LoadingPage title="Memory" />;
  if (error || !memories) return <Page title="Memory"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Memory" subtitle="Persistent, database-backed memories your AI client builds up across conversations." primaryAction={{ content: "New memory", onAction: openCreate }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Checkbox
                label="Enable memory for this store"
                checked={enabled}
                disabled={togglingEnabled}
                onChange={toggleEnabled}
                helpText="When disabled, discover-tools and the commerce://memory/index resource stop surfacing the memory index, and commerce.memory.* tools are unaffected but effectively unused."
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <div style={{ padding: 16 }}>
              <TextField label="Search" labelHidden placeholder="Search memories by name, description, or content" value={query} onChange={setQuery} autoComplete="off" />
            </div>
            <ResourceList
              resourceName={{ singular: "memory", plural: "memories" }}
              items={filtered}
              emptyState={
                <div style={{ padding: 24, textAlign: "center" }}>
                  <Text as="p" tone="subdued">
                    {memories.length === 0 ? "No memories yet." : "No memories match your search."}
                  </Text>
                </div>
              }
              renderItem={(memory) => (
                <ResourceItem id={memory.id} onClick={() => {}}>
                  <BlockStack gap="100">
                    <InlineStack gap="150" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {memory.name}
                      </Text>
                      <Badge tone={TYPE_TONE[memory.type]}>{memory.type}</Badge>
                      <Text as="span" tone="subdued">
                        v{memory.version}
                      </Text>
                    </InlineStack>
                    <Text as="span" tone="subdued">
                      {memory.description}
                    </Text>
                    <InlineStack gap="200">
                      <Button size="slim" onClick={() => openEdit(memory)}>
                        Edit
                      </Button>
                      <Button size="slim" onClick={() => openHistory(memory)}>
                        History
                      </Button>
                      <Button size="slim" tone="critical" onClick={() => setDeleteTarget(memory)}>
                        Delete
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </ResourceItem>
              )}
            />
          </Card>
        </Layout.Section>
      </Layout>

      {editor ? (
        <Modal open onClose={closeEditor} title={editor.originalId ? "Edit memory" : "New memory"} primaryAction={{ content: "Save", onAction: save, loading: saving }} secondaryActions={[{ content: "Cancel", onAction: closeEditor }]}>
          <Modal.Section>
            <FormLayout>
              <TextField label="Name" value={editor.name} onChange={(v) => setEditor({ ...editor, name: v })} autoComplete="off" />
              <TextField label="Description" value={editor.description} onChange={(v) => setEditor({ ...editor, description: v })} multiline={2} autoComplete="off" helpText="A specific one-line hook, how future-you decides relevance." />
              <Select label="Type" options={TYPE_OPTIONS} value={editor.type} onChange={(v) => setEditor({ ...editor, type: v as MemoryType })} />
              <TextField label="Content" value={editor.content} onChange={(v) => setEditor({ ...editor, content: v })} multiline={10} autoComplete="off" helpText="Plain text, up to 32KB." />
            </FormLayout>
          </Modal.Section>
        </Modal>
      ) : null}

      <Modal open={Boolean(historyFor)} onClose={closeHistory} title={`History: ${historyFor?.name ?? ""}`} size="large">
        <Modal.Section>
          {versions === undefined ? (
            <Text as="p" tone="subdued">
              Loading…
            </Text>
          ) : versions.length === 0 ? (
            <Text as="p" tone="subdued">
              No version history.
            </Text>
          ) : (
            <BlockStack gap="300">
              {versions.map((v) => (
                <Card key={v.version}>
                  <BlockStack gap="150">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        Version {v.version}
                      </Text>
                      <Button size="slim" onClick={() => restoreVersion(v.version)} loading={restoringVersion === v.version}>
                        Restore this version
                      </Button>
                    </InlineStack>
                    <Text as="span" tone="subdued">
                      {v.description} · saved {v.savedAt}
                    </Text>
                    <Text as="span" tone="subdued" truncate>
                      {v.content.slice(0, 200)}
                      {v.content.length > 200 ? "…" : ""}
                    </Text>
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        content="This permanently removes the memory and its version history. This cannot be undone."
        primaryAction="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Page>
  );
}

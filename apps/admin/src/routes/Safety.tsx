import React, { useEffect, useMemo, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Checkbox,
  TextField,
  Button,
  Badge,
  Divider,
} from "@shopify/polaris";
import { getConnect, getPolicyProfiles, getTools, setToolEnabled, updateCredential } from "../api/client";
import type { ConnectResponse, PolicyProfilesResponse, Profile, ToolsResponse } from "../api/types";
import { AvailabilityBadge, RiskBadge } from "../components/badges";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { useToast } from "../lib/toast";

function CredentialEditor({ profiles }: { profiles: PolicyProfilesResponse }) {
  const { showToast } = useToast();
  const [connect, setConnect] = useState<ConnectResponse | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [localProfile, setLocalProfile] = useState<Profile>("production_safe");
  const [localPolicy, setLocalPolicy] = useState<Record<string, boolean | number | string>>({});

  useEffect(() => {
    getConnect().then((c) => {
      setConnect(c);
      const first = c.tokens[0];
      if (first) {
        setSelectedId(first.credentialId);
        setLocalProfile(first.profile);
        setLocalPolicy(first.policy);
      }
    });
  }, []);

  const selected = connect?.tokens.find((t) => t.credentialId === selectedId);

  const selectCredential = (id: string) => {
    setSelectedId(id);
    const cred = connect?.tokens.find((t) => t.credentialId === id);
    if (cred) {
      setLocalProfile(cred.profile);
      setLocalPolicy(cred.policy);
    }
  };

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await updateCredential(selectedId, { profile: localProfile, policy: localPolicy });
      setConnect((prev) => (prev ? { ...prev, tokens: prev.tokens.map((t) => (t.credentialId === selectedId ? res.credential : t)) } : prev));
      showToast("Safety profile saved");
    } finally {
      setSaving(false);
    }
  };

  if (!connect) return null;
  if (connect.tokens.length === 0) {
    return (
      <Text as="p" tone="subdued">
        No credentials yet. Create a token on the Connect page first.
      </Text>
    );
  }

  return (
    <BlockStack gap="300">
      <Select
        label="Credential"
        options={connect.tokens.map((t) => ({ label: t.label, value: t.credentialId }))}
        value={selectedId}
        onChange={selectCredential}
      />
      {selected ? (
        <BlockStack gap="300">
          <Select
            label="Profile"
            options={profiles.profiles.map((p) => ({ label: `${p.label}, ${p.description}`, value: p.id }))}
            value={localProfile}
            onChange={(v) => setLocalProfile(v as Profile)}
          />
          <Text as="h3" variant="headingSm">
            Custom policy overrides
          </Text>
          <BlockStack gap="200">
            {profiles.policyKeys.map((pk) => {
              const value = localPolicy[pk.key] ?? pk.default;
              if (pk.type === "boolean") {
                return (
                  <Checkbox
                    key={pk.key}
                    label={`${pk.key}, ${pk.description}`}
                    checked={Boolean(value)}
                    onChange={(checked) => setLocalPolicy((p) => ({ ...p, [pk.key]: checked }))}
                  />
                );
              }
              if (pk.type === "number") {
                return (
                  <TextField
                    key={pk.key}
                    label={`${pk.key}, ${pk.description}`}
                    type="number"
                    autoComplete="off"
                    value={String(value ?? "")}
                    onChange={(v) => setLocalPolicy((p) => ({ ...p, [pk.key]: Number(v) }))}
                  />
                );
              }
              return (
                <TextField
                  key={pk.key}
                  label={`${pk.key}, ${pk.description}`}
                  autoComplete="off"
                  value={String(value ?? "")}
                  onChange={(v) => setLocalPolicy((p) => ({ ...p, [pk.key]: v }))}
                />
              );
            })}
          </BlockStack>
          <InlineStack>
            <Button variant="primary" onClick={save} loading={saving}>
              Save
            </Button>
          </InlineStack>
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}

function ToolCatalog() {
  const [tools, setTools] = useState<ToolsResponse | undefined>();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setError(undefined);
    getTools()
      .then(setTools)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tools"));
  };

  useEffect(load, []);

  const toggle = async (name: string, enabled: boolean) => {
    setTools((prev) => (prev ? { ...prev, disabled: enabled ? prev.disabled.filter((n) => n !== name) : [...prev.disabled, name] } : prev));
    try {
      await setToolEnabled(name, enabled);
    } catch {
      load();
    }
  };

  const grouped = useMemo(() => {
    if (!tools) return [];
    const filtered = tools.cards.filter(
      (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()),
    );
    const byCategory = new Map<string, typeof filtered>();
    for (const card of filtered) {
      const list = byCategory.get(card.category) ?? [];
      list.push(card);
      byCategory.set(card.category, list);
    }
    return Array.from(byCategory.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools, search]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!tools) return null;

  return (
    <BlockStack gap="300">
      <TextField label="Search tools" labelHidden placeholder="Search by name or description" value={search} onChange={setSearch} autoComplete="off" />
      {grouped.map(([category, cards]) => (
        <Card key={category}>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              {category.replace(/_/g, " ")}
            </Text>
            <BlockStack gap="200">
              {cards.map((card) => {
                const isDisabled = tools.disabled.includes(card.name);
                return (
                  <React.Fragment key={card.name}>
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <InlineStack gap="150" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {card.name}
                          </Text>
                          <RiskBadge risk={card.risk} />
                          <AvailabilityBadge availability={card.availability} />
                          {card.tier !== "free" ? <Badge>{card.tier}</Badge> : null}
                        </InlineStack>
                        <Text as="span" tone="subdued">
                          {card.description}
                        </Text>
                        {card.reason ? (
                          <Text as="span" tone="subdued">
                            {card.reason}
                          </Text>
                        ) : null}
                      </BlockStack>
                      <Checkbox label="Enabled" labelHidden checked={!isDisabled} onChange={(checked) => toggle(card.name, checked)} />
                    </InlineStack>
                    <Divider />
                  </React.Fragment>
                );
              })}
            </BlockStack>
          </BlockStack>
        </Card>
      ))}
    </BlockStack>
  );
}

export function Safety() {
  const [profiles, setProfiles] = useState<PolicyProfilesResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    getPolicyProfiles()
      .then(setProfiles)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load profiles"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <LoadingPage title="Safety" />;
  if (error || !profiles) return <Page title="Safety"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  return (
    <Page title="Safety" subtitle="Control what each credential is allowed to do.">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Credential profile
              </Text>
              <CredentialEditor profiles={profiles} />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Text as="h2" variant="headingMd">
            Tool catalog
          </Text>
        </Layout.Section>
        <Layout.Section>
          <ToolCatalog />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

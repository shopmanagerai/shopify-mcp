import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Icon } from "@shopify/polaris";
import { CheckCircleIcon, MinusCircleIcon } from "@shopify/polaris-icons";
import { useSession } from "../lib/session";
import { getConnect, getThemeAccess, getTheme, getSnapshots } from "../api/client";
import { LoadingPage, ErrorBanner } from "../components/Misc";

interface Step {
  key: string;
  title: string;
  description: string;
  done: boolean;
  path: string;
  cta: string;
}

export function Onboarding() {
  const navigate = useNavigate();
  const { session, loading: sessionLoading, error: sessionError, refresh: refreshSession } = useSession();
  const [steps, setSteps] = useState<Step[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    setError(undefined);
    Promise.all([getConnect(), getThemeAccess(), getTheme(), getSnapshots()])
      .then(([connect, themeAccess, theme, snapshots]) => {
        setSteps([
          {
            key: "install",
            title: "Install ShopManager AI",
            description: "The app is installed and connected to your store.",
            done: true,
            path: "/",
            cta: "Overview",
          },
          {
            key: "theme_access",
            title: "Configure Theme Access",
            description: "Add a Theme Access password so theme read/write tools can run.",
            done: themeAccess.configured,
            path: "/connect",
            cta: "Configure Theme Access",
          },
          {
            key: "token",
            title: "Create your first token",
            description: "Issue a token and connect an AI client (Claude, Cursor, etc.) over MCP.",
            done: connect.tokens.length > 0,
            path: "/connect",
            cta: "Create a token",
          },
          {
            key: "working_theme",
            title: "Create a working theme",
            description: "ShopManager AI writes to a dedicated working theme, never directly to your live theme.",
            done: theme.working !== null,
            path: "/theme",
            cta: "Go to Theme",
          },
          {
            key: "snapshot",
            title: "Take your first snapshot",
            description: "Snapshots let you roll back any theme change ShopManager AI (or your AI client) makes.",
            done: snapshots.items.length > 0,
            path: "/snapshots",
            cta: "Go to Snapshots",
          },
        ]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load onboarding status"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (sessionLoading || loading) return <LoadingPage title="Get started" />;
  if (sessionError) return <Page title="Get started"><ErrorBanner message={sessionError} onRetry={refreshSession} /></Page>;
  if (error || !steps) return <Page title="Get started"><ErrorBanner message={error ?? "Failed to load"} onRetry={load} /></Page>;

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Page title="Get started" subtitle={`${doneCount} of ${steps.length} steps complete`}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {steps.map((step) => (
                <InlineStack key={step.key} align="space-between" blockAlign="center" gap="400" wrap={false}>
                  <InlineStack gap="300" blockAlign="center">
                    <Icon source={step.done ? CheckCircleIcon : MinusCircleIcon} tone={step.done ? "success" : "subdued"} />
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">
                        {step.title}
                      </Text>
                      <Text as="p" tone="subdued">
                        {step.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Button onClick={() => navigate(step.path)} variant={step.done ? "secondary" : "primary"}>
                    {step.done ? "View" : step.cta}
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/** True when at least one onboarding step still needs attention, used by Home.tsx to show a banner. */
export function isOnboardingIncomplete(steps: { done: boolean }[]): boolean {
  return steps.some((s) => !s.done);
}

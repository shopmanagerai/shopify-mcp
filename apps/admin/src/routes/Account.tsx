import React, { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, List, TextField, Banner } from "@shopify/polaris";
import { useSession } from "../lib/session";
import { EntitlementBadge } from "../components/badges";
import { ErrorBanner, LoadingPage } from "../components/Misc";
import { getEntitlement, activateLicense, deactivateLicense } from "../api/client";
import type { EntitlementResponse } from "../api/types";
import { useToast } from "../lib/toast";

function GraceNotice({ graceUntil }: { graceUntil: string }) {
  const hoursLeft = Math.max(0, Math.round((new Date(graceUntil).getTime() - Date.now()) / (1000 * 60 * 60)));
  return (
    <Banner tone="warning" title="Pro access is in a grace period">
      <p>
        We couldn't reconfirm your license with Freemius. Read-only Pro tools remain available for about {hoursLeft}h more (until{" "}
        {new Date(graceUntil).toLocaleString()}), after which the shop reverts to Free until the license reconfirms.
      </p>
    </Banner>
  );
}

export function Account() {
  const { session, loading, error, refresh } = useSession();
  const { showToast } = useToast();
  const [entitlement, setEntitlement] = useState<EntitlementResponse | undefined>();
  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const loadEntitlement = () => {
    getEntitlement()
      .then(setEntitlement)
      .catch(() => setEntitlement(undefined));
  };

  useEffect(loadEntitlement, []);

  if (loading) return <LoadingPage title="Account" />;
  if (error || !session) return <Page title="Account"><ErrorBanner message={error ?? "Failed to load"} onRetry={refresh} /></Page>;

  const state = entitlement?.state ?? session.entitlement.state;
  const plan = entitlement?.plan ?? session.entitlement.plan;
  const entitlements = entitlement?.entitlements ?? session.entitlement.entitlements;
  const upgradeUrl = entitlement?.upgradeUrl ?? session.entitlement.upgradeUrl;
  const isFree = state === "FREE" || state === "PRO_EXPIRED";

  const onActivate = async () => {
    if (!licenseKey.trim()) return;
    setActivating(true);
    try {
      const result = await activateLicense(licenseKey.trim());
      if (result.ok) {
        showToast("License activated");
        setLicenseKey("");
        loadEntitlement();
        refresh();
      } else {
        showToast(result.message ?? "Activation failed", { error: true });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Activation failed", { error: true });
    } finally {
      setActivating(false);
    }
  };

  const onDeactivate = async () => {
    setDeactivating(true);
    try {
      await deactivateLicense();
      showToast("License deactivated");
      loadEntitlement();
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Deactivation failed", { error: true });
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <Page title="Account">
      <Layout>
        {entitlement?.graceUntil ? (
          <Layout.Section>
            <GraceNotice graceUntil={entitlement.graceUntil} />
          </Layout.Section>
        ) : null}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Plan
                </Text>
                <EntitlementBadge state={state} />
              </InlineStack>
              <Text as="p" tone="subdued">
                {plan ?? state}
              </Text>
              {entitlement?.seats ? (
                <Text as="p" tone="subdued">
                  Seats: {entitlement.seats.members} member{entitlement.seats.members === 1 ? "" : "s"} across {entitlement.seats.shops} shop
                  {entitlement.seats.shops === 1 ? "" : "s"}
                </Text>
              ) : null}
              {isFree && entitlement?.shopifyPricingUrl ? (
                <InlineStack gap="200">
                  <Button variant="primary" url={entitlement.shopifyPricingUrl} target="_top">
                    Upgrade to Pro (billed by Shopify)
                  </Button>
                  <Button url={upgradeUrl} target="_blank">
                    Agency plans for many stores
                  </Button>
                </InlineStack>
              ) : null}
              {entitlement?.billedVia === "shopify" && !isFree ? (
                <Text as="p" tone="subdued">
                  Billed through your Shopify invoice. Change or cancel the plan from{" "}
                  <a href={entitlement.shopifyPricingUrl ?? "#"} target="_top" rel="noreferrer">
                    Shopify's pricing page
                  </a>
                  .
                </Text>
              ) : null}
              <Text as="h3" variant="headingSm">
                Entitlements
              </Text>
              <List>
                {entitlements.map((e) => (
                  <List.Item key={e}>{e}</List.Item>
                ))}
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                License
              </Text>
              {isFree ? (
                <>
                  <Text as="p" tone="subdued">
                    Bought a plan on shopmanagerai.com instead? Paste the license key from the receipt email.
                  </Text>
                  <TextField
                    label="License key"
                    type="password"
                    autoComplete="off"
                    value={licenseKey}
                    onChange={setLicenseKey}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                  />
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={onActivate} loading={activating} disabled={!licenseKey.trim()}>
                      Activate with license key
                    </Button>
                    <Button url={upgradeUrl} target="_blank">
                      Upgrade
                    </Button>
                  </InlineStack>
                </>
              ) : (
                <InlineStack gap="200">
                  <Button tone="critical" onClick={onDeactivate} loading={deactivating}>
                    Deactivate
                  </Button>
                  <Button url={upgradeUrl} target="_blank">
                    Manage subscription
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

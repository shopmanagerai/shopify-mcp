import React from "react";
import { Badge } from "@shopify/polaris";
import type { EntitlementState, RiskClass } from "@shopmanagerai/shared";

export function EntitlementBadge({ state }: { state: EntitlementState }) {
  const map: Record<EntitlementState, { tone: "success" | "info" | "attention" | "warning" | "critical"; label: string }> = {
    FREE: { tone: "info", label: "Free" },
    TRIAL: { tone: "attention", label: "Trial" },
    PRO_ACTIVE: { tone: "success", label: "Pro" },
    PRO_GRACE: { tone: "warning", label: "Pro (grace period)" },
    PRO_EXPIRED: { tone: "critical", label: "Pro expired" },
    AGENCY_ACTIVE: { tone: "success", label: "Agency" },
    SUSPENDED: { tone: "critical", label: "Suspended" },
  };
  const entry = map[state];
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function RiskBadge({ risk }: { risk: RiskClass }) {
  const tones: Record<RiskClass, "info" | "attention" | "warning" | "critical" | undefined> = {
    read: undefined,
    write: "info",
    theme_write: "info",
    bulk: "attention",
    commerce_sensitive: "attention",
    destructive: "critical",
    publish: "warning",
    critical: "critical",
  };
  return <Badge tone={tones[risk]}>{risk.replace(/_/g, " ")}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, "success" | "critical" | "info" | "attention" | "warning" | undefined> = {
    succeeded: "success",
    ok: "success",
    pending: "info",
    failed: "critical",
    fail: "critical",
    rolled_back: "attention",
    warn: "warning",
    skip: undefined,
  };
  return <Badge tone={tones[status]}>{status.replace(/_/g, " ")}</Badge>;
}

export function AvailabilityBadge({ availability }: { availability: string }) {
  const map: Record<string, { tone: "success" | "info" | "attention" | "warning" | "critical" | undefined; label: string }> = {
    available: { tone: "success", label: "Available" },
    pro_required: { tone: "attention", label: "Pro" },
    agency_required: { tone: "attention", label: "Agency" },
    scope_missing: { tone: "warning", label: "Scope missing" },
    capability_missing: { tone: "warning", label: "Capability missing" },
    profile_denied: { tone: "critical", label: "Denied by profile" },
    unverified: { tone: undefined, label: "Unverified" },
  };
  const entry = map[availability] ?? { tone: undefined, label: availability };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

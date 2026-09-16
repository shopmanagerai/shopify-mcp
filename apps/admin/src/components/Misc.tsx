import React from "react";
import { Banner, Button, InlineStack, SkeletonBodyText, SkeletonPage, Card } from "@shopify/polaris";
import { copyToClipboard } from "../lib/clipboard";
import { useToast } from "../lib/toast";

export function LoadingPage({ title }: { title: string }) {
  return (
    <SkeletonPage title={title}>
      <Card>
        <SkeletonBodyText lines={6} />
      </Card>
    </SkeletonPage>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner tone="critical" title="Something went wrong">
      <InlineStack gap="200" align="space-between" blockAlign="center">
        <p>{message}</p>
        {onRetry ? (
          <Button onClick={onRetry} size="slim">
            Retry
          </Button>
        ) : null}
      </InlineStack>
    </Banner>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const { showToast } = useToast();
  return (
    <Button
      size="slim"
      onClick={async () => {
        const ok = await copyToClipboard(value);
        showToast(ok ? "Copied to clipboard" : "Could not copy", { error: !ok });
      }}
    >
      {label}
    </Button>
  );
}

export function MonoBlock({ text }: { text: string }) {
  return (
    <pre
      style={{
        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
        border: "1px solid var(--p-color-border, #e1e3e5)",
        borderRadius: 8,
        padding: "12px",
        overflowX: "auto",
        fontSize: 12,
        lineHeight: 1.5,
        margin: 0,
        whiteSpace: "pre",
      }}
    >
      <code>{text}</code>
    </pre>
  );
}

/** Coarse "2 min ago" / "3 days ago" style relative time for a small list row, not a live-updating clock. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre
      style={{
        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
        border: "1px solid var(--p-color-border, #e1e3e5)",
        borderRadius: 8,
        padding: "12px",
        overflowX: "auto",
        fontSize: 12,
        lineHeight: 1.6,
        margin: 0,
      }}
    >
      {lines.map((line, i) => {
        let color: string | undefined;
        if (line.startsWith("+") && !line.startsWith("+++")) color = "#108043";
        else if (line.startsWith("-") && !line.startsWith("---")) color = "#d72c0d";
        else if (line.startsWith("@@")) color = "#5c6ac4";
        return (
          <div key={i} style={{ color }}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

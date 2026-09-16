import React from "react";
import { Modal, TextContainer } from "@shopify/polaris";

export function ConfirmModal({
  open,
  title,
  content,
  primaryAction = "Confirm",
  destructive = true,
  loading,
  disabled,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  content?: string;
  primaryAction?: string;
  destructive?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      primaryAction={{
        content: primaryAction,
        destructive,
        loading,
        disabled,
        onAction: onConfirm,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        {content ? (
          <TextContainer>
            <p>{content}</p>
          </TextContainer>
        ) : null}
        {children}
      </Modal.Section>
    </Modal>
  );
}

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Toast } from "@shopify/polaris";

interface ToastState {
  message: string;
  error?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, opts?: { error?: boolean }) => void;
  toast: ToastState | undefined;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Holds toast state above the router. Polaris `<Toast>` must render inside a
 * `<Frame>`, so the actual element is emitted by `<ToastOutlet />`, which the
 * app shell places inside its Frame.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | undefined>(undefined);

  const showToast = useCallback((message: string, opts?: { error?: boolean }) => {
    setToast({ message, error: opts?.error });
  }, []);
  const dismiss = useCallback(() => setToast(undefined), []);

  const value = useMemo(() => ({ showToast, toast, dismiss }), [showToast, toast, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Render inside the Polaris `<Frame>`. */
export function ToastOutlet() {
  const ctx = useContext(ToastContext);
  if (!ctx?.toast) return null;
  return <Toast content={ctx.toast.message} error={ctx.toast.error} onDismiss={ctx.dismiss} duration={3500} />;
}

export function useToast(): Pick<ToastContextValue, "showToast"> {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return { showToast: ctx.showToast };
}

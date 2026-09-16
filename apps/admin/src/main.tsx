import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import enTranslations from "@shopify/polaris/locales/en.json";
import { App } from "./App";
import { ToastProvider, useToast } from "./lib/toast";
import { SessionProvider } from "./lib/session";
import { setGlobalErrorHandler } from "./api/client";

function ErrorBridge() {
  const { showToast } = useToast();
  useEffect(() => {
    setGlobalErrorHandler((err) => {
      showToast(err.message, { error: true });
    });
  }, [showToast]);
  return null;
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <React.StrictMode>
    <AppProvider i18n={enTranslations}>
      <ToastProvider>
        <ErrorBridge />
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </AppProvider>
  </React.StrictMode>,
);

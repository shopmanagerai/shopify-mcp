/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CP_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

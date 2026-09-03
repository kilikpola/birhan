/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Birhan API, e.g. https://api.birhan.online */
  readonly VITE_API_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

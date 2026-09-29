/// <reference types="vite/client" />
/// <reference types="@modyfi/vite-plugin-yaml/modules" />

// NyaaAcount platform public https entry for browser links. Inlined by
// vite.config.ts (define) from NYAAACOUNT_BASE_URL in .env. Public URL
// only — safe for the bundle; the _LAN key never reaches the frontend.
declare const __NYAACOUNT_BASE_URL__: string;
declare module "*.png" {
  const value: string;
  export default value;
}

import type { NextConfig } from "next";

// Sent with every page: no framing (clickjacking), no MIME sniffing, HTTPS only, and no
// referrer across sites, since file download links can carry a user token.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  // The console imports the kernel's dependency-free replay reducer straight from TS source.
  transpilePackages: ["@kernelagent/kernel"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default config;

import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4100";

const config: NextConfig = {
  // The dashboard talks to the API on the same origin so the session cookie
  // stays first-party.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;

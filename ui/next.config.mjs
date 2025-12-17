const backendApiUrl =
  process.env.NEXT_PUBLIC_BACKEND_API_URL ??
  process.env.BACKEND_API_URL ??
  "http://localhost:3000";

const allowedDevOriginsEnv =
  process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS ??
  process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGIN ??
  "";
const allowedDevOrigins = allowedDevOriginsEnv
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const normalizedAllowedOrigins = allowedDevOrigins.map((origin) => {
  try {
    const parsed = new URL(origin);
    return parsed.host;
  } catch {
    return origin.replace(/^https?:\/\//, "");
  }
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: normalizedAllowedOrigins,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;

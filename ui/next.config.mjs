/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS
    ? process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS.split(",").map((origin) =>
        origin.trim(),
      )
    : [],
  async rewrites() {
    const backend =
      process.env.NEXT_PUBLIC_BACKEND_API_URL ??
      process.env.BACKEND_API_URL;
    if (!backend) {
      return [];
    }
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/:path*`,
      },
    ];
  },
};

export default nextConfig;

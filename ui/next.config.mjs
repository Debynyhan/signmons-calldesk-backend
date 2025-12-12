const backendUrl = process.env.BACKEND_API_URL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (!backendUrl) {
      return [];
    }

    const destinationBase = backendUrl.replace(/\/$/, "");

    return [
      {
        source: "/api/:path*",
        destination: `${destinationBase}/:path*`,
      },
    ];
  },
};

export default nextConfig;

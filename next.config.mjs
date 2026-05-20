/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vídeos em base64 podem ser grandes — aumenta limite do body
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
  },
};

export default nextConfig;

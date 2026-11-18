/** @type {import('next').NextConfig} */
const nextConfig = {
  // Increase body size limit for large audio/video file uploads (audio: 15MB, video: 300MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "350mb",
    },
  },

  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },

  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;

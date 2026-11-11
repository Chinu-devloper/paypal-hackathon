import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  webpack(config) {
    config.resolve.alias["@"] = path.join(root, "src");
    return config;
  },
};

export default nextConfig;

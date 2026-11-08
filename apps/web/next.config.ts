import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @axiomic/shared ships raw TypeScript (not compiled JS), so Next.js must compile it.
  transpilePackages: ["@axiomic/shared"],
  // Stop `next dev` from auto-writing an AGENTS.md file into this folder.
  agentRules: false,
};

export default nextConfig;

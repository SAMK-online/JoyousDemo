import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/*": ["./JoyousPM_PatientAssistant_Case/data/**/*.json"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

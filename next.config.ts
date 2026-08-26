import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/*": ["./JoyousPM_PatientAssistant_Case/data/**/*.json"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

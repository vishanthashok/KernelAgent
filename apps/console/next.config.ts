import type { NextConfig } from "next";

const config: NextConfig = {
  // The console imports the kernel's dependency-free replay reducer straight from TS source.
  transpilePackages: ["@kernelagent/kernel"],
};

export default config;

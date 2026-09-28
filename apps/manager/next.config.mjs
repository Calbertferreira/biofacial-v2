/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.MANAGER_DIST_DIR || '.next',
};

export default config;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    'http://127.0.0.1',
    'http://localhost',
    'http://127.0.0.1:3000',
    'http://localhost:3000'
  ]
};

module.exports = nextConfig;

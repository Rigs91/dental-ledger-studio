const nextConfig = require('eslint-config-next');

module.exports = [
  {
    ignores: ['.next/**', 'node_modules/**', 'test-results/**', 'snapshots/**']
  },
  ...nextConfig
];

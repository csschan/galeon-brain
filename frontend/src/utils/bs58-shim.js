// bs58 named-export shim for webpack 5 + WalletConnect compatibility
// bs58@4 is CJS (default export only), but WalletConnect ESM bundles need named exports.
const bs58 = require('bs58');
module.exports = bs58;
module.exports.encode = bs58.encode;
module.exports.decode = bs58.decode;
module.exports.default = bs58;

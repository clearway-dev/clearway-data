// Metro config potrebna pro beh ve webovem prohlizeci. Na Androidu/iOS nic nemeni.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 1) expo-sqlite na webu je WASM -> metro ho musi brat jako asset
// viz docs.expo.dev/versions/latest/sdk/sqlite/#web-setup
config.resolver.assetExts.push('wasm');

// 2) expo-secure-store nema webovou implementaci -> na webu podstrcime localStorage shim
const secureStoreWebShim = path.resolve(__dirname, 'web-shims/expo-secure-store.web.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-secure-store') {
    return { type: 'sourceFile', filePath: secureStoreWebShim };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// 3) SharedArrayBuffer (wa-sqlite) vyzaduje COEP/COOP hlavicky
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  };
};

module.exports = config;

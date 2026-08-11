const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')

// Two targets from one codebase: Chrome (side_panel) -> dist/, Firefox
// (sidebar_action + gecko id) -> firefox/. Only the manifest differs; panel.js
// and background.js are byte-identical (platform.ts feature-detects at runtime).
//   npm run build:chrome | build:firefox | build (both)
module.exports = (env = {}) => {
  const firefox = env.firefox === true || env.firefox === 'true'
  const outDir = firefox ? 'firefox' : 'dist'
  const manifestSrc = firefox ? 'public/manifest.firefox.json' : 'public/manifest.chrome.json'

  return {
  entry: {
    panel: './src/popup/index.tsx',
    background: './src/background/index.ts',
    // Dapp bridge (bdx-web3js protocol): approval window UI, content-script
    // relay, and the main-world provider injected into pages.
    approval: './src/approval/index.tsx',
    content: './src/content/index.ts',
    inpage: './src/inpage/index.ts'
  },
  output: {
    path: path.resolve(__dirname, outDir),
    filename: '[name].js',
    clean: true
  },
  devtool: false, // eval-based devtools violate the MV3 CSP
  module: {
    rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      // The @bdxi packages are written for node/web; polyfill what they touch.
      path: require.resolve('path-browserify'),
      buffer: require.resolve('buffer'),
      stream: require.resolve('stream-browserify'),
      util: require.resolve('util'),
      fs: false,
      crypto: false
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    }),
    new CopyPlugin({
      patterns: [
        { from: manifestSrc, to: 'manifest.json' },
        { from: 'public/panel.html', to: 'panel.html' },
        { from: 'public/approval.html', to: 'approval.html' },
        { from: 'public/icons', to: 'icons' },
        // Fonts bundled locally — MV3 forbids loading remote fonts.
        { from: 'node_modules/@fontsource/michroma/files/michroma-latin-400-normal.woff2', to: 'fonts/michroma-400.woff2' },
        { from: 'node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2', to: 'fonts/space-mono-400.woff2' },
        { from: 'node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff2', to: 'fonts/space-mono-700.woff2' },
        {
          // The Emscripten glue resolves the wasm at "/assets/BeldexLibAppCpp_WASM.wasm",
          // which inside the extension becomes chrome-extension://<id>/assets/... — so
          // copying it here is what makes the bridge load.
          from: 'node_modules/@bdxi/beldex-app-bridge/BeldexLibAppCpp_WASM.wasm',
          to: 'assets/BeldexLibAppCpp_WASM.wasm'
        }
      ]
    })
  ],
  performance: { hints: false }
  }
}

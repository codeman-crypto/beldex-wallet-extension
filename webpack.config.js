const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')

module.exports = {
  entry: {
    panel: './src/popup/index.tsx',
    background: './src/background/index.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
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
        { from: 'public/manifest.json', to: 'manifest.json' },
        { from: 'public/panel.html', to: 'panel.html' },
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

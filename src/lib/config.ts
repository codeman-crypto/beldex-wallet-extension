// Network / backend configuration.
//
// Resolved entirely at BUILD time. webpack.config.js merges src/lib/networks.json
// with .env and the --env CLI flags, then substitutes the result here as the
// `__BDX_NET__` object literal (DefinePlugin). Nothing is read at runtime, there
// is no in-app network switcher, and only the selected network's endpoints exist
// in the bundle — a build is permanently pinned to one chain.
//
//   npm run build:chrome            -> mainnet
//   npm run build:chrome:testnet    -> testnet
//   .env: BDX_NETWORK / <NET>_LWS_URL / ...   (see .env.example)
//
// The manifest's host_permissions are derived from these same URLs, so the
// endpoints and the permissions to reach them cannot drift apart.

export type NetworkName = 'mainnet' | 'testnet'

interface ResolvedNetwork {
  network: NetworkName
  nettype: number
  label: string
  lws: string
  daemonRpc: string
  bnsLookup: string
  explorerTx: string
  priceUrl: string
  showFiat: boolean
  autoLockMinutes: number
}

declare const __BDX_NET__: ResolvedNetwork

const net = __BDX_NET__

export const NETWORK: NetworkName = net.network

export const CONFIG = {
  // "mainnet" | "testnet" — for display and for the dapp bridge's bdx_getNetwork.
  NETWORK,
  NETWORK_LABEL: net.label,

  // Beldex light-wallet server. Implements the endpoints defined in
  // beldex/src/wallet/wallet_light_rpc.h (/login, /get_address_info,
  // /get_address_txs, /get_unspent_outs, /get_random_outs, /submit_raw_tx).
  // It scans the chain with the account's view key; spend keys never leave the
  // client. To self-host, set <NET>_LWS_URL in .env.
  LWS_URL: net.lws,

  // Public daemon JSON-RPC (reserved for future daemon queries).
  DAEMON_RPC_URL: net.daemonRpc,

  // Explorer REST endpoint for BNS name resolution. NOTE: the extension trusts
  // this host to return the correct wallet address for a name — a compromised
  // endpoint could substitute an address. Mitigation: the send flow shows the
  // full resolved address in the review modal before broadcast (see threat
  // model in bns.ts). Self-host or pin as needed for higher assurance.
  BNS_LOOKUP_URL: net.bnsLookup,

  // Base URL for per-transaction explorer links (tx hash is appended).
  EXPLORER_TX_URL: net.explorerTx,

  // Fiat quote source, and whether to show fiat at all. Note that on a testnet
  // build this quotes the price of *mainnet* BDX next to coins that have no
  // value — set <NET>_SHOW_FIAT=false in .env if that's misleading for you.
  PRICE_URL: net.priceUrl,
  SHOW_FIAT: net.showFiat,

  // Serial-bridge nettype convention (see @bdxi/beldex-nettype):
  // 0 = MAINNET, 1 = TESTNET, 2 = DEVNET. Drives seed/address generation and
  // the base58 address prefix, so a mismatch here produces addresses the
  // network will reject.
  NETTYPE: net.nettype,

  // Auto-lock the keyring after this many minutes of inactivity.
  AUTO_LOCK_MINUTES: net.autoLockMinutes,
};

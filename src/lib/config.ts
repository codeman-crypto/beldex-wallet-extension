// Network / backend configuration.
export const CONFIG = {
  // TODO: point at your Beldex LWS (light wallet server) instance — the backend
  // that beldex-lws-frontend talks to. It must implement the endpoints defined
  // in beldex/src/wallet/wallet_light_rpc.h:
  //   /login /get_address_info /get_address_txs /get_unspent_outs
  //   /get_random_outs /submit_raw_tx
  LWS_URL: "https://lwsapi.beldex.io",

  // Public daemon JSON-RPC, used only for BNS name resolution (bns_resolve).
  DAEMON_RPC_URL: "https://explorer.beldex.io/json_rpc",

  // 0 = MAINNET in the serial-bridge nettype convention (see @bdxi/beldex-nettype).
  NETTYPE: 0,

  // Auto-lock the keyring after this many minutes of inactivity.
  AUTO_LOCK_MINUTES: 15,
};

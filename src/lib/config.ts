// Network / backend configuration.
export const CONFIG = {
  // Beldex light-wallet server (production). Implements the endpoints defined in
  // beldex/src/wallet/wallet_light_rpc.h (/login, /get_address_info,
  // /get_address_txs, /get_unspent_outs, /get_random_outs, /submit_raw_tx).
  // It scans the chain with the account's view key; spend keys never leave the
  // client. To self-host, point this at your own LWS instance.
  LWS_URL: "https://lwsapi.beldex.io",

  // Public daemon JSON-RPC (reserved for future daemon queries).
  DAEMON_RPC_URL: "https://explorer.beldex.io/json_rpc",

  // Explorer REST endpoint for BNS name resolution. NOTE: the extension trusts
  // this host to return the correct wallet address for a name — a compromised
  // endpoint could substitute an address. Mitigation: the send flow shows the
  // full resolved address in the review modal before broadcast (see threat
  // model in bns.ts). Self-host or pin as needed for higher assurance.
  BNS_LOOKUP_URL: "https://explorer.beldex.io/api/bnslookup",

  // 0 = MAINNET in the serial-bridge nettype convention (see @bdxi/beldex-nettype).
  NETTYPE: 0,

  // Auto-lock the keyring after this many minutes of inactivity.
  AUTO_LOCK_MINUTES: 15,
};

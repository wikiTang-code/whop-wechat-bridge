/** IDs that must never be invokable, even if someone edits catalog.yaml. */
export const FORBIDDEN_IDS = Object.freeze([
  'broker.lb.place_order',
  'broker.futu.place_order',
  'broker.place_order',
  'gcp.pm2_delete',
  'gcp.pm2_kill',
  'gcp.cutover_dual',
  'gcp.rollback_mono',
  'gcp.env_set',
  'gcp.exec',
  'ssh.exec',
  'ops.exec',
]);

/** Production C2 allowed in P3+ (still require human-approve). */
export const PROD_C2_IDS = Object.freeze([
  'gcp.pm2_restart',
  'gcp.deploy_align',
  'knowledge.promote.apply',
]);

export const LOCAL_C2_IDS = Object.freeze([
  'lm.load',
  'lm.unload',
  'lm.tunnel.start',
  'lm.tunnel.stop',
]);

export const FORBIDDEN_SOURCE_RE = [
  /place_order/,
  /pm2 delete/,
  /pm2 kill/,
  /bash -lc/,
  /ssh[^\n]*\$\{/,
];

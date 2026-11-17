const allowedGenesisAcceptanceRoutes = new Set([
  '/api/ckb',
  '/api/reconcile',
  '/api/internal/cancel',
  '/api/external/genesis',
  '/api/external/submit',
]);

export function assertGenesisAcceptanceRoute(pathname) {
  if (!allowedGenesisAcceptanceRoutes.has(pathname)) {
    throw new Error('This Pudge acceptance runtime permits Pocket genesis only.');
  }
}

export function assertGenesisAcceptanceOperation(operation) {
  if (operation !== 'genesis') {
    throw new Error('This Pudge acceptance runtime only permits Pocket genesis submissions.');
  }
}

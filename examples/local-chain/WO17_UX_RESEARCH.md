# QuotaCell WO17 interaction strategy

## Research basis and limits

This is a desk review of current public guidance and product material, not a QuotaCell user study or hands-on testing of Safe/Ramp accounts.

- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) recommends keeping the first view focused and putting specialist controls behind a deliberate next step. QuotaCell uses one empty-state action, a three-step creation flow, collapsed technical details and role-specific workspaces.
- [Nielsen Norman Group: Modal and Nonmodal Dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/) reserves modal interruption for an action that needs attention. Short payments, funding, revocation and recovery use focused dialogs; initial setup remains a page flow.
- [GOV.UK: Check answers](https://design-system.service.gov.uk/patterns/check-answers/) recommends an editable summary before submission. Pocket creation ends with participant, recipient and limit review before the backend prepares the wallet intent.
- [W3C ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes contained keyboard focus, initial focus and Escape behavior. React uses Radix Dialog/AlertDialog semantics and keeps a prepared transaction when the wallet picker temporarily takes focus.
- [W3C WCAG 2.2 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) says success, waiting, progress and error changes should be announced without unnecessarily moving focus. The app uses labeled status/alert regions for live state and transaction results.
- [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) provides the accessible dialog behavior used for focused actions. It is an implementation aid, not a substitute for browser inspection.
- [Safe Wallet](https://safe.global/wallet) describes transaction propose, verify, sign and execute stages with recipient, amount and intent context. QuotaCell adopts the readable review sequence, not Safe’s multisig model.
- [Ramp Budgets](https://ramp.com/budgets) emphasizes live actuals, remaining budget and clear budget ownership. QuotaCell applies those information relationships while preserving on-chain allowance rules.
- [Nervos Cell documentation](https://docs.nervos.org/docs/tech-explanation/cell) distinguishes capacity, lock, type and data; its [Chinese CKB overview](https://www.nervos.org/zh/ckbpage) describes CKB capacity and storage. This informed the separation of protected funds, Cell capacity and spending authority.
- [Nervos CCC wallet documentation](https://docs.nervos.org/docs/integrate-wallets/ccc-wallet) documents CCC’s CKB wallet connector. This app currently validates UTXO Global, CKB secp256k1 and testnet specifically; the broader wallets listed by CCC are not implicitly supported here.
- [react-i18next](https://react.i18next.com/getting-started) documents the hook-based localization structure used by the React screens.

## Interaction decisions

| User sees first | Show when needed | Removed from the normal path |
| --- | --- | --- |
| A single “Create Pocket” action on an empty chain state. | Three participant connections and optional local names. | Raw policy JSON and manual key entry. |
| Owner: protected balance, potential spend above occupied capacity, shared allowance used/remaining, two permissions and owner actions. | Exact public keys, script identity, transaction inputs/outputs and policy identifiers under technical details. | The full legacy wallet form inside an iframe. |
| Delegate: own personal remaining limit, shared remaining amount, maximum payment, approved recipient and one payment action. | Actual prepared fee, signer identity and recipient in a transaction review. | Owner-only controls from the delegate’s primary view. |
| Closed Pocket: closure, supported funds returned, terminal capacity and late funds. | Unsupported Cell outpoints and their type/data classification. | Any implication that unsupported Cells were recovered. |

Creation is a dedicated, reversible three-step flow: register three distinct wallet identities; set shared, personal, per-payment and recipient rules; review editable terms. The QCN4 policy still has exactly two independently keyed delegates. A display name is only a browser-local annotation; it never authorizes an action. Names are keyed to chain genesis, Pocket ID and public key, with a checked JSON export/import path.

Short actions use dialogs. The transaction review shows the backend-prepared fee, network, signing wallet, payment destination or owner-action consequence. Technical outputs remain available but collapsed. Dialog cancellation abandons the prepared intent before signing. A signed or uncertain result is preserved and is not automatically retried. For Pudge write mode, a separate alert explains that signed bytes go to an RPC that could relay them; the delivered runbook starts in read-only mode.

The identity uses a restrained blue Cell diagram, neutral backgrounds and tabular CKB amounts. The diagram earns its place as the QuotaCell mark and does not depict a coin, shield or lock. No raster or generated asset was needed.

## English and Simplified Chinese terms

| Concept | English UI | Simplified Chinese UI |
| --- | --- | --- |
| Owner | Pocket owner | Pocket 所有者 |
| Delegate | Delegate / spending permission | 获授权支出人 / 支出权限 |
| Shared allowance | Shared lifetime allowance | 共享累计支出上限 |
| Protected balance | Protected balance | 受保护资金余额 |
| Occupied capacity | Cell capacity reserved by the on-chain Cell | Cell 占用容量 |
| Revocation | Revoke spending permission | 撤销支出权限 |
| Recovery | Recover supported funds | 取回受支持的资金 |
| Unsupported asset | Unsupported Cell remains on chain | 暂不支持的 Cell 仍留在链上 |

The locale is stored locally and changes only the UI language. Amounts, wallet identity, network and signed bytes are not translated or transformed. The external wallet’s own approval screen remains controlled by the wallet. Chinese strings were checked in Chromium at narrow widths, but no native-speaker review has been completed; terminology still needs that review.

## Product-specific inferences

These are design decisions inferred from the sources and QuotaCell policy, not research claims: show one next action; explain shared allowance separately from protected CKB; show delegate limits only in the relevant role; identify local names as non-authoritative; keep protocol inspection available but secondary; and expose unsupported funds as unresolved on-chain assets. The browser checks and screenshots recorded in [WO17_EVIDENCE.md](WO17_EVIDENCE.md) are implementation QA, not usability-study evidence.

# PG02 Pudge signing qualification

The dedicated testnet Pocket `0x7166397264b9499801d4c91d4ec549c566604f35949ac4852da78e01913c9347` was created at transaction `0x35fd0f935797bcee18420d8cd98a1e55415c5b968ee6745e60b948306df42d52` and funded with 256 CKB at `0x1a0652d92e733d9921468155ce085713fe6cd1bf9d05efa78ce2f882693fe458`.

The native CCC signer signed a 61 CKB delegated payment, submitted after the existing input, witness, dry-run, pool and consent checks. Transaction `0x5616fef4b1d1f011b792bcc13de4d5fd78a27b41ad0813f93f4892742d39940c` committed in canonical block `0xdb993d66cb4656c82653616f55110e2b81a610bb9a20174296f216732716ca0e`. The resulting policy and fund cells were live; protected funds were 195 CKB, shared usage 61/122 CKB and delegate usage 61/122 CKB, with a 61 CKB per-payment limit. These observations used the primary Pudge RPC and do not prove finality.

This was a direct signing qualification, not wallet-free browser or end-to-end Playground acceptance. No key or signed transaction bytes are included in this record.

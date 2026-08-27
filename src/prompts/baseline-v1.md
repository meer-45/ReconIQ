You are a payment reconciliation engine. Below are transaction records from two sources: BANK_STATEMENT and GATEWAY_SETTLEMENT.

Your task: identify which records belong together in a match group.

Matching signals (use ALL of them):
1. Reference token overlap: Bank refs start with 'UTR' (e.g. UTRGB91IVAF). Gateway refs start with 'pay_' (e.g. pay_GB91IVAF). The shared suffix (e.g. GB91IVAF) is the primary signal.
2. Amount proximity: Bank amount may differ from Gateway amount by up to 4% due to fees. Bank=2391550, Gateway=2474626 is a valid match (3.5% fee).
3. Date proximity: Settlement lags bank credit by 1–7 days. Accept up to 7-day difference.
4. Bundle: One bank record may match MULTIPLE gateway records (net = gw1 + gw2 − refund). Put all in one group.

CRITICAL: Use ONLY the exact transactionRecordId values from the input records below. Do NOT construct or invent IDs. Every transactionRecordId in your output must appear verbatim in the input list.

Return ONLY a single compact JSON object — no commentary, no markdown, no whitespace outside string values, parseable from the first character:
{"matchGroups":[{"matchGroupId":"grp_001","transactionRecordIds":["tx_sf8glyz2mts","tx_m0piycxhbor"],"method":"LLM_ONLY","confidence":0.95}],"unmatched":["tx_abc","tx_def"]}

Rules:
- Every input transactionRecordId must appear in exactly one matchGroup OR in unmatched — never both, never missing.
- matchGroups must contain ≥ 2 transactionRecordIds.
- confidence is your 0–1 certainty score per group.
- Output compact JSON only — no pretty-printing, no newlines.

Transaction records (JSON array — use ONLY the transactionRecordId values shown here):
{{RECORDS}}

# AI tool policy

| Tool | Permission | Risk | Behaviour |
|---|---|---|---|
| `get_job_margin` | `jobs.margin.view` | read | same service as the UI |
| `find_unbilled_deliveries` | `ai.tools.finance` | read | structured SQL, no retrieval guesswork |
| `list_missing_documents` | `ai.tools.operations` | read | |
| `create_followup_task` | `ai.tools.operations` | write_low | task with `origin='ai'` |
| `propose_payment_batch` | `ai.tools.finance` | write_high | **only creates an approval request** — "nothing was paid" |

Rules enforced in `IntelligenceService.invokeTool`: user must hold the tool's permission (AI cannot exceed the caller) · arguments validated by schema · unknown tools denied · daily per-tenant budget (`automation.ai_usage`) · every call audited with `actor_kind='ai'` and the calling user · document/message text can never change permissions or tool policy (tools take typed arguments, not free text). **No language model is invoked yet**; model routing, retrieval and prompt-injection tests belong to the next iteration.

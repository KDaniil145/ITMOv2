# Tasks

## 1. Specs & Design Alignment

 - [x] 1.1 Review proposal and spec delta paths; verify capability `parcelbot/batch-routing` and acceptance scenarios are complete (empty list, all valid, mixed priority, partial failures)
 - [x] 1.2 Verify consistency of the accepted per-item result format across proposal.md, spec.md, design.md, and tasks.md (success: {"belt": ...}; domain error: {"error": ...}; one field per item; order/length preserved)

## 2. MCP Tool Implementation

- [x] 2.1 Implement `route_parcels` in practices/practice_04/demo/mcp_server.py, delegating each item to `service.choose_belt(weight, priority=False)`; verify function returns a list of objects preserving input order and length
- [x] 2.2 Handle per-item domain errors after FastMCP validation: catch `ValueError` from `choose_belt` and return {"error": "weight must be positive"} for that item while continuing others; verify with a local client call similar to MCP_DEMO

## 3. Tests

 - [x] 3.1 Add unit tests for `route_parcels`: all valid items succeed; verify each element is {"belt": "..."}
 - [x] 3.2 Add test for mixed priorities within 0 < weight ≤ 10; verify express vs standard mapping using per-item {"belt": "..."}
 - [x] 3.3 Add test for empty input list; verify empty result list
 - [x] 3.4 Add test for partial failures (some weights ≤ 0); verify offending items are {"error": "weight must be positive"} and other items are {"belt": "..."}
- [x] 3.5 (Client-level) Verify tool call does not set `is_error=true` when only per-item domain errors are present; `is_error=true` is expected only if FastMCP rejects arguments pre-call

## 4. Documentation & Integration

 - [x] 4.1 Update practices/practice_04/demo/README.md with brief description of `route_parcels` input/output contract and examples (no changes to existing behaviors)
 - [x] 4.2 If needed, update MCP_DEMO.md with an example client call to `route_parcels` and expected output
 - [x] 4.3 Ensure AGENTS.md keeps guardrails intact; no behavior changes to existing tools

## 5. Verification

 - [x] 5.1 Run `make test` in demo and verify all tests (existing + new) pass
 - [x] 5.2 Manual MCP client check: `route_parcels` with (a) empty list, (b) valid batch with mixed priority, (c) batch with partial errors; confirm outputs

## Workflow follow-up

- Архивировать change после ревью и принятия, затем при необходимости синхронизировать main specs

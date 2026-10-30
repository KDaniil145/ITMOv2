# Tasks

## 1. Specs & Design Alignment

- [ ] 1.1 Verify capability path `parcelbot/batch-summary` and acceptance scenarios (empty list, valid belts, partial domain errors)
- [ ] 1.2 Ensure proposal/spec/design/tasks are consistent (summary fields: total, standard, express, heavy, errors; input contract boundary)

## 2. MCP Tool Implementation

- [ ] 2.1 Implement `route_parcels_summary` in practices/practice_04/demo/mcp_server.py; reuse `choose_belt`/batch logic; return dict with summary fields; preserve order irrelevance
- [ ] 2.2 Per-call validation boundary: rely on FastMCP for type/shape; do not per-item validate non-domain errors; document behavior in README/MCP_DEMO

## 3. Tests

- [ ] 3.1 Unit: empty input → {total:0, standard:0, express:0, heavy:0, errors:0}
- [ ] 3.2 Unit: valid items → counts across belts match expected
- [ ] 3.3 Unit: partial domain errors → errors count matches; other belts counted

## 4. Documentation & Integration

- [ ] 4.1 Update README.md with `route_parcels_summary` contract and examples
- [ ] 4.2 Update MCP_DEMO.md with client examples, including invalid-args rejection

## 5. Verification

- [ ] 5.1 Run `make test` in demo and verify all tests pass
- [ ] 5.2 Manual MCP client check for summary: empty, valid batch, partial errors

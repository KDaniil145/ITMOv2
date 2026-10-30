import sys
import types
import unittest


# Provide a dummy fastmcp module so importing mcp_server does not require the real dependency
dummy_fastmcp = types.ModuleType("fastmcp")


class _DummyFastMCP:
    def __init__(self, name: str):  # pragma: no cover - trivial shim
        self.name = name

    def tool(self, fn):  # used as a decorator; return function unchanged
        return fn

    def run(self):  # pragma: no cover
        pass


dummy_fastmcp.FastMCP = _DummyFastMCP
sys.modules.setdefault("fastmcp", dummy_fastmcp)


import mcp_server  # noqa: E402  (after injecting dummy fastmcp)


class RouteParcelsTest(unittest.TestCase):
    def test_empty_list_returns_empty(self):
        self.assertEqual(mcp_server.route_parcels([]), [])

    def test_all_valid_items_succeed(self):
        parcels = [
            {"weight": 5},
            {"weight": 10},
            {"weight": 15},
        ]
        result = mcp_server.route_parcels(parcels)
        self.assertEqual(result, [
            {"belt": "standard"},
            {"belt": "standard"},
            {"belt": "heavy"},
        ])

    def test_mixed_priority_flags(self):
        parcels = [
            {"weight": 5, "priority": True},   # express
            {"weight": 5, "priority": False},  # standard
            {"weight": 10, "priority": True},  # express (boundary)
        ]
        result = mcp_server.route_parcels(parcels)
        self.assertEqual(result, [
            {"belt": "express"},
            {"belt": "standard"},
            {"belt": "express"},
        ])

    def test_partial_failures(self):
        parcels = [
            {"weight": -1},
            {"weight": 5},
            {"weight": 0},
        ]
        result = mcp_server.route_parcels(parcels)
        self.assertEqual(result, [
            {"error": "weight must be positive"},
            {"belt": "standard"},
            {"error": "weight must be positive"},
        ])


if __name__ == "__main__":
    unittest.main()

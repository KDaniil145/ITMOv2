from dataclasses import dataclass
from typing import List, Dict

from fastmcp import FastMCP
from service import choose_belt


# Minimal MCP server for ParcelBot
mcp = FastMCP("ParcelBot")


@mcp.tool
def route_parcel(weight: float, priority: bool = False) -> str:
    """Route a parcel to the appropriate belt using ParcelBot rules.

    Args:
        weight: Parcel weight in kilograms.
        priority: If True, use express for eligible weights.

    Returns:
        Belt name as a string.

    Notes:
        This function delegates to service.choose_belt and does not
        duplicate routing rules. Invalid weights raise ValueError.
    """
    return choose_belt(weight, priority)


@dataclass
class ParcelInput:
    weight: float
    priority: bool = False


@mcp.tool
def route_parcels(parcels: List[ParcelInput]) -> List[Dict]:
    """Batch-route parcels using ParcelBot rules.

    Input:
        parcels: list of objects, each with:
          - weight (number, required)
          - priority (boolean, optional; defaults to False when absent)

    Output:
        A list of results of the same length and order. Each item has exactly one field:
          - success: {"belt": "standard"|"express"|"heavy"}
          - domain error (numeric weight <= 0): {"error": "weight must be positive"}

    Notes:
        - Reuses service.choose_belt for business rules.
        - Only per-item domain errors (ValueError from choose_belt) are captured.
          Other validation errors may be rejected by FastMCP pre-call, resulting
          in a tool-level error (is_error=True).
    """
    results: List[Dict] = []
    for item in parcels:
        # Expect FastMCP to validate shape/types; only domain errors are handled per-item
        try:
            if isinstance(item, dict):
                weight = item["weight"]
                priority = item.get("priority", False)
            else:
                weight = item.weight
                priority = getattr(item, "priority", False)
            belt = choose_belt(weight, priority)
            results.append({"belt": belt})
        except ValueError as e:
            # Domain error from choose_belt, e.g., non-positive weight
            results.append({"error": str(e)})
    return results


if __name__ == "__main__":
    # Run with STDIO transport (default). Do not print diagnostics to stdout.
    mcp.run()

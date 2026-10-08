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


if __name__ == "__main__":
    # Run with STDIO transport (default). Do not print diagnostics to stdout.
    mcp.run()

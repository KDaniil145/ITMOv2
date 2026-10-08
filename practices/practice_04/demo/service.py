def choose_belt(weight, priority=False):
    """Return belt name for a parcel by weight with optional priority.

    Rules:
    - weight <= 0 -> raises ValueError (regardless of priority)
    - weight > 10 -> "heavy" (regardless of priority)
    - 0 < weight <= 10 ->
        - "express" when priority is True
        - "standard" when priority is False (default)
    """
    if weight <= 0:
        raise ValueError("weight must be positive")

    if weight > 10:
        return "heavy"

    return "express" if priority else "standard"

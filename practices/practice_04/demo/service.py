def choose_belt(weight):
    """Return belt name for a parcel by weight.

    Current behavior:
    - weight <= 0 -> raises ValueError
    - 0 < weight <= 10 -> "standard"
    - weight > 10 -> "heavy"

    Note: priority handling is not implemented yet.
    """
    if weight <= 0:
        raise ValueError("weight must be positive")

    return "standard" if weight <= 10 else "heavy"

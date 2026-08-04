"""Stable symbol classes used by the terminal and validation reports."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class SymbolProfile:
    symbol: str
    asset_class: str
    display_name: str


DEFAULT_UNIVERSE: tuple[SymbolProfile, ...] = (
    SymbolProfile("BTCUSDT", "majors_liquid", "Bitcoin"),
    SymbolProfile("ETHUSDT", "majors_liquid", "Ethereum"),
    SymbolProfile("SOLUSDT", "layer1_smart_contracts", "Solana"),
    SymbolProfile("ARBUSDT", "layer2_scaling", "Arbitrum"),
    SymbolProfile("AAVEUSDT", "defi_dex_lending", "Aave"),
    SymbolProfile("DOGEUSDT", "memes_high_beta", "Dogecoin"),
    SymbolProfile("TAOUSDT", "ai_data_compute", "Bittensor"),
    SymbolProfile("LINKUSDT", "oracles_data_services", "Chainlink"),
    SymbolProfile("ONDOUSDT", "rwa_tokenization", "Ondo"),
)


def profile_map() -> dict[str, SymbolProfile]:
    return {item.symbol: item for item in DEFAULT_UNIVERSE}


def terminal_universe_rows() -> list[dict]:
    return [asdict(item) for item in DEFAULT_UNIVERSE]


"""MSST RoFormer architecture, vendored under its original MIT license.

Source: https://github.com/ZFTurbo/Music-Source-Separation-Training/tree/main/models/bs_roformer
Original copyright (c) 2024 Roman Solovyev.
Use explicit, local-only checkpoints; no model weights or download logic.
"""
from .bs_roformer import BSRoformer
from .mel_band_roformer import MelBandRoformer

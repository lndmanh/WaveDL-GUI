"""
Bounded trainer-output window wire model.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from .common import WireModel


class OutputChunk(WireModel):
    attempt: int
    offset: int
    next_offset: int
    size: int
    text: str
    eof: bool

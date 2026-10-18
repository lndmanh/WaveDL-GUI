"""Acceptance-only stationary CPU model; real autograd and optimizer path.

The extra matrix products pace observation, not throughput measurements. They do
not change outputs, clocks, metrics, training loaders, or runtime state.
"""

import torch

from wavedl.models.base import BaseModel
from wavedl.models.registry import register_model


@register_model("epoch_metric_plateau")
class EpochMetricPlateau(BaseModel):
    def __init__(self, in_shape, out_size, **kwargs):
        super().__init__(in_shape, out_size, **kwargs)
        self.weight = torch.nn.Parameter(torch.zeros(out_size))

    def forward(self, x):
        # Bounded real CPU work provides an observation window for each epoch.
        scratch = torch.ones((1024, 1024), device=x.device)
        for _ in range(750):
            torch.mm(scratch, scratch)
        return (self.weight * 0).expand(len(x), self.out_size)

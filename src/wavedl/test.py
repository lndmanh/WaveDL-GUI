"""
WaveDL - Testing & Inference Script
====================================
Target Environment: NVIDIA HPC GPUs (Single/Multi-GPU) | PyTorch 2.x | Python 3.11+

Production-grade inference script for evaluating trained WaveDL models:
  1. Model-Agnostic: Works with any registered architecture
  2. Flexible Data Loading: Supports NPZ/HDF5/MAT formats with auto-detection
  3. Comprehensive Metrics: R², Pearson, per-parameter MAE with physical units
  4. Publication Plots: 10 diagnostic plots with LaTeX styling and multi-format export
  5. Batch Inference: Efficient GPU utilization for large test sets
  6. Model Export: ONNX format for deployment in production systems

Usage:
    # Basic inference
    wavedl-test --checkpoint ./best_checkpoint --data_path test_data.npz

    # With visualization and detailed output
    wavedl-test --checkpoint ./best_checkpoint --data_path test_data.npz \\
        --plot --plot_format png pdf --output_dir ./test_results --save_predictions

    # Export model to ONNX for deployment
    wavedl-test --checkpoint ./best_checkpoint --data_path test_data.npz \\
        --export onnx --export_path model.onnx

Author: Ductho Le (ductho.le@outlook.com)
"""

# ==============================================================================
# ENVIRONMENT CONFIGURATION (must be before matplotlib import)
# ==============================================================================
# Auto-configure writable cache directories when home is not writable.
# Uses current working directory as fallback - works on HPC and local machines.
import os

# Import and call HPC cache setup before any library imports
from wavedl.utils import setup_hpc_cache_dirs


setup_hpc_cache_dirs()

import argparse  # noqa: E402
import logging  # noqa: E402
import pickle  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

# Force Agg backend before pyplot import (headless HPC nodes have no display)
import matplotlib  # noqa: E402


matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402
from torch.utils.data import DataLoader, TensorDataset  # noqa: E402
from tqdm.auto import tqdm  # noqa: E402

# Local imports
from wavedl.core.checkpoint_selection import resolve_checkpoint_path  # noqa: E402
from wavedl.core.events import MetricPayload  # noqa: E402
from wavedl.core.inference_cli import (  # noqa: E402
    parse_inference_args,
    validate_import_modules,
)
from wavedl.core.layout import OperationKind  # noqa: E402
from wavedl.models import build_model, list_models  # noqa: E402
from wavedl.operations import (  # noqa: E402
    emit_operation_artifact,
    open_operation_runtime,
    operation_lifecycle,
    operation_selection,
)
from wavedl.utils import (  # noqa: E402
    FIGURE_DPI,
    calc_pearson,
    load_test_data,
    plot_bland_altman,
    plot_correlation_heatmap,
    plot_error_boxplot,
    plot_error_cdf,
    plot_error_histogram,
    plot_prediction_vs_index,
    plot_qq,
    plot_relative_error,
    plot_residuals,
    plot_scientific_scatter,
)


# Optional dependencies for sparse matrix handling (now handled in utils/data.py)
try:
    from scipy.sparse import issparse

    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

try:
    from safetensors.torch import load_file as load_safetensors

    HAS_SAFETENSORS = True
except ImportError:
    HAS_SAFETENSORS = False


# ==============================================================================
# ARGUMENT PARSING
# ==============================================================================
def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for testing."""
    return parse_inference_args(models=list_models())


# ==============================================================================
# DATA LOADING (delegated to utils.data.load_test_data)
# ==============================================================================
def load_data_for_inference(
    file_path: str,
    format: str = "auto",
    input_key: str | None = None,
    output_key: str | None = None,
    input_channels: int | None = None,
) -> tuple[torch.Tensor, torch.Tensor | None]:
    """
    Load test data for inference using the unified data loading pipeline.

    This is a thin wrapper around utils.data.load_test_data that adds logging.

    Args:
        file_path: Path to data file (NPZ, HDF5, or MAT v7.3)
        format: Format hint ('auto', 'npz', 'mat', 'hdf5')
        input_key: Custom key for input data (overrides auto-detection)
        output_key: Custom key for output data (overrides auto-detection)

    Returns:
        Tuple of:
            - X: Input tensor with channel dimension (N, 1, *spatial_dims)
            - y: Target tensor (N, T) or None if targets not present
    """
    from pathlib import Path

    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        raise FileNotFoundError(f"Data file not found: {file_path}")

    # Determine format for logging
    if format == "auto":
        suffix = file_path_obj.suffix.lower()
        format_name = {
            ".npz": "npz",
            ".mat": "mat",
            ".h5": "hdf5",
            ".hdf5": "hdf5",
        }.get(suffix, "npz")
    else:
        format_name = format

    logging.info(f"Loading test data from: {file_path} (format: {format_name})")
    if input_key:
        logging.info(f"   Using custom input key: '{input_key}'")
    if output_key:
        logging.info(f"   Using custom output key: '{output_key}'")

    # Use the unified loader from utils.data
    X, y = load_test_data(
        file_path,
        format=format,
        input_key=input_key,
        output_key=output_key,
        input_channels=input_channels,
    )

    # Log results
    if y is not None:
        logging.info(
            f"   ✔ Loaded {len(X)} samples | Input: {X.shape} | Target: {y.shape}"
        )
    else:
        logging.info(
            f"   ✔ Loaded {len(X)} samples | Input: {X.shape} | Target: None (predictions only)"
        )

    return X, y


# ==============================================================================
# MODEL LOADING
# ==============================================================================
def load_checkpoint(
    checkpoint_dir: str,
    in_shape: tuple[int, ...],
    out_size: int,
    model_name: str | None = None,
) -> tuple[nn.Module, Any]:
    """
    Load model and scaler from Accelerate checkpoint directory.

    Args:
        checkpoint_dir: Legacy checkpoint, published generation, or run directory.
            Run directories select the latest explicitly marked best generation.
        in_shape: Input spatial shape - (L,) for 1D, (H, W) for 2D, or (D, H, W) for 3D
        out_size: Number of output parameters
        model_name: Model architecture name (auto-detect if None)

    Returns:
        model: Loaded model in eval mode
        scaler: StandardScaler for inverse transform
    """
    checkpoint_dir = resolve_checkpoint_path(checkpoint_dir, purpose="best")

    if not checkpoint_dir.exists():
        raise FileNotFoundError(f"Checkpoint directory not found: {checkpoint_dir}")

    # Load training metadata
    meta_path = checkpoint_dir / "training_meta.pkl"
    meta = None
    if meta_path.exists():
        with open(meta_path, "rb") as f:
            meta = pickle.load(f)
        best_val = meta.get("best_val_loss")
        val_str = f"{best_val:.6f}" if isinstance(best_val, (int, float)) else "N/A"
        logging.info(
            f"   Checkpoint from epoch {meta.get('epoch', 'unknown')}, "
            f"val_loss: {val_str}"
        )

    # Auto-detect model architecture if not specified
    if model_name is None:
        # First, try to read from training_meta.pkl (most reliable)
        if meta is not None and meta.get("model_name"):
            model_name = meta["model_name"]
            logging.info(f"   Auto-detected model from checkpoint: {model_name}")

        # Fallback: try to detect from parent directory name (e.g., 'cnn_test' -> 'cnn')
        # Use longest-prefix matching since many model IDs contain underscores
        # (e.g., 'convnext_tiny', 'mobilenet_v3_small', 'resnet18_pretrained')
        if model_name is None:
            parent_dir = checkpoint_dir.parent.name
            known_models = list_models()
            # Sort by length descending so longer (more specific) names match first
            # e.g., 'resnet18_pretrained' matches before 'resnet18'
            candidates = sorted(known_models, key=len, reverse=True)
            detected_name = None
            for name in candidates:
                # Check that name is a proper prefix (followed by separator or end)
                if (
                    parent_dir == name
                    or parent_dir.startswith(name + "_")
                    or parent_dir.startswith(name + "-")
                ):
                    detected_name = name
                    break

            if detected_name is not None:
                model_name = detected_name
                logging.info(f"   Auto-detected model from folder: {model_name}")
            else:
                raise ValueError(
                    f"Could not auto-detect model architecture.\\n"
                    f"Checkpoint missing 'model_name' in training_meta.pkl and folder '{parent_dir}' "
                    f"doesn't start with a known model name.\\n"
                    f"Please specify --model explicitly. Available models: {list_models()}"
                )

    logging.info(f"   Building model: {model_name}")
    # Use pretrained=False: checkpoint weights will overwrite any pretrained weights,
    # so downloading ImageNet weights is wasteful and breaks offline/HPC inference.
    model = build_model(
        model_name, in_shape=in_shape, out_size=out_size, pretrained=False
    )

    # Load weights (check multiple formats in order of preference)
    weight_path = None
    for fname in [
        "model.safetensors",
        "model.bin",
        "pytorch_model.bin",
        "model_weights.pth",
    ]:
        candidate = checkpoint_dir / fname
        if candidate.exists():
            weight_path = candidate
            break

    if weight_path is None:
        raise FileNotFoundError(
            f"No model weights found in {checkpoint_dir}. "
            f"Expected one of: model.safetensors, model.bin, pytorch_model.bin, model_weights.pth"
        )

    if HAS_SAFETENSORS and weight_path.suffix == ".safetensors":
        state_dict = load_safetensors(str(weight_path))
    elif weight_path.suffix == ".safetensors":
        # Safetensors file exists but library not installed
        raise ImportError(
            f"Checkpoint uses safetensors format ({weight_path.name}) but "
            f"'safetensors' package is not installed. Install it with:\n"
            f"    pip install safetensors\n"
            f"Or convert the checkpoint to PyTorch format (model.bin)."
        )
    else:
        state_dict = torch.load(weight_path, map_location="cpu", weights_only=True)

    # Remove wrapper prefixes from checkpoints:
    # - 'module.' from DDP (DistributedDataParallel)
    # - '_orig_mod.' from torch.compile()
    # Iterative stripping handles any nesting order
    cleaned_dict = {}
    for k, v in state_dict.items():
        key = k
        changed = True
        while changed:
            changed = False
            if key.startswith("module."):
                key = key[7:]
                changed = True
            if key.startswith("_orig_mod."):
                key = key[10:]
                changed = True
        cleaned_dict[key] = v
    state_dict = cleaned_dict

    model.load_state_dict(state_dict)
    model.eval()

    logging.info(f"   ✔ Loaded weights from: {weight_path.name}")

    # Load scaler
    # A published generation must carry its own hash-covered preprocessing state.
    published = (checkpoint_dir / "COMPLETE.json").is_file()
    scaler_path = (
        checkpoint_dir / "scaler.pkl"
        if published
        else checkpoint_dir.parent / "scaler.pkl"
    )
    if not scaler_path.exists():
        # Try in checkpoint dir itself
        scaler_path = checkpoint_dir / "scaler.pkl"

    if not scaler_path.exists():
        raise FileNotFoundError(
            f"Scaler not found. Expected at: {checkpoint_dir.parent}/scaler.pkl"
        )

    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)

    logging.info(f"   ✔ Loaded scaler from: {scaler_path.name}")

    param_info = model.parameter_summary()
    logging.info(
        f"   Model: {param_info['trainable_parameters']:,} parameters ({param_info['total_mb']:.2f} MB)"
    )

    return model, scaler


# ==============================================================================
# INFERENCE
# ==============================================================================
@torch.inference_mode()
def run_inference(
    model: nn.Module,
    X: torch.Tensor,
    batch_size: int = 128,
    device: torch.device = None,
    num_workers: int = 0,
) -> np.ndarray:
    """
    Run batch inference on test data.

    Args:
        model: Trained model in eval mode
        X: Input tensor (N, C, *spatial_dims)
        batch_size: Batch size for inference
        device: Target device (auto-detect if None)
        num_workers: DataLoader workers (0 for single-threaded)

    Returns:
        predictions: Numpy array (N, out_size) - still in normalized space
    """
    if device is None:
        if torch.cuda.is_available():
            device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            device = torch.device("mps")
        else:
            device = torch.device("cpu")

    model = model.to(device)
    model.eval()

    dataset = TensorDataset(X)
    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=device.type in ("cuda", "mps"),
    )

    predictions = []

    for (batch_x,) in tqdm(loader, desc="Inference", leave=False):
        batch_x = batch_x.to(device, non_blocking=True)
        preds = model(batch_x).cpu().numpy()
        predictions.append(preds)

    if not predictions:
        return np.empty((0, 0))
    return np.vstack(predictions)


# ==============================================================================
# ONNX EXPORT
# ==============================================================================
class ModelWithDenormalization(nn.Module):
    """
    Wrapper that combines a trained model with scaler inverse transform.

    This embeds the StandardScaler's mean_ and scale_ as model buffers,
    allowing the ONNX export to include de-normalization directly.
    Users get original-scale predictions without manual post-processing.

    Args:
        model: Trained PyTorch model
        scaler_mean: Mean values from StandardScaler (shape: [out_size])
        scaler_scale: Scale (std) values from StandardScaler (shape: [out_size])
    """

    def __init__(
        self, model: nn.Module, scaler_mean: np.ndarray, scaler_scale: np.ndarray
    ):
        super().__init__()
        self.model = model
        # Register as buffers (not trainable parameters, but saved with model)
        self.register_buffer(
            "scaler_mean", torch.tensor(scaler_mean, dtype=torch.float32)
        )
        self.register_buffer(
            "scaler_scale", torch.tensor(scaler_scale, dtype=torch.float32)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass with integrated de-normalization."""
        # Get normalized predictions from base model
        normalized_preds = self.model(x)
        # Apply inverse transform: original = normalized * scale + mean
        return normalized_preds * self.scaler_scale + self.scaler_mean


def export_to_onnx(
    model: nn.Module,
    sample_input: torch.Tensor,
    output_path: str,
    opset_version: int = 17,
    validate: bool = True,
    model_name: str = "WaveDL_Model",
    scaler: object | None = None,
    include_denorm: bool = False,
) -> bool:
    """
    Export PyTorch model to ONNX format for production deployment.

    Features:
        - Dynamic batch size support
        - Comprehensive validation with numerical comparison
        - Embedded metadata (input/output names, descriptions)
        - Compatibility testing with ONNX runtime
        - Self-contained single-file exports (external-data models are refused)

    Args:
        model: Trained PyTorch model in eval mode
        sample_input: Sample input tensor for tracing (N, C, *spatial_dims)
        output_path: Path to save the ONNX model
        opset_version: ONNX opset version (11-17, default 17)
        validate: Whether to compare numerical outputs. Single-file structure and
            exact requested opset are always checked before replacing output.
        model_name: Model name embedded in ONNX metadata

    Returns:
        True if export and validation successful, False otherwise

    Example:
        >>> success = export_to_onnx(model, X_test[:1], "model.onnx")
        >>> if success:
        ...     print("Model exported successfully!")

    Note:
        For deployment in MATLAB/LabVIEW/C++, use the exported .onnx file
        with the appropriate ONNX runtime for your target platform.
    """
    import inspect
    import warnings
    from tempfile import TemporaryDirectory

    from wavedl.utils.onnx_export import (
        MAX_ONNX_BYTES,
        ExportCommitUnknown,
        replace_export,
        validate_self_contained_onnx,
    )

    # Wrap model with de-normalization if requested
    if include_denorm:
        if scaler is None:
            raise ValueError("scaler must be provided when include_denorm=True")
        logging.info("   Wrapping model with de-normalization layer (scaler embedded)")
        model = ModelWithDenormalization(
            model=model, scaler_mean=scaler.mean_, scaler_scale=scaler.scale_
        )

    # Validate opset up front (the documented supported range is 11-17) so a
    # bad --export_opset fails with a clear message rather than deep in the exporter.
    if not (11 <= opset_version <= 17):
        raise ValueError(
            f"export_opset must be between 11 and 17, got {opset_version}."
        )

    # Ensure model is in eval mode on CPU for consistent export
    model = model.cpu()
    model.eval()
    sample_input = sample_input.cpu()

    # Determine input/output names based on dimensions
    input_dims = sample_input.ndim - 2  # Exclude batch and channel
    if input_dims == 1:
        spatial_desc = "1D signal (length)"
    elif input_dims == 2:
        spatial_desc = "2D image (height, width)"
    else:
        spatial_desc = f"{input_dims}D volume"

    # Build dynamic axes for variable batch size
    dynamic_axes = {"input": {0: "batch_size"}, "predictions": {0: "batch_size"}}

    logging.info(f"📦 Exporting model to ONNX (opset {opset_version})...")
    logging.info(f"   Input shape: {tuple(sample_input.shape)} ({spatial_desc})")

    try:
        tensor_bytes = sum(
            tensor.numel() * tensor.element_size()
            for tensor in (*model.parameters(), *model.buffers())
        )
        if tensor_bytes >= MAX_ONNX_BYTES:
            raise ValueError(
                "ONNX models requiring external data (2GiB+) are unsupported"
            )
        # Export with comprehensive settings
        destination = Path(output_path)
        with (
            TemporaryDirectory(
                prefix=".onnx-export-", dir=destination.parent
            ) as temporary,
            warnings.catch_warnings(),
        ):
            warnings.simplefilter("ignore")
            staged = Path(temporary) / destination.name
            options = {}
            export_parameters = inspect.signature(torch.onnx.export).parameters
            if "external_data" in export_parameters:
                options["external_data"] = False
            # The torch.export-based exporter may upgrade old opsets to 18+.
            # Keep the documented 11-17 contract with the legacy exporter;
            # older PyTorch versions already use it and have no dynamo option.
            if "dynamo" in export_parameters:
                options["dynamo"] = False
            torch.onnx.export(
                model,
                sample_input,
                str(staged),
                export_params=True,
                opset_version=opset_version,
                do_constant_folding=True,  # Optimize for inference
                input_names=["input"],
                output_names=["predictions"],
                dynamic_axes=dynamic_axes,
                verbose=False,
                **options,
            )
            validate_self_contained_onnx(staged, expected_opset=opset_version)
            if validate and not _validate_onnx_export(model, sample_input, str(staged)):
                return False
            with staged.open("rb") as file:
                os.fsync(file.fileno())
            replace_export(staged, destination)

        logging.info(f"   ✔ Export completed: {output_path}")

        return True

    except ExportCommitUnknown:
        raise
    except Exception as e:
        logging.error(f"   ✘ ONNX export failed: {e}")
        return False


def _validate_onnx_export(
    pytorch_model: nn.Module,
    sample_input: torch.Tensor,
    onnx_path: str,
    rtol: float = 1e-4,
    atol: float = 1e-5,
) -> bool:
    """
    Validate ONNX model by comparing outputs with PyTorch model.

    Args:
        pytorch_model: Original PyTorch model
        sample_input: Input tensor for comparison
        onnx_path: Path to exported ONNX model
        rtol: Relative tolerance for numerical comparison
        atol: Absolute tolerance for numerical comparison

    Returns:
        True if validation passes, False otherwise
    """
    try:
        import onnx
        import onnxruntime as ort
    except ImportError:
        logging.warning(
            "   ⚠ ONNX validation skipped (install: pip install onnx onnxruntime)"
        )
        return True

    logging.info("   Validating ONNX model...")

    try:
        # 1. Check ONNX model structure
        onnx_model = onnx.load(onnx_path)
        onnx.checker.check_model(onnx_model)
        logging.info("   ✔ ONNX model structure valid")

        # 2. Compare numerical outputs
        # PyTorch inference
        pytorch_model.eval()
        with torch.inference_mode():
            pytorch_output = pytorch_model(sample_input.cpu()).numpy()

        # ONNX Runtime inference
        ort_session = ort.InferenceSession(
            onnx_path, providers=["CPUExecutionProvider"]
        )
        onnx_output = ort_session.run(None, {"input": sample_input.numpy()})[0]

        # Numerical comparison
        max_diff = np.abs(pytorch_output - onnx_output).max()

        if np.allclose(pytorch_output, onnx_output, rtol=rtol, atol=atol):
            logging.info(f"   ✔ Numerical validation passed (max diff: {max_diff:.2e})")
            return True
        else:
            logging.warning(f"   ⚠ Numerical mismatch (max diff: {max_diff:.2e})")
            return False

    except Exception as e:
        logging.warning(f"   ⚠ Validation error: {e}")
        return False


def get_onnx_model_info(onnx_path: str) -> dict:
    """
    Get metadata from exported ONNX model.

    Returns:
        Dictionary with model information
    """
    try:
        import onnx

        model = onnx.load(onnx_path)

        input_info = model.graph.input[0]
        output_info = model.graph.output[0]

        return {
            "opset_version": model.opset_import[0].version,
            "input_name": input_info.name,
            "input_shape": [
                d.dim_value or "dynamic" for d in input_info.type.tensor_type.shape.dim
            ],
            "output_name": output_info.name,
            "output_shape": [
                d.dim_value or "dynamic" for d in output_info.type.tensor_type.shape.dim
            ],
            "file_size_mb": Path(onnx_path).stat().st_size / (1024 * 1024),
        }
    except Exception as e:
        return {"error": str(e)}


# ==============================================================================
# METRICS & VISUALIZATION
# ==============================================================================
def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    """Compute comprehensive regression metrics."""
    # Handle single-sample case
    if len(y_true) == 1:
        metrics = {
            "r2_score": float("nan"),  # R² undefined for single sample
            "pearson_corr": float("nan"),  # Correlation undefined for single sample
            "mae_avg": mean_absolute_error(y_true, y_pred),
            "rmse": np.sqrt(np.mean((y_true - y_pred) ** 2)),
        }
    else:
        metrics = {
            "r2_score": r2_score(y_true, y_pred),
            "pearson_corr": calc_pearson(y_true, y_pred),
            "mae_avg": mean_absolute_error(y_true, y_pred),
            "rmse": np.sqrt(np.mean((y_true - y_pred) ** 2)),
        }

    # Per-parameter MAE
    for i in range(y_true.shape[1]):
        metrics[f"mae_p{i}"] = mean_absolute_error(y_true[:, i], y_pred[:, i])

    return metrics


def print_results(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    metrics: dict[str, float],
    param_names: list | None = None,
    verbose: bool = False,
):
    """Print formatted test results."""
    n_params = y_true.shape[1]

    if param_names is None or len(param_names) != n_params:
        param_names = [f"P{i}" for i in range(n_params)]

    # Overall metrics
    print("\n" + "=" * 80)
    print("OVERALL TEST RESULTS")
    print("=" * 80)
    print(f"Samples:          {len(y_true)}")
    print(f"R² Score:         {metrics['r2_score']:.6f}")
    print(f"Pearson Corr:     {metrics['pearson_corr']:.6f}")
    print(f"RMSE:             {metrics['rmse']:.6f}")
    print(f"MAE (Avg):        {metrics['mae_avg']:.6f}")
    print("=" * 80)

    # Per-parameter MAE
    print("\nPER-PARAMETER MAE:")
    print("-" * 80)
    for i, name in enumerate(param_names):
        print(f"  {name:12s}: {metrics[f'mae_p{i}']:.6f}")
    print("-" * 80)

    # Sample-wise predictions (if verbose)
    if verbose:
        print("\nSAMPLE-WISE PREDICTIONS:")
        print("=" * 80)
        header = "ID   | " + " | ".join([f"{name:>8s}" for name in param_names])
        print(header)
        print("-" * 80)

        for i in range(min(len(y_true), 20)):  # Limit to first 20 samples
            true_str = " | ".join([f"{val:8.4f}" for val in y_true[i]])
            pred_str = " | ".join([f"{val:8.4f}" for val in y_pred[i]])
            print(f"TRUE | {true_str}")
            print(f"PRED | {pred_str}")
            print("-" * 80)

        if len(y_true) > 20:
            print(f"... ({len(y_true) - 20} more samples)")


def save_predictions(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    output_path: str,
    param_names: list | None = None,
):
    """Save predictions to CSV file."""
    n_params = y_true.shape[1]

    if param_names is None or len(param_names) != n_params:
        param_names = [f"P{i}" for i in range(n_params)]

    # Create DataFrame
    columns = [f"True_{name}" for name in param_names] + [
        f"Pred_{name}" for name in param_names
    ]
    data = np.hstack([y_true, y_pred])
    df = pd.DataFrame(data, columns=columns)

    # Add error columns
    for i, name in enumerate(param_names):
        df[f"Error_{name}"] = df[f"Pred_{name}"] - df[f"True_{name}"]
        df[f"AbsError_{name}"] = np.abs(df[f"Error_{name}"])

    df.to_csv(output_path, index=False)
    logging.info(f"   ✔ Predictions saved to: {output_path}")


def plot_results(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    output_dir: str,
    param_names: list | None = None,
    formats: list | None = None,
):
    """Generate and save publication-quality plots with consistent LaTeX styling.

    Generates 10 plot types:
    1. Scatter plot (predictions vs ground truth)
    2. Error histogram (error distribution)
    3. Residual plot (residual vs predicted)
    4. Bland-Altman plot (method comparison)
    5. Q-Q plot (normality of errors)
    6. Correlation heatmap (error correlations between parameters)
    7. Relative error plot (% error vs true value)
    8. Cumulative error distribution (CDF)
    9. Prediction vs sample index
    10. Error box plot

    Args:
        y_true: Ground truth values
        y_pred: Predicted values
        output_dir: Directory to save plots
        param_names: Optional parameter names for labels
        formats: List of output formats (png, pdf, svg, eps, tiff)
    """
    n_params = y_true.shape[1]

    if formats is None:
        formats = ["png"]

    if param_names is None or len(param_names) != n_params:
        param_names = [f"P{i}" for i in range(n_params)]

    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)

    def save_figure(fig, basename):
        """Save figure in all requested formats."""
        saved_formats = []
        for fmt in formats:
            fmt = fmt.lower().strip(".")
            filepath = output_dir / f"{basename}.{fmt}"
            fig.savefig(filepath, dpi=FIGURE_DPI, bbox_inches="tight", format=fmt)
            saved_formats.append(fmt)
        plt.close(fig)
        logging.info(f"   ✔ Saved: {basename} ({', '.join(saved_formats)})")

    # 1. Scatter plot - predictions vs ground truth
    fig = plot_scientific_scatter(y_true, y_pred, param_names=param_names)
    save_figure(fig, "scatter_all")

    # 2. Error histogram - error distribution per parameter
    fig = plot_error_histogram(y_true, y_pred, param_names=param_names)
    save_figure(fig, "error_histogram")

    # 3. Residual plot - residual vs predicted value
    fig = plot_residuals(y_true, y_pred, param_names=param_names)
    save_figure(fig, "residuals")

    # 4. Bland-Altman plot - method agreement analysis
    fig = plot_bland_altman(y_true, y_pred, param_names=param_names)
    save_figure(fig, "bland_altman")

    # 5. Q-Q plot - check error normality
    fig = plot_qq(y_true, y_pred, param_names=param_names)
    save_figure(fig, "qq_plot")

    # 6. Correlation heatmap - error correlations (if multi-output)
    if n_params >= 2:
        fig = plot_correlation_heatmap(y_true, y_pred, param_names=param_names)
        save_figure(fig, "error_correlation")

    # 7. Relative error plot - % error vs true value
    fig = plot_relative_error(y_true, y_pred, param_names=param_names)
    save_figure(fig, "relative_error")

    # 8. Cumulative error distribution (CDF)
    fig = plot_error_cdf(y_true, y_pred, param_names=param_names)
    save_figure(fig, "error_cdf")

    # 9. Prediction vs sample index
    fig = plot_prediction_vs_index(y_true, y_pred, param_names=param_names)
    save_figure(fig, "prediction_vs_index")

    # 10. Error box plot
    fig = plot_error_boxplot(y_true, y_pred, param_names=param_names)
    save_figure(fig, "error_boxplot")


# ==============================================================================
# MAIN
# ==============================================================================
def main():
    args = parse_args()
    operation, runtime = operation_selection(args)
    requested = runtime.device if args.device == "auto" else args.device
    if requested == "auto":
        requested = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if torch.backends.mps.is_available()
            else "cpu"
        )
    actual = requested
    if requested == "cuda" and not torch.cuda.is_available():
        actual = "cpu"
    if requested == "mps" and not torch.backends.mps.is_available():
        actual = "cpu"
    device = torch.device(actual)
    allocation = []
    if device.type == "cuda":
        visible = os.environ.get("CUDA_VISIBLE_DEVICES")
        allocation = (
            visible.split(",")
            if visible is not None
            else [str(index) for index in range(torch.cuda.device_count())]
        )
    elif device.type == "mps":
        allocation = ["mps"]
    journal = open_operation_runtime(
        args,
        operation=operation,
        runtime=runtime,
        device=device.type,
        allocated_devices=allocation,
    )
    with operation_lifecycle(journal):
        if runtime.device != "auto" and runtime.device != device.type:
            raise ValueError("Requested operation device differs from actual device")
        if requested != device.type:
            raise ValueError(f"Selected {requested} device is unavailable")
        if device.type == "cuda" and not torch.cuda.is_available():
            raise ValueError("Selected CUDA device is unavailable")
        if device.type == "mps" and not torch.backends.mps.is_available():
            raise ValueError("Selected MPS device is unavailable")
        _import_operation_modules(
            journal.bootstrap.request_manifest.resolved_config.get("import_modules", [])
        )
        _run_operation(args, device, journal, operation)


def _import_operation_modules(modules):
    """Load only registration modules explicitly recorded in approved config."""
    import importlib
    import importlib.util

    for name in validate_import_modules(modules):
        if not name.endswith(".py"):
            importlib.import_module(name)
            continue
        module_name = f"wavedl_custom_{Path(name).stem}"
        spec = importlib.util.spec_from_file_location(module_name, name)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot import custom module from: {name}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)


def _run_operation(args, device, journal, operation):
    if operation == OperationKind.PLOT:
        args.plot = True
        if args.export:
            raise ValueError("Plot operations cannot export models")
    source = journal.bootstrap.request_manifest.checkpoint_source
    if source is not None:
        from wavedl.core.checkpoint_source import snapshot_checkpoint_source

        # Explicit approved sources validate only their pinned publication. Do
        # not enumerate/hash unrelated generations through legacy discovery.
        with snapshot_checkpoint_source(Path(args.checkpoint), source) as captured:
            return _run_operation_checkpoint(args, device, journal, operation, captured)
    checkpoint_dir = resolve_checkpoint_path(args.checkpoint, purpose="best")
    return _run_operation_checkpoint(args, device, journal, operation, checkpoint_dir)


def _run_operation_checkpoint(args, device, journal, operation, checkpoint_dir):
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    logger = logging.getLogger("Tester")

    logger.info(f"Using device: {device}")
    journal.log(
        f"Using device: {device}; checkpoint: {checkpoint_dir}", stream="system"
    )

    # Load test data
    X_test, y_test = load_data_for_inference(
        args.data_path,
        format=args.format,
        input_key=args.input_key,
        output_key=args.output_key,
        input_channels=args.input_channels,
    )
    # Derive in_shape: prefer training_meta.pkl (authoritative) over data tensor.
    # This prevents shallow 3D volumes from being misinterpreted as multi-channel 2D.
    meta_in_shape = None
    meta_path = checkpoint_dir / "training_meta.pkl"
    if meta_path.exists():
        try:
            with open(meta_path, "rb") as f:
                _meta = pickle.load(f)
            meta_in_shape = _meta.get("in_shape")
        except Exception:
            pass

    data_in_shape = tuple(X_test.shape[2:])

    if meta_in_shape is not None:
        in_shape = tuple(meta_in_shape)
        # Ensure data tensor matches training-time channel expectations.
        # If checkpoint says 3D (e.g., in_shape=(8,64,64)) but load_test_data
        # treated it as multi-channel 2D, add the missing channel dimension.
        expected_ndim = len(in_shape) + 2  # batch + channel + spatial
        if X_test.ndim == expected_ndim - 1:
            X_test = X_test.unsqueeze(1)
            logger.info(
                f"   Added channel dim to match checkpoint: {tuple(X_test.shape)}"
            )
        if in_shape != tuple(X_test.shape[2:]):
            logger.warning(
                f"   ⚠️ in_shape from checkpoint {in_shape} differs from data "
                f"{tuple(X_test.shape[2:])}. Using checkpoint shape. "
                f"Pass --input_channels to override."
            )
    else:
        in_shape = data_in_shape

    # Determine if we have ground truth targets
    has_targets = y_test is not None

    # Determine output size: from targets, from --out_size, or from scaler
    if args.out_size is not None:
        if has_targets and args.out_size != y_test.shape[1]:
            raise ValueError(
                f"--out_size={args.out_size} conflicts with the {y_test.shape[1]} "
                f"target column(s) present in the data file. Omit --out_size to use "
                f"the target count, or fix the mismatch."
            )
        out_size = args.out_size
        logger.info(f"   Using explicit --out_size={out_size}")
    elif has_targets:
        out_size = y_test.shape[1]
    else:
        # Infer from scaler.pkl
        scaler_path = checkpoint_dir / "scaler.pkl"
        if (
            not scaler_path.exists()
            and not (checkpoint_dir / "COMPLETE.json").is_file()
        ):
            scaler_path = checkpoint_dir.parent / "scaler.pkl"
        if scaler_path.exists():
            with open(scaler_path, "rb") as f:
                temp_scaler = pickle.load(f)
            out_size = len(temp_scaler.scale_)
            logger.info(f"   Inferred out_size={out_size} from scaler.pkl")
        else:
            raise ValueError(
                "Cannot determine output size. Provide targets, --out_size, "
                "or ensure scaler.pkl exists in checkpoint directory."
            )

    # Load model and scaler
    logger.info(f"Loading checkpoint from: {args.checkpoint}")
    model, scaler = load_checkpoint(str(checkpoint_dir), in_shape, out_size, args.model)

    # Ensure output directory exists before any file operations (including ONNX export)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Handle ONNX export if requested
    if args.export == "onnx":
        # Determine output path
        if args.export_path:
            export_path = args.export_path
        else:
            model_name = args.model or Path(args.checkpoint).parent.name.split("_")[0]
            export_path = str(Path(args.output_dir) / f"{model_name}_model.onnx")

        # Export with sample input for tracing
        sample_input = X_test[:1]  # Single sample for tracing
        success = export_to_onnx(
            model=model,
            sample_input=sample_input,
            output_path=export_path,
            opset_version=args.export_opset,
            validate=True,
            scaler=scaler,
            include_denorm=not args.no_denorm,  # De-normalization ON by default
        )

        if success:
            # Print model info
            info = get_onnx_model_info(export_path)
            if "error" not in info:
                logger.info(f"   📊 Model size: {info['file_size_mb']:.2f} MB")
                logger.info(f"   📊 Input: {info['input_name']} {info['input_shape']}")
                logger.info(
                    f"   📊 Output: {info['output_name']} {info['output_shape']}"
                )
            logger.info(f"✅ ONNX export completed: {export_path}")
            emit_operation_artifact(
                journal, export_path, kind="other", label="ONNX model"
            )
        else:
            logger.error("❌ ONNX export failed")
            raise RuntimeError("ONNX export failed")

        # If only export was requested (no other outputs), exit early
        if not args.save_predictions and not args.plot and not args.verbose:
            logger.info(
                "Export-only mode. Use --save_predictions or --plot for inference."
            )
            return

    if len(X_test) == 0:
        raise ValueError("Evaluation and prediction require nonempty input data")

    # Run inference with timing
    logger.info(f"Running inference on {len(X_test)} samples...")
    import time

    inference_start = time.time()
    y_pred_scaled = run_inference(
        model, X_test, args.batch_size, device, num_workers=args.workers
    )
    inference_time = time.time() - inference_start

    # Calculate timing metrics
    n_samples = len(X_test)
    if n_samples > 0 and inference_time > 0:
        samples_per_sec = n_samples / inference_time
        ms_per_sample = (inference_time / n_samples) * 1000
    else:
        samples_per_sec = 0.0
        ms_per_sample = 0.0
    logger.info(
        f"   Inference time: {inference_time:.2f}s ({ms_per_sample:.2f} ms/sample, {samples_per_sec:.1f} samples/s)"
    )

    if y_pred_scaled.shape != (n_samples, out_size):
        raise ValueError("Model prediction shape does not match input and output sizes")
    if not np.isfinite(y_pred_scaled).all():
        raise ValueError("Model predictions contain nonfinite values")

    # Validate scaler dimensions match predictions
    if hasattr(scaler, "scale_") and len(scaler.scale_) != y_pred_scaled.shape[1]:
        raise ValueError(
            f"Scaler output dimension ({len(scaler.scale_)}) doesn't match "
            f"model output dimension ({y_pred_scaled.shape[1]}). "
            f"This may indicate a mismatched checkpoint or scaler.pkl."
        )

    # Inverse transform predictions
    y_pred = scaler.inverse_transform(y_pred_scaled)
    if y_pred.shape != y_pred_scaled.shape:
        raise ValueError("Inverse-scaled prediction shape differs from model output")
    if not np.isfinite(y_pred).all():
        raise ValueError("Inverse-scaled predictions contain nonfinite values")

    # Validate param_names length if provided
    if args.param_names and len(args.param_names) != y_pred.shape[1]:
        logger.warning(
            f"--param_names has {len(args.param_names)} names but model outputs "
            f"{y_pred.shape[1]} values. Using default names."
        )
        args.param_names = None  # Fall back to default

    if has_targets:
        # === MODE: With ground truth ===
        y_true = y_test.numpy()

        # Compute metrics
        metrics = compute_metrics(y_true, y_pred)
        journal.emit(
            "metric",
            MetricPayload(
                "evaluation",
                metrics.get("r2_score"),
                0,
                metrics=metrics
                | {"samples": n_samples, "inference_time": inference_time},
            ),
        )

        # Print results
        print_results(y_true, y_pred, metrics, args.param_names, args.verbose)

        # Save predictions (with targets)
        if args.save_predictions:
            output_path = output_dir / "predictions.csv"
            save_predictions(y_true, y_pred, str(output_path), args.param_names)
            emit_operation_artifact(
                journal, output_path, kind="other", label="Predictions"
            )

        # Generate plots
        if args.plot:
            logger.info(f"Generating plots (formats: {', '.join(args.plot_format)})...")
            plot_results(
                y_true,
                y_pred,
                str(output_dir),
                args.param_names,
                formats=args.plot_format,
            )
            for basename in (
                "scatter_all",
                "error_histogram",
                "residuals",
                "bland_altman",
                "qq_plot",
                "error_correlation",
                "relative_error",
                "error_cdf",
                "prediction_vs_index",
                "error_boxplot",
            ):
                if basename == "error_correlation" and y_true.shape[1] < 2:
                    continue
                for fmt in args.plot_format:
                    path = output_dir / f"{basename}.{fmt.lower().strip('.')}"
                    if path.is_file():
                        emit_operation_artifact(
                            journal, path, kind="plot", label=basename
                        )
    else:
        if operation == OperationKind.PLOT:
            raise ValueError("Plot operation requires ground truth targets")
        # === MODE: Predictions only (no ground truth) ===
        logger.info("No ground truth targets - skipping metrics and scatter plots")

        # Print prediction summary
        n_params = y_pred.shape[1]
        param_names = args.param_names or [f"P{i}" for i in range(n_params)]

        print("\n" + "=" * 80)
        print("PREDICTION SUMMARY (No Ground Truth)")
        print("=" * 80)
        print(f"Samples:          {len(y_pred)}")
        print(f"Output params:    {n_params}")
        print("-" * 80)
        for i, name in enumerate(param_names):
            print(
                f"  {name:12s}: mean={y_pred[:, i].mean():.6f}, std={y_pred[:, i].std():.6f}"
            )
        print("=" * 80)

        # Save predictions (without targets)
        if args.save_predictions:
            output_path = output_dir / "predictions.csv"
            columns = [f"Pred_{name}" for name in param_names]
            df = pd.DataFrame(y_pred, columns=columns)
            df.to_csv(output_path, index=False)
            logger.info(f"   ✔ Predictions saved to: {output_path}")
            emit_operation_artifact(
                journal, output_path, kind="other", label="Predictions"
            )

        if args.plot:
            logger.warning("Cannot generate scatter plots without ground truth targets")

    logger.info("✅ Testing completed successfully!")


if __name__ == "__main__":
    main()

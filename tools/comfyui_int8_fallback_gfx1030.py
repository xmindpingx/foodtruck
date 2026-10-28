"""int8_fallback_gfx1030 (reference copy; the live one is installed at
ComfyUI/custom_nodes/int8_fallback_gfx1030/__init__.py - edit that one, this copy keeps the fix in git) - make ComfyUI's int8 models run on GPUs hipBLASLt doesn't support.

Why this exists
---------------
ComfyUI's quantisation layer (comfy_kitchen) multiplies int8 matrices with
``torch._int_mm``. On ROCm that call goes to hipBLASLt, which only ships kernels for
CDNA2/CDNA3 and RDNA3+ (gfx908/90a/942/950, gfx11xx, gfx12xx). On RDNA2 — gfx1030, the
RX 6800/6900 — there is no Tensile library, so the call dies with::

    HIPBLAS_STATUS_INVALID_VALUE ... hipblasLtMatmulAlgoGetHeuristic

and every ``*_int8_convrot`` model (trellis_2, pixal3d, z_image_turbo, mage_flow_edit,
wan_animate) fails at its first sampler step. No PyTorch build fixes this: hipBLASLt
upstream does not target RDNA2. rocBLAS *does* support gfx1030, and it is what the
normal fp32 path already uses.

``comfy_kitchen.backends.eager.quantization.fast_int8_mm`` prefers ``torch.int8_mm``
when that attribute exists and only falls back to ``torch._int_mm``. So this module
defines ``torch.int8_mm`` — an exact int8 matmul built from fp32 GEMMs (rocBLAS) —
but ONLY on machines where ``torch._int_mm`` is actually broken. On healthy hardware it
installs nothing and the native kernel keeps being used.

Exactness: int8 products reach 127*127 = 16129, so a run of 1024 of them sums to at
most 16.5M, inside fp32's exact-integer range (2**24). Accumulating in 1024-wide
chunks therefore reproduces ``torch._int_mm`` bit for bit (verified against a CPU
int32 reference). Rows are processed in blocks to bound the fp32 temporaries.

Remove this directory to undo. No other ComfyUI file is touched.
"""

import logging

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_K_CHUNK = 1024          # |partial sum| <= 127*127*1024 < 2**24, so fp32 holds it exactly
_M_BLOCK = 2048          # cap the fp32 temporaries (the MxN fp32 product dominates; 8192 rows crashed ROCm)
_log = logging.getLogger(__name__)


def _int8_mm_rocblas(a, b):
    """Exact int8 [M,K] @ [K,N] -> int32 [M,N], computed with fp32 GEMMs."""
    import torch
    if a.dtype != torch.int8 or b.dtype != torch.int8 or a.dim() != 2 or b.dim() != 2:
        return torch._int_mm(a, b)                      # not our case: let torch complain
    M, K = a.shape
    N = b.shape[1]
    out = torch.zeros((M, N), dtype=torch.int32, device=a.device)
    if M == 0 or N == 0 or K == 0:
        return out
    for m0 in range(0, M, _M_BLOCK):
        rows = a[m0:m0 + _M_BLOCK]
        acc = out[m0:m0 + _M_BLOCK]                     # a view: += writes straight into out
        for k0 in range(0, K, _K_CHUNK):
            k1 = k0 + _K_CHUNK
            acc += torch.matmul(rows[:, k0:k1].float(), b[k0:k1].float()).to(torch.int32)
    return out


def _native_int_mm_works():
    import torch
    if not torch.cuda.is_available():
        return True                                     # nothing to patch
    try:
        probe = torch.ones((32, 32), dtype=torch.int8, device='cuda')
        torch._int_mm(probe, probe)
        torch.cuda.synchronize()
        return True
    except Exception as exc:                            # noqa: BLE001 - any failure means unusable
        _log.warning('int8_fallback_gfx1030: torch._int_mm is unusable on this GPU (%s)',
                     str(exc).split('\n')[0][:160])
        return False


def _install():
    import torch
    if hasattr(torch, 'int8_mm'):
        return 'torch.int8_mm already present - left alone'
    if _native_int_mm_works():
        return None                                     # healthy GPU: keep the native kernel
    arch = ''
    try:
        arch = torch.cuda.get_device_properties(0).gcnArchName
    except Exception:                                   # noqa: BLE001
        pass
    torch.int8_mm = _int8_mm_rocblas
    return f'int8 matmul routed through fp32 GEMMs (exact) for {arch or "this GPU"}'


try:
    _msg = _install()
    if _msg:
        print(f'[int8_fallback_gfx1030] {_msg}')
except Exception as _exc:                               # never break ComfyUI startup
    print(f'[int8_fallback_gfx1030] disabled: {_exc}')

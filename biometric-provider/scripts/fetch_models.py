from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Model:
    filename: str
    url: str
    sha256: str


OPENCV_ZOO_COMMIT = "47534e27c9851bb1128ccc0102f1145e27f23f98"
MINIFAS_COMMIT = "2d4b33a3c0ba6e27772ac3a9b48ec495bf5c1dad"
MODELS = (
    Model(
        "face_detection_yunet_2023mar.onnx",
        f"https://github.com/opencv/opencv_zoo/raw/{OPENCV_ZOO_COMMIT}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    Model(
        "face_recognition_sface_2021dec.onnx",
        f"https://github.com/opencv/opencv_zoo/raw/{OPENCV_ZOO_COMMIT}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
    Model(
        "minifas_v2_se_quantized.onnx",
        f"https://raw.githubusercontent.com/facenox/face-antispoof-onnx/{MINIFAS_COMMIT}/models/best_model_quantized.onnx",
        "fde20585635cae62ed1d41796f76b6f8bc4b92cd91ec1cf0f1bc6485d2d587a9",
    ),
)


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def fetch(model: Model, destination: Path) -> None:
    target = destination / model.filename
    if target.is_file() and digest(target) == model.sha256:
        print(f"verified {model.filename}")
        return
    destination.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{model.filename}.", dir=destination)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        request = urllib.request.Request(model.url, headers={"User-Agent": "mia-face-provider-model-fetch/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        actual = digest(temporary)
        if actual != model.sha256:
            raise RuntimeError(f"Hash invalido para {model.filename}: {actual}")
        temporary.replace(target)
        print(f"downloaded {model.filename}")
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", type=Path, default=Path(__file__).resolve().parents[1] / "models")
    args = parser.parse_args()
    for model in MODELS:
        fetch(model, args.destination.resolve())


if __name__ == "__main__":
    main()

# Avisos de terceros

El contenedor descarga los artefactos fijados en `scripts/fetch_models.py` y verifica su SHA-256 antes de iniciar.

| Componente | Uso | Licencia | Fuente fijada |
|---|---|---|---|
| YuNet `face_detection_yunet_2023mar.onnx` | Deteccion y cinco puntos faciales | MIT, segun el directorio oficial de OpenCV Zoo | `opencv/opencv_zoo@47534e27c9851bb1128ccc0102f1145e27f23f98` |
| SFace `face_recognition_sface_2021dec.onnx` | Embedding para comparacion 1:1 | Apache-2.0, segun el directorio oficial de OpenCV Zoo | `opencv/opencv_zoo@47534e27c9851bb1128ccc0102f1145e27f23f98` |
| MiniFAS V2 SE cuantizado | Clasificacion pasiva real/spoof | Apache-2.0 | `facenox/face-antispoof-onnx@2d4b33a3c0ba6e27772ac3a9b48ec495bf5c1dad` |

Los textos completos de licencia permanecen en los repositorios fuente enlazados por el README de despliegue. Este archivo no modifica sus condiciones ni presenta sus metricas como garantia para una instalacion concreta.

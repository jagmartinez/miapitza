from __future__ import annotations

import os

import uvicorn


def main() -> None:
    workers = int(os.getenv("FACE_WORKERS", "1"))
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        workers=workers,
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FACE_FORWARDED_ALLOW_IPS", "127.0.0.1").strip(),
        access_log=False,
        server_header=False,
    )


if __name__ == "__main__":
    main()

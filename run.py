"""Start server: python run.py"""

import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    # 线上环境必须绑定 0.0.0.0 才能被外部访问，本地开发可通过 DEV_HOST 覆盖
    host = os.environ.get("HOST", os.environ.get("DEV_HOST", "0.0.0.0"))
    reload = os.environ.get("RELOAD", "false").lower() == "true"
    print(f"Starting server on {host}:{port}, reload={reload}")
    uvicorn.run("backend.main:app", host=host, port=port, reload=reload)

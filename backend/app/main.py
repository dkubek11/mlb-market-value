from fastapi import FastAPI

app = FastAPI(title="MLB Market Value API")


@app.get("/health")
def health():
    return {"status": "ok"}

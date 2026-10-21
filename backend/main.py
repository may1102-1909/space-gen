from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routes import chat, detection, generation, projects, reconstruction, scenes

app = FastAPI(title="SpaceGen AI", version="0.1.0")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(scenes.router)
app.include_router(projects.router)
app.include_router(chat.router)
app.include_router(generation.router)
app.include_router(reconstruction.router)
app.include_router(detection.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "spacegen-ai"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

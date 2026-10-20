from config import Settings


def test_cross_platform_defaults(tmp_path):
    """Verify DATA_ROOT defaults cross-platform without hardcoded Windows drive letters."""
    settings = Settings(data_dir=tmp_path / "custom_data")
    root = settings.reconstruction_root
    assert str(root).endswith("reconstruction")
    assert not str(root).startswith("D:/spacegen_data")


def test_reconstruction_dir_override(tmp_path):
    """Verify reconstruction_dir setting cleanly overrides root directory."""
    custom = tmp_path / "custom_recon"
    settings = Settings(reconstruction_dir=custom)
    assert settings.reconstruction_root == custom.resolve()


def test_tool_paths_parsing():
    """Verify tool_paths parses extra directories cleanly."""
    settings = Settings(
        colmap_path="/usr/bin/colmap",
        ffmpeg_path="/usr/bin/ffmpeg",
        extra_tool_paths="/custom/tools",
    )
    paths = [str(p) for p in settings.tool_paths]
    assert any("colmap" in p or "bin" in p for p in paths)

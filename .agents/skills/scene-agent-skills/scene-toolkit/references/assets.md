# Asset provenance and portability

Record asset ID, source URL/provider, licence, permitted use/redistribution, original filename/hash, conversion steps and destination paths. MIT covers this repository's original code and documentation, not third-party models, HDRIs, reference images or commercial software. Keep client/private references out of public examples.

```sh
scene-agent image-check textures/concrete.png
scene-agent manifest staging
scene-agent package staging --out deliverable.zip
```

Image inspection verifies header, size, mode, decoding and extension consistency. It does not perform color-space assignment or guarantee Corona can load a specialized TIFF/TX. A file named PNG can contain JPEG; a TX may have a readable TIFF container but still need conversion for the target loader. Preserve source data and create explicit derived files when conversion is needed.

Manifests contain relative paths, sizes and SHA-256 hashes. Duplicate basenames are reported because naive relink-by-name can attach the wrong wood texture. Path case collisions and symlinks are rejected for portability. Packaging checks file content again while writing and refuses output inside the source tree or replacing an existing ZIP.

The packager does not infer licences, discover dependencies inside proprietary `.max` files or scan for all secrets. Stage the correct files deliberately. Native asset enumeration/relinking remains a host workflow. Verify native load from another folder and document any required commercial plugins.

Convert one material/proxy in a small scene before doing thousands. Rendering performance and save/load cost both matter. Retain source geometry for audit; use proxies where supported for production.

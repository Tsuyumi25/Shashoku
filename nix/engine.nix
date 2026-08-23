{
  lib,
  rustPlatform,
}:

let
  manifest = lib.importJSON ../crates/shashoku-engine/package.json;

  # What napi's CLI would have named the cdylib. The triple is a literal
  # because this flake builds one platform; the rest comes from the manifest
  # that the workspace and this derivation both answer to.
  addon = "${manifest.napi.binaryName}.linux-x64-gnu.node";
in
rustPlatform.buildRustPackage {
  pname = "shashoku-engine";
  inherit (manifest) version;

  # Only what cargo reads. The renderer changes far more often than this crate
  # does, and a source that included it would rebuild the engine — and rerun
  # its tests — every time a component moved.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../Cargo.toml
      ../Cargo.lock
      ../crates
    ];
  };
  cargoLock.lockFile = ../Cargo.lock;

  # Installed as the Node package the bundles expect to resolve, so nothing
  # downstream has to know that a `.node` came out of cargo. napi's own entry
  # would pick among a dozen platform binaries at load time; here there is one,
  # and its name is known while the package is being built.
  postInstall = ''
    dir="$out/lib/node_modules/${manifest.name}"
    mkdir -p "$dir"
    mv "$out/lib/libshashoku_engine.so" "$dir/${addon}"
    install -Dm444 crates/shashoku-engine/package.json "$dir/package.json"
    echo "module.exports = require('./${addon}')" > "$dir/index.js"
  '';

  passthru.nodeModule = "lib/node_modules/${manifest.name}";
}

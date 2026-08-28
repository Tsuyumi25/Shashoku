{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm,
  nodejs_22,
  electron_43,
  makeWrapper,
  sidecar,
  engine,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "shashoku";
  version = "0.0.0";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../electron.vite.config.ts
      ../index.html
      ../tsconfig.json
      ../tsconfig.node.json
      ../tsconfig.renderer.json
      ../electron
      ../shared
      ../src
      # The workspace member has to be declarable for the lockfile to resolve;
      # none of the crate is read here, and the addon it produces arrives from
      # its own derivation.
      ../crates/shashoku-engine/package.json
    ];
  };

  # The version the manifest's `packageManager` names, which is what this and
  # every other platform install the lockfile with. Reading it with a resolver
  # it was not written by is a way to get a different tree.
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-sj/LFftZO+ebnv9+9AXuU2wdFoaqH1gAftwcXJuDzq8=";
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  strictDeps = true;

  # `postinstall` fetches an Electron of its own for development. The one this
  # package runs on comes from nixpkgs instead.
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/share/shashoku"
    cp -r out package.json "$out/share/shashoku/"

    # The bundles leave two names unresolved: `electron`, which the runtime
    # supplies, and the addon, which arrives already shaped as the package they
    # ask for.
    mkdir -p "$out/share/shashoku/node_modules/@shashoku"
    ln -s "${engine}/${engine.nodeModule}" \
          "$out/share/shashoku/node_modules/@shashoku/engine"

    makeWrapper ${lib.getExe electron_43} "$out/bin/shashoku" \
      --add-flags "$out/share/shashoku" \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}" \
      --inherit-argv0 \
      --set-default SHASHOKU_PYTHON "${sidecar}/bin/python"

    runHook postInstall
  '';

  # So a check can reach the runtime this package has rather than naming a
  # version of it a second time.
  passthru.electron = electron_43;

  meta = {
    description = "Manga translation and typesetting workflow";
    license = lib.licenses.gpl3Only;
    platforms = [ "x86_64-linux" ];
    mainProgram = "shashoku";
  };
})

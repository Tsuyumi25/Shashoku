{
  lib,
  callPackage,
  # Named rather than `python3`: the sidecar's lock refuses 3.14 and up, so
  # letting the channel's default float would turn a version bump in nixpkgs
  # into an unresolvable environment here.
  python313,
  pyproject-nix,
  uv2nix,
  pyproject-build-systems,
}:

let
  workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ../python; };

  # uv does not record build systems, so the two packages the lock has no wheel
  # for have to be told what their own build needs. Both are pure Python.
  needsSetuptools =
    final: prev:
    lib.genAttrs [ "antlr4-python3-runtime" "unidic-lite" ] (
      name:
      prev.${name}.overrideAttrs (old: {
        nativeBuildInputs = old.nativeBuildInputs ++ final.resolveBuildSystem { setuptools = [ ]; };
      })
    );

  # torchvision's extension modules link against libtorch, which its own wheel
  # does not carry — it is next door in torch's output, and a separate store
  # path is somewhere auto-patchelf does not look unless told. Nothing to do
  # with CUDA, though that is the only context the fix is usually published in.
  findsLibtorch = final: prev: {
    torchvision = prev.torchvision.overrideAttrs (old: {
      preFixup = (old.preFixup or "") + ''
        addAutoPatchelfSearchPath '${final.torch}'
      '';
    });
  };

  # Wheels rather than sources: the lock's own answer is a wheel for all but
  # two of its packages, and both of those are pure Python.
  pythonSet =
    (callPackage pyproject-nix.build.packages { python = python313; }).overrideScope
      (lib.composeManyExtensions [
        pyproject-build-systems.overlays.wheel
        (workspace.mkPyprojectOverlay { sourcePreference = "wheel"; })
        needsSetuptools
        findsLibtorch
      ]);
in
pythonSet.mkVirtualEnv "shashoku-sidecar-env" workspace.deps.default

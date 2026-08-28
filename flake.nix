{
  description = "Shashoku — manga translation and typesetting workflow";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, pyproject-nix, uv2nix, pyproject-build-systems, rust-overlay, ... }:
    let
      inherit (nixpkgs) lib;
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      manifest = lib.importJSON ./package.json;

      # nixpkgs builds these from source, so an attribute is one version and
      # asking it for another means leaving `cache.nixos.org` and compiling.
      # What the declarations buy is a mismatch that says so, leaving whoever
      # hits it to choose between waiting for nixpkgs and moving off this
      # channel.
      declared =
        what: version: pkg:
        if pkg.version == version then
          pkg
        else
          throw "${what}: this repository declares ${version}, nixpkgs has ${pkg.version}";

      # pnpm reads `packageManager` and replaces itself with the version named
      # there, so on every other platform that field decides which resolver
      # writes the lockfile. nixpkgs' build hook turns that off, which leaves
      # this the only way for a Nix build to run the same one — and the
      # channel's 10.34.0 is inside the vulnerable range of GHSA-5wx6-mg75-v57r.
      pnpm = pkgs.pnpm_10.override {
        version = lib.removePrefix "pnpm@" manifest.packageManager;
        hash = "sha256-BuAQiklB3i1wnhw7yEHT6QxFxqJs7Kx29iBE+gLKwaA=";
      };

      # Not `overrideAttrs` on this one: `electron_43` is a wrapper whose
      # `buildCommand` names the unwrapped store path outright and which has no
      # unpackPhase, so `version` moves while `src` is ignored — the package
      # would be a new version by name and an old one by content, and every
      # assertion about it would still pass.
      electron = declared "electron" manifest.devDependencies.electron pkgs.electron_43;

      nodejs = declared "node" (lib.fileContents ./.nvmrc) pkgs.nodejs_22;

      python = declared "python" (lib.fileContents ./python/.python-version) pkgs.python313;

      uv = declared "uv" (
        lib.removePrefix "==" (lib.importTOML ./python/pyproject.toml).tool.uv.required-version
      ) pkgs.uv;

      # No assertion beside this one, and no channel to wait for: these are
      # official binaries off static.rust-lang.org, so the file names a version
      # and gets it. It is the same file rustup reads, which is how a
      # contributor without Nix arrives at the same compiler and the same set
      # of lints.
      rust = (rust-overlay.lib.mkRustBin { } pkgs).fromRustupToolchainFile ./rust-toolchain.toml;

      sidecar = pkgs.callPackage ./nix/sidecar.nix {
        python313 = python;
        inherit pyproject-nix uv2nix pyproject-build-systems;
      };

      engine = pkgs.callPackage ./nix/engine.nix {
        rustPlatform = pkgs.makeRustPlatform {
          cargo = rust;
          rustc = rust;
        };
      };

      app = pkgs.callPackage ./nix/app.nix {
        inherit pnpm electron nodejs sidecar engine;
      };

      electronLibs = with pkgs; [
        glib
        nss
        nspr
        dbus
        atk
        cups
        libdrm
        gtk3
        pango
        cairo
        libx11
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrandr
        libxcb
        mesa
        expat
        alsa-lib
        at-spi2-atk
        at-spi2-core
        libxkbcommon
        vulkan-loader
        libxshmfence
        libgbm
        libGL
        wayland
      ];
      # What the OCR sidecar's wheels link against. They are manylinux builds,
      # so they expect a distribution's libraries rather than carrying their
      # own — opencv names the X client libraries whether or not anything is
      # ever drawn. Complete on its own rather than leaning on `electronLibs`
      # beside it, so moving something out of that list cannot break OCR.
      sidecarLibs = with pkgs; [
        stdenv.cc.cc.lib
        zlib
        libxcb
        libx11
        libxext
        libGL
        glib
      ];
    in
    {
      packages.${system} = {
        inherit sidecar engine app;
        default = app;
      };

      checks.${system} = {
        sidecar = pkgs.runCommand "shashoku-sidecar-check" { } ''
          export HOME="$TMPDIR"
          ${sidecar}/bin/python ${./nix/checks/sidecar.py}
          touch "$out"
        '';

        engine = pkgs.runCommand "shashoku-engine-check"
          { SHASHOKU_ENGINE = "${engine}/${engine.nodeModule}"; } ''
          ${lib.getExe nodejs} ${./nix/checks/engine.js}
          touch "$out"
        '';

        app = pkgs.runCommand "shashoku-app-check"
          {
            SHASHOKU_APP_ROOT = "${app}/share/shashoku";
            nativeBuildInputs = [ pkgs.xvfb-run ];
          } ''
          export HOME="$TMPDIR"

          # Whatever failed, the reason is in one of these — and a check that
          # only reports which grep came up empty makes someone reproduce the
          # whole build to read a line it already had.
          show() { trap - ERR; for f in sidecar.log app.log; do
            [ -f "$f" ] && { echo "=== $f"; cat "$f"; }
          done; }
          trap 'show' ERR
          set -E

          # From nowhere in particular, which is what the application gives it:
          # an interpreter named through SHASHOKU_PYTHON carries the package, so
          # the sidecar is started with no working directory of its own.
          ${sidecar}/bin/python -m shashoku_ocr </dev/null > sidecar.log 2>&1
          grep -q "sidecar ready" sidecar.log

          # Under the runtime the application has, rather than a Node beside it.
          ELECTRON_RUN_AS_NODE=1 ${lib.getExe app.electron} ${./nix/checks/app.js}

          # Through the wrapper, which nothing above goes through and which is
          # the only thing a person runs. The line waited for is printed after
          # the main bundle has finished loading — which is where a package that
          # cannot start stops, window or no window. The port is left to the
          # system so a build outside a sandbox cannot collide with a running
          # copy.
          # Named rather than minted, because the check has to present it: the
          # application would otherwise keep the token in a file under a home
          # directory this build throws away.
          export SHASHOKU_MCP_TOKEN=shashoku-check

          SHASHOKU_MCP_PORT=0 \
            xvfb-run -a "${app}/bin/shashoku" --no-sandbox > app.log 2>&1 &
          for _ in $(seq 100); do
            grep -q "\[mcp\] listening" app.log && break
            sleep 0.2
          done
          grep -q "\[mcp\] listening" app.log

          # Then knock, and wait for the window to answer. Listening is printed
          # before the window exists and a dead renderer leaves the process up,
          # so this is the first step that any of the assembly below the main
          # process has to survive.
          SHASHOKU_MCP_ENDPOINT="$(sed -n 's|.*\[mcp\] listening on \([^[:space:]]*\).*|\1|p' app.log | head -1)" \
            ELECTRON_RUN_AS_NODE=1 ${lib.getExe app.electron} ${./nix/checks/renderer.js}

          kill %1

          touch "$out"
        '';
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          nodejs
          pnpm
          uv
          # `python/.python-version` names a patch version, so uv now insists on
          # exactly that interpreter and would otherwise go and download one.
          python
          rust
        ];
        # Off here and nowhere else. In `.npmrc` it would reach contributors
        # without Nix too, and which pnpm they run would go back to being
        # whatever their machine happens to have installed.
        shellHook = ''
          export npm_config_manage_package_manager_versions=false
          export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (electronLibs ++ sidecarLibs)}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"
        '';
      };
    };
}

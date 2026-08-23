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
  };

  outputs = { nixpkgs, pyproject-nix, uv2nix, pyproject-build-systems, ... }:
    let
      inherit (nixpkgs) lib;
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      sidecar = pkgs.callPackage ./nix/sidecar.nix {
        inherit pyproject-nix uv2nix pyproject-build-systems;
      };

      engine = pkgs.callPackage ./nix/engine.nix { };

      app = pkgs.callPackage ./nix/app.nix { inherit sidecar engine; };

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
          ${lib.getExe pkgs.nodejs_22} ${./nix/checks/engine.js}
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
        packages = with pkgs; [
          nodejs_22
          pnpm_10
          cargo
          rustc
          # The gate's own tools, so that what it says on a machine is what it
          # says in CI. A clippy from somewhere else is a different set of
          # lints, and the answer would depend on whose shell asked.
          clippy
          rustfmt
          uv
        ];
        shellHook = ''
          export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (electronLibs ++ sidecarLibs)}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"
        '';
      };
    };
}

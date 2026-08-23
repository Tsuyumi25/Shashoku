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
      packages.${system} = { inherit sidecar engine; };

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
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          pnpm_10
          cargo
          rustc
          uv
        ];
        shellHook = ''
          export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (electronLibs ++ sidecarLibs)}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"
        '';
      };
    };
}

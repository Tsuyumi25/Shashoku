{
  description = "Shashoku — manga translation and typesetting workflow";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
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
      # What the OCR sidecar's wheels expect to find. They are manylinux
      # builds, so they link against a distribution's libraries rather than
      # carrying their own: numpy wants libstdc++, opencv wants the X client
      # library whether or not anything is ever drawn. Named here rather than
      # left to whatever the system's nix-ld happens to hold, so a checkout
      # behaves the same on a machine configured differently.
      sidecarLibs = with pkgs; [
        stdenv.cc.cc.lib
        zlib
      ];
    in
    {
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

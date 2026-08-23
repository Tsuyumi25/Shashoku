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

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
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          pnpm_10
        ];
        shellHook = ''
          export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"
        '';
      };
    };
}

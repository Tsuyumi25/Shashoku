{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      # pnpm 下載的 Electron 是未經 patch 的 FHS binary：dynamic linker 由系統
      # nix-ld 的 shim 提供，runtime libs 由這份清單（對齊 nixpkgs electron 打包
      # 的依賴）補給。走 NIX_LD_LIBRARY_PATH 而非 LD_LIBRARY_PATH——只對經過
      # nix-ld 的外來 binary 生效，不會污染 shell 內 nix 打包的工具。
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
        shellHook = ''
          export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"
        '';
      };
    };
}

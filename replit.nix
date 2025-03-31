{ pkgs }: {
  deps = [
    pkgs.nodejs-18_x
    pkgs.chromium
    pkgs.glib
    pkgs.gobject-introspection
    pkgs.libx11
    pkgs.libXcomposite
    pkgs.libXrandr
    pkgs.libXtst
    pkgs.libXi
    pkgs.libnss
    pkgs.libatk
    pkgs.cups
    pkgs.gtk3
    pkgs.libxss
    pkgs.libsecret
  ];
}

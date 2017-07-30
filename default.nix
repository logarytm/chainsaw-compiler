with import <nixpkgs> { };

stdenv.mkDerivation rec {
  name = "www";

  buildInputs = [
    nodejs
  ];
}

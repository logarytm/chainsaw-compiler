with import <nixpkgs> { };

stdenv.mkDerivation rec {
  name = "compiler";

  buildInputs = [
    nodejs
  ];
}

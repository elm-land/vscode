#!/bin/sh

folders=$1
moduleName=$2
typeOrValueName=$3

grep -Erx "import $moduleName( as \w+)? exposing .*" $folders --include='*.elm' | cat
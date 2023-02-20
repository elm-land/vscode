#!/bin/sh

folders=$1
moduleName=$2
typeOrValueName=$3

grep -Erx "import $moduleName as \w+" $folders --include='*.elm' | cat | sed "s/import $moduleName as //" | while IFS=: read -r fsPath aliasName; do
  echo
  echo $aliasName
  grep -rnw "$aliasName\.$typeOrValueName" $fsPath | cat
done
#!/bin/sh

folders=$1
moduleName=$2
typeOrValueName=$3

grep -rlx "import $moduleName" $folders --include='*.elm' | cat | xargs -I {} grep -rnw "$moduleName\.$typeOrValueName" {} | cat